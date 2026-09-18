import test from 'node:test';
import assert from 'node:assert/strict';
import { getMacroBreakdown, layoutFoodLabels, normalizeFoodPosition, scaleHistoryItem } from '../src/services/mealPresentation.js';
import { onRequestPost } from '../functions/api/vision-analyze.js';

test('macronutrient energy ratios total 100 even when package calories differ', () => {
  const ratios = getMacroBreakdown({ calories: 900, carb: 40, protein: 20, fat: 10 });
  assert.equal(ratios.carb + ratios.protein + ratios.fat, 100);
  assert.deepEqual(ratios, { carb: 49, protein: 24, fat: 27, available: true });
  assert.deepEqual(getMacroBreakdown({ carb: 1, protein: 1, fat: 0 }), { carb: 50, protein: 50, fat: 0, available: true });
});

test('missing or invalid nutrition does not fabricate percentages', () => {
  assert.equal(getMacroBreakdown({}).available, false);
  assert.equal(getMacroBreakdown({ carb: -10, protein: NaN, fat: Infinity }).available, false);
  assert.equal(getMacroBreakdown({ carbohydrates: 10 }).carb, 100);
});

test('photo positions reject invalid coordinates rather than pinning arbitrary labels', () => {
  for (const position of [null, {}, { x: null, y: null }, { x: '0.5', y: .5 }, { x: -1, y: .5 }, { x: 1.1, y: 0 }, { x: Infinity, y: 0 }]) assert.equal(normalizeFoodPosition(position), null);
  assert.deepEqual(normalizeFoodPosition({ x: 0, y: 1 }), { x: 0, y: 1 });
});

test('eight nearby foods get separate labels; unknown positions stay in the legend', () => {
  const positions = layoutFoodLabels([...Array.from({ length: 8 }, () => ({ position: { x: .5, y: .5 } })), {}], 296, 250);
  assert.equal(positions.filter(Boolean).length, 8);
  assert.equal(positions[8], null);
  positions.filter(Boolean).forEach((position, i, placed) => placed.slice(i + 1).forEach((other) => {
    assert.ok(Math.abs(position.x - other.x) >= .46 || Math.abs(position.y - other.y) >= .2);
  }));
});

test('changing the consumed amount scales every saved nutrient and count', () => {
  const original = { consumedAmount: 100, servingSizeGrams: 100, quantity: 2, servingUnit: 'g', nutrients: { calories: 150, carbohydrates: 2, protein: 12, fat: 10, sodium: 140 } };
  const half = scaleHistoryItem(original, 50);
  assert.deepEqual(half.nutrients, { calories: 75, carbohydrates: 1, protein: 6, fat: 5, sodium: 70 });
  assert.equal(half.servingSizeGrams, 50);
  assert.equal(half.quantity, 1);
  assert.equal(original.nutrients.calories, 150);
  assert.equal(scaleHistoryItem(original, 0).nutrients.protein, 0);
});

test('drink volume scales without changing its unit', () => {
  const half = scaleHistoryItem({ consumedAmount: 200, servingUnit: 'mL', servingVolumeMl: 200, servingCount: 1, nutrients: { calories: 100 } }, 100);
  assert.equal(half.servingVolumeMl, 100);
  assert.equal(half.servingCount, .5);
  assert.equal(half.servingUnit, 'mL');
});

const request = () => new Request('https://example.test/api/vision-analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: 'data:image/png;base64,AAAA' }) });
test('vision result preserves valid food positions and rejects invalid ones', async () => {
  const AI = { run: async () => ({ response: JSON.stringify({ foods: [{ name: '계란', confidence: .8, estimatedGrams: 50, position: { x: .3, y: .7 } }, { name: '밥', confidence: .7, position: { x: -1, y: 2 } }] }) }) };
  const response = await onRequestPost({ request: request(), env: { AI } });
  const result = await response.json();
  assert.deepEqual(result.foods[0].position, { x: .3, y: .7 });
  assert.equal(result.foods[1].position, null);
});

test('OpenAI fallback replaces an empty first-provider JSON result', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ foods: [{ name: '계란', confidence: .9, position: { x: .5, y: .5 } }] }) }] }] });
  try {
    const response = await onRequestPost({ request: request(), env: { AI: { run: async () => ({ response: '{"foods":[]}' }) }, OPENAI_API_KEY: 'test-only' } });
    const result = await response.json();
    assert.equal(result.provider, 'openai');
    assert.equal(result.foods[0].name, '계란');
    assert.deepEqual(result.foods[0].position, { x: .5, y: .5 });
  } finally { globalThis.fetch = originalFetch; }
});

test('unconfigured vision clearly reports unavailable', async () => {
  const response = await onRequestPost({ request: request(), env: {} });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'vision_not_configured');
});
