export const normalizeFoodName = (name) => String(name || '').toLowerCase().replace(/[\s()·_-]/g, '');

export function sameFoodName(a, b) {
  const canonical = (name) => normalizeFoodName(name).replace(/달걀/g, '계란');
  return Boolean(canonical(a)) && canonical(a) === canonical(b);
}

export function getPortionChoices(food = {}) {
  const amount = Math.max(Number(food.grams) || 100, .01);
  const name = normalizeFoodName(food.name);
  if (food.perServing) {
    const basis = Math.max(Number(food.servingAmount || food.nutrientBasisGrams) || 1, .01);
    return [.5, 1, 2].map((count, i) => ({ label: ['반 회분', '1회분', '2회분'][i], grams: basis * count, quantity: '', portionSource: 'label-serving' }));
  }
  if (/^(흰쌀밥|쌀밥|공기밥|현미밥|잡곡밥|밥)$/.test(name)) {
    return [.5, 1, 2].map((count, i) => ({ label: ['반 공기', '1공기', '2공기'][i], grams: 210 * count, quantity: count, unitLabel: '공기', portionSource: 'household' }));
  }
  if (/^(삶은|구운)?(계란|달걀)$/.test(name)) {
    return [.5, 1, 2].map((count, i) => ({ label: ['반 개', '1개', '2개'][i], grams: 50 * count, quantity: count, unitLabel: '개', portionSource: 'household' }));
  }
  return [.5, 1, 1.5].map((ratio, i) => ({ label: ['절반', '이만큼', '조금 더'][i], grams: Math.round(amount * ratio * 100) / 100, quantity: food.quantity ? Number(food.quantity) * ratio : '', unitLabel: food.unitLabel || '', portionSource: 'photo-adjusted' }));
}

export function selectPortion(option) {
  const { label, ...values } = option;
  return { ...values, grams: String(values.grams), portionConfirmed: true, portionChoice: label };
}

export function updateFoodDetails(food, next) {
  const renamed = next.name !== undefined && next.name !== food.name;
  const amountChanged = next.grams !== undefined && String(next.grams) !== String(food.grams);
  const reset = renamed ? { nutrients: null, nutrientBasisGrams: null, brand: '', category: '', sourceLabel: '', sourceUrl: '', official: false, perServing: false, servingAmount: 0, servingUnit: 'g', serving: '', nameConfirmed: true, portionConfirmed: false, portionSource: 'unknown', portionChoice: '', quantity: '', unitLabel: '' } : {};
  const portion = amountChanged ? { portionSource: 'entered', portionConfirmed: Number(next.grams) > 0, portionChoice: '', quantity: food.quantity && Number(food.grams) > 0 ? Number(food.quantity) * Number(next.grams) / Number(food.grams) : '' } : {};
  return { ...food, ...portion, ...reset, ...next };
}
