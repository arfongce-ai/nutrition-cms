import { useEffect, useRef, useState } from 'react';
import { getEatingOrder, getMacroBreakdown, layoutFoodLabels, normalizeFoodPosition } from '../services/mealPresentation';
import { getPortionChoices, selectPortion } from '../services/foodPortions';
import { getFoodEvidence } from '../services/measurementConfidence';

export const foodColors = ['#156b5b', '#9b4d19', '#6046a3', '#a42f57', '#22658c', '#686217', '#3c6282', '#725041'];
const number = (value) => (Math.round((Number(value) || 0) * 10) / 10).toLocaleString('ko-KR');

export function PortionPicker({ food, onChange }) {
  const [base] = useState(food);
  const unit = food.servingUnit || 'g';
  const choices = getPortionChoices(base);
  const valid = Number(food.grams) > 0 && Number(food.grams) <= 5000;
  return <div className="meal-portion">
    <div><h3>얼마나 먹었나요?</h3><span>{food.portionSource === 'measured' ? '' : '약 '}{number(food.grams)}{unit}</span></div>
    <div className="meal-portion-row" aria-label={`${food.name} 먹은 양`}>{choices.map((option) => <button type="button" key={option.label} aria-pressed={Boolean(food.portionConfirmed && food.portionChoice === option.label && Math.abs(Number(food.grams) - option.grams) < .01)} onClick={() => onChange(selectPortion(option))}>{option.label}</button>)}</div>
    <p className="meal-hint" role="status">{food.portionConfirmed ? getFoodEvidence(food).portion : '먹은 양을 하나 골라주세요.'}{choices[0]?.portionSource === 'household' ? ` · ${choices[1].label}를 약 ${choices[1].grams}g으로 계산해요.` : ''}</p>
    <details className="meal-details"><summary>양을 숫자로 입력하기</summary>
      <label className="meal-field">먹은 양 ({unit})<input type="number" min="0.01" max="5000" step="any" inputMode="decimal" value={food.grams ?? ''} onChange={(event) => onChange({ grams: event.target.value, portionSource: 'entered', portionConfirmed: Number(event.target.value) > 0 && Number(event.target.value) <= 5000, portionChoice: '', quantity: '' })} /></label>
      {!valid ? <p className="meal-hint" role="alert">0보다 크고 5,000 이하인 양을 입력해 주세요.</p> : null}
      {['g', 'kg'].includes(unit) ? <label className="meal-consent"><input type="checkbox" checked={food.portionSource === 'measured'} disabled={!valid} onChange={(event) => onChange({ portionSource: event.target.checked ? 'measured' : 'entered', portionConfirmed: valid, portionChoice: '' })} />저울로 잰 무게예요</label> : null}
    </details>
  </div>;
}

export function FoodEvidence({ item }) {
  const evidence = getFoodEvidence(item);
  const url = /^https?:\/\//i.test(item.sourceUrl || '') ? item.sourceUrl : '';
  return <details className="meal-details meal-source"><summary>계산 근거 보기</summary><dl className="meal-evidence">
    <div><dt>음식 이름</dt><dd>{evidence.name}</dd></div>
    <div><dt>먹은 양</dt><dd>{evidence.portion}</dd></div>
    <div><dt>영양정보</dt><dd>{evidence.source}{url ? <> · <a href={url} target="_blank" rel="noreferrer">출처 열기 ↗</a></> : null}</dd></div>
    <div><dt>계산 기준</dt><dd>{item.serving || `${number(item.nutrientBasisGrams || 100)}${item.servingUnit || 'g'}당 영양정보`}</dd></div>
  </dl></details>;
}

export function MealSteps({ step }) {
  return <ol className="meal-steps" aria-label="식사 기록 순서">
    {['사진 찍기', '음식 확인', '기록하기'].map((label, index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined} className={step >= index + 1 ? 'is-current' : ''}>
      <span>{step > index + 1 ? '✓' : index + 1}</span>{label}
    </li>)}
  </ol>;
}

