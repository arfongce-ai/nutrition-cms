import { sameFoodName } from './foodPortions.js';

const validNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const percentile90 = (values) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * .9) - 1] : null;

// Food names are matched one-to-one. Unmatched sides count as misses, not zero-weight matches.
export function evaluateMeals(records) {
  if (!Array.isArray(records) || !records.length) throw new Error('실측 평가 자료가 없습니다.');
  const ids = new Set();
  let expected = 0, predicted = 0, matched = 0;
  const gramsErrors = [], calorieErrors = [], relativeErrors = [];
  for (const row of records) {
    if (!row.id || ids.has(row.id) || row.split !== 'test') throw new Error('중복 없는 id와 학습에 사용하지 않은 test 자료가 필요합니다.');
    ids.add(row.id);
    if (!row.referenceMethod || !Array.isArray(row.reference) || !row.reference.length || !Array.isArray(row.predicted)) throw new Error(`${row.id}: 기준값의 측정 방법과 음식 목록이 필요합니다.`);
    if (row.reference.some((food) => !food.name || !validNumber(food.grams) || !validNumber(food.calories))) throw new Error(`${row.id}: 기준 중량과 칼로리는 확인한 숫자여야 합니다.`);
    if (row.predicted.some((food) => !food.name || (food.grams != null && !validNumber(food.grams)) || (food.calories != null && !validNumber(food.calories)))) throw new Error(`${row.id}: 예측값은 0 이상 숫자 또는 null이어야 합니다.`);
    expected += row.reference.length;
    predicted += row.predicted.length;
    const unused = new Set(row.predicted.map((_, i) => i));
    for (const food of row.reference) {
      const index = [...unused].find((i) => sameFoodName(food.name, row.predicted[i].name));
      if (index === undefined) continue;
      unused.delete(index);
      matched++;
      if (validNumber(row.predicted[index].grams)) gramsErrors.push(Math.abs(row.predicted[index].grams - food.grams));
    }
    if (row.predicted.length && row.predicted.every((food) => validNumber(food.calories))) {
      const actual = row.reference.reduce((sum, food) => sum + food.calories, 0);
      const estimate = row.predicted.reduce((sum, food) => sum + food.calories, 0);
      const error = Math.abs(estimate - actual);
      calorieErrors.push(error);
      if (actual > 0) relativeErrors.push(error / actual);
    }
  }
  return {
    meals: records.length, referenceFoods: expected, predictedFoods: predicted, matchedFoods: matched,
    foodPrecision: predicted ? matched / predicted : null, foodRecall: expected ? matched / expected : null,
    missedFoods: expected - matched, extraOrWrongFoods: predicted - matched,
    weightComparedFoods: gramsErrors.length, weightMaeGrams: mean(gramsErrors),
    calorieComparedMeals: calorieErrors.length, calorieCoverage: calorieErrors.length / records.length,
    calorieMae: mean(calorieErrors), calorieErrorP90: percentile90(calorieErrors),
    calorieMape: mean(relativeErrors), calorieRelativeComparedMeals: relativeErrors.length,
  };
}
