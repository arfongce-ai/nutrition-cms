import { useEffect, useMemo, useState } from 'react';
import { dateKey, diaryStats, FOOD_GROUPS, periodFeedback, readJournal, saveJournalDay } from '../services/diaryInsights.js';

export function DiaryCalendar({ selected, onSelect, reports, journal }) {
  const [month, setMonth] = useState(selected.slice(0, 7));
  useEffect(() => setMonth(selected.slice(0, 7)), [selected]);
  const first = new Date(`${month}-01T12:00:00`);
  const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const days = useMemo(() => {
    const map = new Map();
    reports.forEach((r) => {
      const key = dateKey(r.createdAt);
      const value = map.get(key) || { calories: 0, missing: false };
      value.calories += Math.max(0, Number(r.totals?.calories) || 0);
      value.missing ||= Boolean(r.totals?.missingNutrients?.includes('calories') || r.items?.some((i) => i.isPendingInfo));
      map.set(key, value);
    });
    return map;
  }, [reports]);
  function move(delta) {
    const d = new Date(first.getFullYear(), first.getMonth() + delta, 1, 12);
    onSelect(dateKey(d));
  }
  return <section className="meal-card diary-calendar" aria-label="식사 달력">
    <div className="calendar-toolbar"><button type="button" aria-label="이전 달" onClick={() => move(-1)}>‹</button><h2>{first.getFullYear()}년 {first.getMonth() + 1}월</h2><button type="button" aria-label="다음 달" onClick={() => move(1)}>›</button><button type="button" className="calendar-today" onClick={() => onSelect(dateKey())}>오늘</button></div>
    <div className="calendar-grid">{['월', '화', '수', '목', '금', '토', '일'].map((d) => <span className="calendar-weekday" key={d}>{d}</span>)}
      {Array.from({ length: offset }, (_, i) => <span key={`empty-${i}`} />)}
      {Array.from({ length: count }, (_, i) => {
        const key = `${month}-${String(i + 1).padStart(2, '0')}`;
        const data = days.get(key);
        const entry = journal[key];
        return <button type="button" className={`calendar-day ${key === dateKey() ? 'is-today' : ''}`} key={key} aria-pressed={key === selected} aria-label={`${key}${data ? `, ${Math.round(data.calories)} kcal${data.missing ? ', 일부 정보 미확인' : ''}` : ', 식사 기록 없음'}${entry?.complete ? ', 하루 기록 완료' : ''}`} onClick={() => onSelect(key)}>
          <b>{i + 1}</b><small>{data ? `${data.missing ? '≈' : ''}${Math.round(data.calories).toLocaleString('ko-KR')}` : '—'}</small><span className="calendar-marker">{entry?.complete ? '✓' : entry?.note ? '•' : '\u00a0'}</span>
        </button>;
      })}
    </div><p className="meal-hint">날짜별 kcal · — 식사 미기록 · ≈ 일부 정보 미확인 · ✓ 하루 기록 완료</p>
  </section>;
}

