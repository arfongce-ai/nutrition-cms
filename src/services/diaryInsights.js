export const JOURNAL_KEY = 'nutritionDailyJournal.v1';
export const FOOD_GROUPS = [
  { key: 'grain', label: '통곡물·잡곡', hint: '현미밥, 오트밀, 통밀빵' },
  { key: 'protein', label: '단백질 식품', hint: '콩, 두부, 달걀, 생선, 살코기' },
  { key: 'fat', label: '불포화지방 식품', hint: '견과류, 씨앗, 올리브유' },
  { key: 'vegetable', label: '채소', hint: '여러 색의 채소와 나물' },
  { key: 'fruit', label: '과일', hint: '주스보다 통째로 먹는 과일' },
  { key: 'calcium', label: '칼슘 공급 식품', hint: '우유, 요거트, 칼슘 강화 식품' },
];

export function dateKey(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function localDateTime(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  return dateKey(d) ? `${dateKey(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
}

export function mealTypeAt(value) {
  const hour = new Date(value).getHours();
  return hour >= 5 && hour < 11 ? '아침' : hour >= 11 && hour < 16 ? '점심' : hour >= 16 && hour < 22 ? '저녁' : '간식·기타';
}

export function periodBounds(period, selected = dateKey(), now = new Date()) {
  const anchor = new Date(`${selected}T12:00:00`);
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const end = new Date(start);
  if (period === 'month') {
    start.setDate(1);
    end.setMonth(end.getMonth() + 1, 0);
  } else if (period === 'week') {
    start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 6);
  } else if (period === '7d' || period === '30d') {
    start.setDate(start.getDate() - (period === '7d' ? 6 : 29));
  }
  end.setHours(23, 59, 59, 999);
  const elapsedEnd = new Date(Math.min(end.getTime(), now.getTime()));
  const days = [];
  for (const d = new Date(start); d <= elapsedEnd; d.setDate(d.getDate() + 1)) days.push(dateKey(d));
  return { start, end: elapsedEnd, days, label: `${dateKey(start)} ~ ${dateKey(end)}` };
}

export function diaryStats(reports, period, selected = dateKey(), now = new Date()) {
  const bounds = periodBounds(period, selected, now);
  const filtered = reports.filter((r) => {
    const d = new Date(r.createdAt);
    return d >= bounds.start && d <= bounds.end;
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const fields = ['calories', 'carb', 'protein', 'fat', 'sodium', 'sugar'];
  const totals = Object.fromEntries(fields.map((key) => [key, 0]));
  const missing = new Set();
  const byDay = new Map();
  for (const r of filtered) {
    for (const key of fields) {
      const n = Number(r.totals?.[key]);
      if (Number.isFinite(n) && n >= 0) totals[key] += n;
      else missing.add(key);
    }
    (r.totals?.missingNutrients || []).forEach((key) => missing.add(key));
    if (r.items?.some((item) => item.isPendingInfo)) fields.forEach((key) => missing.add(key));
    const key = dateKey(r.createdAt);
    byDay.set(key, (byDay.get(key) || 0) + Math.max(0, Number(r.totals?.calories) || 0));
  }
  totals.missingNutrients = [...missing];
  return { reports: filtered, totals, recordedDays: byDay.size, mealCount: filtered.length,
    dailyAverage: byDay.size ? totals.calories / byDay.size : 0,
    mealAverage: filtered.length ? totals.calories / filtered.length : 0,
    periodDays: bounds.days.length, label: bounds.label,
    chartDays: bounds.days.map((key) => ({ key, label: `${Number(key.slice(5, 7))}/${Number(key.slice(8))}`, calories: byDay.get(key) || 0, recorded: byDay.has(key) })) };
}

export function readJournal(storage = globalThis.localStorage) {
  try {
    const data = JSON.parse(storage.getItem(JOURNAL_KEY) || '{}');
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}

export function saveJournalDay(key, entry, storage = globalThis.localStorage) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('날짜를 확인해 주세요.');
  const waterMl = Number(entry.waterMl);
  if (!Number.isFinite(waterMl) || waterMl < 0 || waterMl > 20000) throw new Error('마신 물은 0~20,000 mL 사이로 입력해 주세요.');
  const journal = readJournal(storage);
  journal[key] = { note: String(entry.note || '').slice(0, 3000), waterMl, waterRecorded: Boolean(entry.waterRecorded), complete: Boolean(entry.complete),
    foodGroups: FOOD_GROUPS.filter((group) => entry.foodGroups?.includes(group.key)).map((group) => group.key), updatedAt: new Date().toISOString() };
  storage.setItem(JOURNAL_KEY, JSON.stringify(journal));
  return journal;
}

export function periodFeedback(stats, journal) {
  if (!stats.recordedDays) return ['아직 식사 기록이 없어요. 한 끼부터 기록하면 기간별 피드백을 볼 수 있어요.'];
  const completeDays = stats.chartDays.filter((day) => journal[day.key]?.complete);
  const feedback = [`${stats.periodDays}일 중 ${stats.recordedDays}일에 식사를 기록했어요. 하루 기록 완료는 ${completeDays.length}일이에요.`];
  if (completeDays.length < stats.recordedDays) feedback.push('식사를 일부만 기록한 날이 있어요. 하루 평균은 기록된 식사의 합계이며 실제 하루 섭취량보다 적을 수 있어요.');
  if (stats.totals.missingNutrients.length) feedback.push('확인되지 않은 영양정보가 포함되어 있어 영양소 합계와 칼로리 평가는 잠정적이에요. 음식과 양을 보완해 주세요.');
  if (completeDays.length) {
    const counts = FOOD_GROUPS.map((group) => ({ ...group, count: completeDays.filter((day) => journal[day.key]?.foodGroups?.includes(group.key)).length }));
    const least = [...counts].sort((a, b) => a.count - b.count)[0];
    if (least.count < completeDays.length) feedback.push(`완료한 날 중 '${least.label}'을 체크한 날은 ${least.count}/${completeDays.length}일이에요. 다음 식사에 ${least.hint}을 살펴보세요. 체크 여부만으로 영양 결핍을 판정하지 않아요.`);
    else feedback.push('완료한 날마다 여섯 식품군을 체크했어요. 같은 식품군 안에서도 종류를 바꾸어 다양하게 드세요.');
  } else feedback.push('하루의 식사와 식품군을 확인한 뒤 ‘하루 기록 완료’를 체크하면 식품 다양성 피드백이 더 구체적이 돼요.');
  const waterDays = stats.chartDays.filter((day) => journal[day.key]?.waterRecorded);
  feedback.push(waterDays.length ? `물 기록 ${waterDays.length}일 · 기록한 날 평균 ${Math.round(waterDays.reduce((sum, day) => sum + journal[day.key].waterMl, 0) / waterDays.length)} mL예요. 음식과 다른 음료의 수분은 포함하지 않았어요.` : '물 기록도 함께 남겨보세요. 필요한 수분량은 활동량과 환경에 따라 달라져요.');
  return feedback;
}