export function MealPhoto({ src, foods = [], onFoodClick, onPosition, onImageClick, busy = false }) {
  const [placing, setPlacing] = useState(null);
  const [failed, setFailed] = useState(false);
  const stageRef = useRef(null);
  const [size, setSize] = useState({ width: 350, height: 300 });
  useEffect(() => {
    if (!stageRef.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, [src, failed]);
  const positions = layoutFoodLabels(foods, size.width, size.height);
  const placed = foods.filter((_, index) => positions[index]);
  const unplaced = foods.filter((_, index) => !positions[index]);
  function tap(event) {
    if (placing && onPosition) {
      const rect = event.currentTarget.getBoundingClientRect();
      onPosition(placing, { x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) });
      setPlacing(null);
    } else if (!busy) onImageClick?.(event);
  }
  function chip(food, index, position) {
    const label = <><b>{index + 1}</b><span>{food.name || food.foodName || '음식'}</span></>;
    const props = { className: `food-photo-tag ${position ? 'is-placed' : ''}`, style: { '--food-color': foodColors[index % foodColors.length], ...(position ? { left: `${position.x * 100}%`, top: `${position.y * 100}%` } : {}) } };
    return onFoodClick ? <button key={food.id || index} {...props} type="button" onClick={() => onFoodClick(food, index)} aria-label={`${index + 1}번 ${food.name || food.foodName} 자세히 보기`}>{label}</button> : <span key={food.id || index} {...props}>{label}</span>;
  }
  if (!src || failed) return <div className="meal-photo-empty"><span aria-hidden="true">🍽️</span><p>{failed ? '사진을 불러오지 못했어요' : '음식 이름으로 기록한 식사'}</p></div>;
  return <div className="meal-photo">
    <div ref={stageRef} className={`meal-photo-stage ${placing ? 'is-placing' : ''}`}>
      <img src={src} alt="기록할 식사 사진" onClick={tap} onError={() => setFailed(true)} />
      {!placing ? <svg className="meal-photo-connectors" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{placed.map((food) => { const point = normalizeFoodPosition(food.position); const position = positions[foods.indexOf(food)]; return <line key={food.id || foods.indexOf(food)} x1={point.x * 100} y1={point.y * 100} x2={position.x * 100} y2={position.y * 100} stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" />; })}</svg> : null}
      {!placing && placed.map((food) => chip(food, foods.indexOf(food), positions[foods.indexOf(food)]))}
      {busy ? <div className="photo-busy"><span className="meal-spinner" />음식을 찾고 있어요</div> : null}
    </div>
    {unplaced.length ? <div className="food-photo-legend">{unplaced.map((food) => chip(food, foods.indexOf(food)))}</div> : null}
    {placing ? <p className="meal-photo-help" role="status">사진에서 이 음식의 가운데를 눌러주세요. <button type="button" onClick={() => setPlacing(null)}>취소</button></p> : null}
    {onPosition && foods.length ? <details className="meal-photo-help"><summary>이름표 위치 바꾸기</summary><p>음식을 고른 다음 사진 속 위치를 눌러주세요.</p><div className="meal-choice-row">{foods.map((food, index) => <button type="button" key={food.id} onClick={() => setPlacing(food.id)}>{index + 1}. {food.name}</button>)}</div></details> : null}
  </div>;
}

export function MacroBar({ totals = {}, compact = false }) {
  const ratios = getMacroBreakdown(totals);
  const nutrients = [{ key: 'carb', label: compact ? '탄수' : '탄수화물', grams: totals.carb ?? totals.carbohydrates, color: '#157660' }, { key: 'protein', label: '단백질', grams: totals.protein, color: '#b96b1b' }, { key: 'fat', label: '지방', grams: totals.fat, color: '#7454b1' }];
  return <div className={`meal-macros ${compact ? 'is-compact' : ''}`}>
    <div className="meal-macro-track" role="img" aria-label={ratios.available ? nutrients.map((item) => `${item.label} ${ratios[item.key]}%`).join(', ') : '탄수화물·단백질·지방 정보 없음'}>{nutrients.map((item) => <span key={item.key} style={{ width: `${ratios[item.key]}%`, background: item.color }} />)}</div>
    <div className="meal-macro-labels">{nutrients.map((item) => <div key={item.key}><span className="macro-dot" style={{ background: item.color }} /><span>{item.label} <b>{ratios.available ? `${ratios[item.key]}%` : '—'}</b></span>{!compact ? <small>{totals.missingNutrients?.includes(item.key) ? '—' : number(item.grams) + 'g'}</small> : null}</div>)}</div>
    {!compact ? <p className="meal-hint">탄단지는 탄수화물·단백질·지방이에요. 막대는 세 영양소의 에너지 비율이에요.</p> : null}
  </div>;
}

export function DailyBudget({ goal, consumed = 0, mealCalories = 0, childMode = false }) {
  if (childMode) return <div className="meal-budget"><b>골고루 먹고, 튼튼하게 자라요</b><p>칼로리는 음식이 주는 에너지예요. 숫자를 줄이기보다 다양한 음식을 먹어요.</p></div>;
  const total = Math.max(0, Number(consumed) || 0) + Math.max(0, Number(mealCalories) || 0);
  const remaining = Math.round(goal - total);
  return <div className="meal-budget">
    <div><span>{mealCalories ? '이 식사를 더하면' : '오늘 기록 기준'}</span><b>{remaining >= 0 ? `${number(remaining)} kcal 남아요` : `목표보다 ${number(-remaining)} kcal 많아요`}</b></div>
    <div className="meal-goal-track" role="progressbar" aria-label="하루 목표 대비 기록한 칼로리" aria-valuenow={Math.round(Math.min(total, goal))} aria-valuemin={0} aria-valuemax={goal}><span style={{ width: `${Math.min(100, total / Math.max(goal, 1) * 100)}%` }} /></div>
    <p>{number(total)} / 하루 참고 목표 {number(goal)} kcal · 내 정보로 계산한 예상값</p>
  </div>;
}

export function FoodNutritionCard({ item, index, food, onUpdate, onRemove, children }) {
  const [editing, setEditing] = useState(false);
  return <article className="meal-card food-result-card" id={`food-result-${food?.id || index}`} tabIndex={-1}>
    <div className="meal-card-heading"><span className="food-number" style={{ background: foodColors[index % foodColors.length] }}>{index + 1}</span><div><h3>{item.name}</h3><p>{item.quantity ? `${number(item.quantity)}${item.unitLabel || '개'} · ` : ''}{number(item.grams)}{item.servingUnit || 'g'}</p></div><strong>{item.isPendingInfo ? '확인 필요' : <>약 {number(item.calories)}<small> kcal</small></>}</strong></div>
    {item.isPendingInfo ? <p className="meal-hint">영양정보를 아직 찾지 못했어요. 아래에서 음식 이름을 확인해 주세요.</p> : <MacroBar totals={item} compact />}
    {food && onUpdate ? <>
      <PortionPicker key={`${food.name}:${food.servingUnit || 'g'}`} food={food} onChange={(next) => onUpdate(food.id, next)} />
      <button className="meal-text-button" type="button" onClick={() => setEditing(!editing)} aria-expanded={editing}>{editing ? '수정 닫기' : '이름·양 직접 고치기'} <span aria-hidden="true">{editing ? '−' : '+'}</span></button>
      {editing || food.requiresConfirmation || !food.nameConfirmed ? <div className="meal-food-editor">{children}</div> : null}
      {onRemove ? <button type="button" className="meal-text-button muted" onClick={() => onRemove(food.id)}>이 음식 빼기</button> : null}
    </> : null}
    {!food ? children : null}
    <FoodEvidence item={item} />
  </article>;
}

export function EatingOrder({ items }) {
  const order = getEatingOrder(items);
  return <details className="meal-card meal-details"><summary>어떤 음식부터 먹을까요?</summary><p className="meal-hint">먹는 순서를 참고해 보세요. 천천히 꼭꼭 씹어 먹어요.</p><ol className="meal-eating-order">{order.map((name, index) => <li key={name}><b>{index + 1}</b>{name}</li>)}</ol></details>;
}
