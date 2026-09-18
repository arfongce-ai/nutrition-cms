import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMeals } from '../src/services/recognitionEvaluation.js';

// Arithmetic fixtures verify the evaluator, not real-world recognition accuracy.
const fixture = () => ({ id: 'arithmetic-only', split: 'test', referenceMethod: 'synthetic unit test', reference: [{ name: '계란', grams: 50, calories: 75 }, { name: '밥', grams: 100, calories: 150 }], predicted: [{ name: '계란', grams: 60, calories: 90 }] });
test('missed foods affect recall and whole-meal calorie error', () => {
  const result = evaluateMeals([fixture()]);
  assert.equal(result.foodRecall, .5);
  assert.equal(result.foodPrecision, 1);
  assert.equal(result.missedFoods, 1);
  assert.equal(result.weightMaeGrams, 10);
  assert.equal(result.calorieMae, 135);
});
test('missing predictions lower coverage and are not scored as perfect', () => {
  const row = fixture(); row.predicted = [];
  const result = evaluateMeals([row]);
  assert.equal(result.foodRecall, 0);
  assert.equal(result.calorieCoverage, 0);
  assert.equal(result.calorieMae, null);
});
test('test-only unique records and explicit ground truth are required', () => {
  assert.throws(() => evaluateMeals([]));
  assert.throws(() => evaluateMeals([fixture(), fixture()]));
  assert.throws(() => evaluateMeals([{ ...fixture(), split: 'train' }]));
  assert.throws(() => evaluateMeals([{ ...fixture(), reference: [{ name: '계란', grams: null, calories: 75 }] }]));
});
test('duplicate predictions cannot match the same reference twice', () => {
  const row = fixture(); row.predicted.push({ ...row.predicted[0] });
  assert.equal(evaluateMeals([row]).foodPrecision, .5);
});