export function DailyJournal({ day, entry = {}, onSaved }) {
  const [draft, setDraft] = useState(() => ({ note: '', waterMl: 0, foodGroups: [], complete: false, ...entry }));
  const [status, setStatus] = useState('');
  const future = day > dateKey();
  function change(values) { setDraft((old) => ({ ...old, ...values })); setStatus('아직 저장하지 않은 변경 내용이 있어요.'); }
  function save(event) {
    event.preventDefault();
    try { onSaved(saveJournalDay(day, draft)); setStatus('하루 일기를 저장했어요.'); }
    catch (error) { setStatus(error.name === 'QuotaExceededError' ? '저장 공간이 부족해 일기를 저장하지 못했어요.' : error.message); }
  }
  return <form className="meal-card daily-journal" onSubmit={save} aria-label="하루 일기">
    <h2>{day} · 하루 일기</h2>
    <p className="meal-hint">식사 기록과 함께 몸 상태, 운동, 포만감을 적어보세요.</p>
    <label className="meal-field">오늘의 메모<textarea rows={3} maxLength={3000} placeholder="점심 먹고 20분 산책. 저녁에는 채소를 더 먹었어요." value={draft.note} onChange={(e) => change({ note: e.target.value })} /></label>
    <label className="meal-field">마신 물 (mL)<input type="number" min="0" max="20000" step="50" value={draft.waterMl} onChange={(e) => change({ waterMl: e.target.value, waterRecorded: true })} /></label>
    <div className="water-actions"><button type="button" onClick={() => change({ waterMl: Math.min(20000, Number(draft.waterMl || 0) + 200), waterRecorded: true })}>＋ 물 200 mL</button><button type="button" onClick={() => change({ waterMl: Math.max(0, Number(draft.waterMl || 0) - 200), waterRecorded: true })}>− 200 mL</button></div>
    <fieldset><legend>오늘 먹은 식품군을 체크해 주세요</legend><div className="food-group-checks">{FOOD_GROUPS.map((group) => <label key={group.key}><input type="checkbox" checked={draft.foodGroups.includes(group.key)} onChange={(e) => change({ foodGroups: e.target.checked ? [...draft.foodGroups, group.key] : draft.foodGroups.filter((key) => key !== group.key) })} /><span>{group.label}<small>{group.hint}</small></span></label>)}</div></fieldset>
    <label className="journal-complete"><input type="checkbox" checked={draft.complete} disabled={future} onChange={(e) => change({ complete: e.target.checked })} />하루 기록 완료 · 먹은 식사와 간식을 모두 기록했어요</label>
    <button className="meal-secondary" type="submit" disabled={future}>하루 일기 저장</button>{status ? <p role="status" className="meal-hint">{status}</p> : null}
  </form>;
}

export function SixNutrientGuide({ totals, journal = {}, period = false, hasMeals = true }) {
  const n = (key) => !hasMeals ? '식사 기록 없음' : totals.missingNutrients?.includes(key) ? '일부 정보 미확인' : `${Math.round(Number(totals[key]) || 0)} g 기록`;
  const cards = [
    ['탄수화물', '01', n('carb'), '통곡물·잡곡과 콩류를 식사에 다양하게 넣어보세요.'],
    ['단백질', '02', n('protein'), '콩·두부·생선·달걀 등 여러 단백질 식품을 번갈아 드세요.'],
    ['지방', '03', n('fat'), '견과류·씨앗·식물성 기름 등 불포화지방 공급원을 선택해 보세요.'],
    ['비타민', '04', '개별 섭취량 데이터 없음', '여러 색의 채소와 과일을 곁들이세요. 식품 다양성은 모든 비타민의 충족을 뜻하지 않아요.'],
    ['무기질', '05', '개별 섭취량 데이터 없음', '칼슘은 유제품·강화 식품, 철은 콩·살코기 등 다양한 공급원을 살펴보세요.'],
    ['물', '06', period ? '하루 일기에서 기록' : journal.waterRecorded ? `${Number(journal.waterMl).toLocaleString('ko-KR')} mL 직접 기록` : '아직 기록하지 않았어요', '물은 하루 동안 나누어 마시고 활동량·더위에 맞춰 조절하세요. 음식과 다른 음료의 수분은 이 기록에 포함되지 않아요.'],
  ];
  return <section className="meal-card"><h2>6대 영양소, 골고루 챙기기</h2><p className="meal-hint">{period ? '선택 기간의 합계예요. ' : ''}기록 수치는 섭취 목표나 충족률이 아니에요.</p><div className="six-nutrient-grid">{cards.map(([name, number, value, hint]) => <article key={name}><span>{number}</span><h3>{name}</h3><strong>{value}</strong><p>{hint}</p></article>)}</div><p className="meal-hint">가이드 근거: <a href="https://www.who.int/news-room/fact-sheets/detail/healthy-diet" target="_blank" rel="noreferrer">WHO 건강한 식사</a> · <a href="https://www.nhs.uk/live-well/eat-well/food-guidelines-and-food-labels/water-drinks-nutrition/" target="_blank" rel="noreferrer">NHS 수분 안내</a></p></section>;
}

export function PeriodReview({ stats, journal, period }) {
  return <section className="meal-card period-review"><h2>{period === 'month' || period === '30d' ? '월간' : '주간'} 평가와 피드백</h2><p className="meal-hint">{stats.label} · 기록된 식사 기준</p><ul>{periodFeedback(stats, journal).map((text) => <li key={text}>{text}</li>)}</ul><p className="meal-hint">체중이나 칼로리의 증감만으로 좋음·나쁨을 평가하지 않아요.</p></section>;
}

export { readJournal, diaryStats, dateKey };
