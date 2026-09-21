export function normalizeFoodPosition(value) {
  if (!value || typeof value.x !== 'number' || typeof value.y !== 'number') return null;
  if (![value.x, value.y].every(Number.isFinite)) return null;
  if (value.x < 0 || value.x > 1 || value.y < 0 || value.y > 1) return null;
  return { x: value.x, y: value.y };
}

export function layoutFoodLabels(foods, width = 350, height = 300) {
  const halfWidth = .23;
  const halfHeight = Math.min(.25, 25 / Math.max(height, 1));
  const occupied = [];
  return foods.map((food) => {
    const point = normalizeFoodPosition(food.position);
    if (!point) return null;
    const target = { x: Math.max(halfWidth, Math.min(1 - halfWidth, point.x)), y: Math.max(halfHeight, Math.min(1 - halfHeight, point.y)) };
    const candidates = foods.filter((item) => normalizeFoodPosition(item.position)).length >= 4 ? [] : [target];
    for (let y = halfHeight; y <= 1 - halfHeight; y += halfHeight * 2 + .01) {
      for (const x of [halfWidth, 1 - halfWidth]) candidates.push({ x, y });
    }
    candidates.sort((a, b) => Math.hypot((a.x - point.x) * width, (a.y - point.y) * height) - Math.hypot((b.x - point.x) * width, (b.y - point.y) * height));
    const position = candidates.find((candidate) => occupied.every((other) => Math.abs(other.x - candidate.x) >= halfWidth * 2 || Math.abs(other.y - candidate.y) >= halfHeight * 2));
    if (!position) return null; // Dense photos keep remaining names in the list below.
    occupied.push(position);
    return position;
  });
}

const positive = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

// Ratios represent energy from the three macronutrients, and always total 100%.
export function getMacroBreakdown(totals = {}) {
  if (totals.missingNutrients?.some((key) => ['carb', 'protein', 'fat'].includes(key))) return { carb: 0, protein: 0, fat: 0, available: false };
  const values = [positive(totals.carb ?? totals.carbohydrates), positive(totals.protein), positive(totals.fat)];
  const energy = values.map((value, index) => value * (index === 2 ? 9 : 4));
  const total = energy.reduce((sum, value) => sum + value, 0);
  if (!total) return { carb: 0, protein: 0, fat: 0, available: false };
  const raw = energy.map((value) => value / total * 100);
  const rounded = raw.map(Math.floor);
  const order = [0, 1, 2].sort((a, b) => (raw[b] - rounded[b]) - (raw[a] - rounded[a]));
  const deficit = 100 - rounded.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < deficit; i++) rounded[order[i]] += 1;
  return { carb: rounded[0], protein: rounded[1], fat: rounded[2], available: true };
}

export function scaleHistoryItem(item, amount) {
  const previous = positive(item.consumedAmount ?? item.servingSizeGrams ?? item.servingCount);
  const next = positive(amount);
  const ratio = previous > 0 ? next / previous : 1;
  const round = (value) => Math.round(value * 100) / 100;
  return {
    ...item,
    portionSource: next === previous ? item.portionSource : 'entered',
    portionConfirmed: next > 0,
    portionChoice: next === previous ? item.portionChoice : '',
    consumedAmount: next,
    servingSizeGrams: item.servingUnit === 'g' ? next : item.servingUnit === 'kg' ? next * 1000 : positive(item.servingSizeGrams) * ratio,
    servingVolumeMl: positive(item.servingVolumeMl) * ratio,
    servingCount: positive(item.servingCount) * ratio,
    quantity: item.quantity ? round(positive(item.quantity) * ratio) : 0,
    nutrients: Object.fromEntries(Object.entries(item.nutrients || {}).map(([key, value]) => [key, round(positive(value) * ratio)])),
  };
}

export function getEatingOrder(items = []) {
  const groups = [[], [], [], []];
  for (const item of items) {
    const name = item.name || item.foodName || '';
    if (!name) continue;
    const group = /샐러드|나물|채소|오이|브로콜리|양배추|당근/.test(name) ? 0
      : /계란|달걀|두부|고기|닭|생선|연어|참치|콩/.test(name) ? 1
        : /밥|면|빵|떡|감자|고구마|국수/.test(name) ? 2 : 3;
    groups[group].push(name);
  }
  return groups.filter((group) => group.length).map((group) => group.join(' · '));
}
