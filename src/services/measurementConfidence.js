export const TRUST_TIER = { OFFICIAL: 'official', MATCHED: 'matched', ESTIMATED: 'estimated', PENDING: 'pending' };
export const TRUST_TIER_LABEL = { official: '출처 있는 영양정보', matched: '일반 음식 참고값', estimated: '직접 입력한 정보', pending: '영양정보 확인 필요' };

export function classifyItemTrust(item) {
  if (!item || item.isPendingInfo) return TRUST_TIER.PENDING;
  if (item.official && item.sourceUrl) return TRUST_TIER.OFFICIAL;
  if (item.matched) return TRUST_TIER.MATCHED;
  return TRUST_TIER.ESTIMATED;
}

export function getFoodEvidence(item = {}) {
  const source = item.portionSource || 'unknown';
  const portionLabels = {
    photo: '사진으로 추정 · 양 확인 필요',
    standard: '기본 분량 · 양 확인 필요',
    household: '양 선택 완료 · 무게는 추정',
    'photo-adjusted': '사진의 양 선택 · 무게는 추정',
    entered: '숫자 직접 입력 · 실측 여부 미확인',
    measured: '저울로 잰 무게 입력',
    'label-serving': '표시된 분량에서 먹은 양 선택',
    unknown: '먹은 양 확인 필요',
  };
  return {
    name: item.nameConfirmed ? '사용자 확인' : '음식 이름 확인 필요',
    portion: portionLabels[source] || portionLabels.unknown,
    source: item.isPendingInfo ? '영양정보 확인 필요' : item.sourceLabel || (item.matched ? '일반 음식 참고값' : '직접 입력한 영양정보'),
    estimated: source !== 'measured' && source !== 'label-serving',
  };
}

// A database match and two agreeing model predictions do not validate a meal's weight.
export function assessMeasurementConfidence(report) {
  const items = report?.items || [];
  const tiers = items.reduce((counts, item) => { counts[classifyItemTrust(item)]++; return counts; }, { official: 0, matched: 0, estimated: 0, pending: 0, total: items.length });
  if (!items.length) return { level: 'none', label: '확인할 음식 없음', reasons: [], tiers };
  const names = items.filter((item) => !item.nameConfirmed).length;
  const portions = items.filter((item) => !item.portionConfirmed).length;
  const estimates = items.filter((item) => getFoodEvidence(item).estimated).length;
  const reasons = [];
  if (tiers.pending) reasons.push(`${tiers.pending}개 음식은 영양정보가 없어 합계에서 빠져 있어요.`);
  if (names) reasons.push(`${names}개 음식의 이름을 확인해 주세요.`);
  if (portions) reasons.push(`${portions}개 음식의 먹은 양을 골라주세요.`);
  if (estimates) reasons.push(`${estimates}개 음식의 무게는 추정 또는 직접 입력한 값이에요.`);
  reasons.push('영양정보 출처와 사진 속 음식·양의 정확도는 별도로 확인해요.');
  return { level: tiers.pending || names || portions ? 'low' : 'medium', label: tiers.pending || names || portions ? '확인할 내용이 있어요' : '입력 내용 확인 완료', reasons, tiers };
}
