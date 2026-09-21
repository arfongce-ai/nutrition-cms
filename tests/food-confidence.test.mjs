import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { assessMeasurementConfidence, getFoodEvidence } from '../src/services/measurementConfidence.js';
import { getPortionChoices, selectPortion, updateFoodDetails, sameFoodName } from '../src/services/foodPortions.js';
import { getMacroBreakdown } from '../src/services/mealPresentation.js';

const bundle = await build({ entryPoints: ['src/services/nutritionEngine.js'], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' });
const { analyzeMeal } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const profile = { mode: 'adult', age: 30, height: 170, weight: 65, medical: ['없음'], sport: '없음' };
const analyze = (foods, facts = {}) => analyzeMeal(profile, foods, facts);

test('official nutrition cannot turn an estimated photo amount into high confidence', () => {
  const item = { official: true, matched: true, sourceUrl: 'https://example.test/label', calories: 300, portionSource: 'photo', nameConfirmed: true };
  const result = assessMeasurementConfidence({ items: [item], totals: { calories: 300 } }, { calories: 300 });
  assert.notEqual(result.level, 'high');
  assert.equal(result.level, 'low');
  assert.equal(result.agreement, undefined);
  assert.equal(getFoodEvidence(item).estimated, true);
});

test('confirmed names and household portions still disclose estimated weight', () => {
  const item = { nameConfirmed: true, portionConfirmed: true, portionSource: 'household', matched: true };
  assert.equal(assessMeasurementConfidence({ items: [item] }).label, '입력 내용 확인 완료');
  assert.match(getFoodEvidence(item).portion, /추정/);
  assert.match(getFoodEvidence({}).portion, /확인 필요/);
});

test('household choices use explicit units and do not apply to composite dishes', () => {
  assert.equal(getPortionChoices({ name: '계란' })[2].grams, 100);
  assert.equal(getPortionChoices({ name: '흰쌀밥' })[0].grams, 105);
  assert.equal(getPortionChoices({ name: '계란볶음밥', grams: 350 })[1].label, '이만큼');
  const halfBottle = selectPortion(getPortionChoices({ name: '음료', perServing: true, servingAmount: 250, servingUnit: 'mL' })[0]);
  assert.equal(halfBottle.grams, '125');
  assert.equal(halfBottle.portionSource, 'label-serving');
});

test('renaming clears old nutrition, and changing a measured amount clears measurement evidence', () => {
  const original = { name: '계란', grams: '50', quantity: 1, nutrients: { calories: 75 }, portionSource: 'measured', portionConfirmed: true, official: true };
  const renamed = updateFoodDetails(original, { name: '김치찌개' });
  assert.equal(renamed.nutrients, null);
  assert.equal(renamed.portionConfirmed, false);
  assert.equal(renamed.official, false);
  const resized = updateFoodDetails(original, { grams: '25' });
  assert.equal(resized.portionSource, 'entered');
  assert.equal(resized.quantity, .5);
});

test('stew and cooking methods are not silently replaced by similar names', () => {
  for (const [left, right] of [['김치찌개', '된장찌개'], ['깍두기', '배추김치'], ['계란프라이', '계란'], ['삶은계란', '계란']]) assert.equal(sameFoodName(left, right), false);
  assert.equal(sameFoodName('삶은 달걀', '삶은계란'), true);
  for (const name of ['김치찌개', '깍두기', '계란프라이', '김치볶음밥', '알 수 없는 음식']) {
    const report = analyze([{ name, grams: '100' }]);
    assert.equal(report.items[0].isPendingInfo, true, name);
    assert.equal(report.totals.calories, 0, name);
  }
});

test('food amount scales package nutrition using the matching declared basis', () => {
  const food = { name: '검사용 음료', grams: '125', perServing: true, servingAmount: 250, servingUnit: 'mL', nutrients: { calories: 100, carb: 20, protein: 5, fat: 0 }, portionSource: 'label-serving', portionConfirmed: true, nameConfirmed: true };
  const report = analyze([food]);
  assert.equal(report.totals.calories, 50);
  assert.equal(report.totals.protein, 2.5);
  assert.equal(report.items[0].servingUnit, 'mL');
  assert.equal(report.items[0].portionSource, 'label-serving');
});

test('zero on a label is usable nutrition; a missing field stays unknown', () => {
  const zero = analyze([], { foodName: '검사용 제로 음료', calories: '0', carb: '0', protein: '0', fat: '0', servingsConsumed: .5, labelConfirmed: true, portionConfirmed: true });
  assert.equal(zero.items.length, 1);
  assert.equal(zero.items[0].isPendingInfo, false);
  assert.equal(zero.items[0].portionConfirmed, true);
  const partial = analyze([], { calories: '100' });
  assert.equal(getMacroBreakdown(partial.totals).available, false);
  assert.ok(partial.items[0].missingNutrients.includes('protein'));
  const missingCalories = analyze([], { protein: '10' });
  assert.equal(missingCalories.items[0].isPendingInfo, true);
  assert.equal(missingCalories.totals.protein, 0);
});

test('label serving multipliers scale every nutrient and need explicit confirmation', () => {
  const report = analyze([], { calories: '200', carb: '20', protein: '10', fat: '8', sodium: '300', servingsConsumed: '0.5', labelConfirmed: true, portionConfirmed: true });
  assert.equal(report.totals.calories, 100);
  assert.equal(report.totals.sodium, 150);
  assert.equal(report.items[0].portionConfirmed, true);
  assert.equal(analyze([], { calories: '200' }).items[0].portionConfirmed, false);
});

test('a missing dish is disclosed and excluded from the known nutrition sum', () => {
  const report = analyze([{ name: '계란', grams: '50' }, { name: '김치찌개', grams: '250' }]);
  assert.equal(report.totals.calories, report.items[0].calories);
  assert.equal(assessMeasurementConfidence(report).tiers.pending, 1);
  assert.ok(report.totals.missingNutrients.includes('calories'));
});
