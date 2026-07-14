// This module answers one question honestly: "how much should the person trust
// this specific reading?" It does not compute nutrition values — nutritionEngine.js
// already does that — it only cross-checks and labels the values that already exist,
// using signals the app already has:
//
//   1. Per item: did the food's numbers come from an official source / matched
//      database entry, or are they a photo-based guess with nothing to check them
//      against (isPendingInfo)?
//   2. Overall: does the live, on-screen estimate (cheap heuristic, updates ~1/sec)
//      roughly agree with the final analysis (OCR label + AI vision + database
//      lookup, computed once at capture)? A big gap between the two is itself useful
//      information — it means the quick preview and the careful analysis disagree,
//      which is worth surfacing rather than silently picking one number to show.

export const TRUST_TIER = {
  OFFICIAL: 'official',
  MATCHED: 'matched',
  ESTIMATED: 'estimated',
  PENDING: 'pending',
};

export const TRUST_TIER_LABEL = {
  [TRUST_TIER.OFFICIAL]: '공식 데이터',
  [TRUST_TIER.MATCHED]: 'DB 일치',
  [TRUST_TIER.ESTIMATED]: '사진 기반 추정',
  [TRUST_TIER.PENDING]: '확인 필요',
};

// Where a single food item's numbers actually came from. Mirrors the fields
// nutritionEngine.normalizeFoods() already attaches to every item.
export function classifyItemTrust(item) {
  if (!item) return TRUST_TIER.PENDING;
  if (item.isPendingInfo) return TRUST_TIER.PENDING;
  if (item.official) return TRUST_TIER.OFFICIAL;
  if (item.matched) return TRUST_TIER.MATCHED;
  return TRUST_TIER.ESTIMATED;
}

const AGREEMENT_BAND = [0.6, 1.6]; // live estimate is a cheap heuristic; only flag genuinely large gaps

/**
 * @param {ReturnType<typeof import('./nutritionEngine.js').analyzeMeal>} report final, captured-photo analysis
 * @param {{ calories: number, confidencePercent: number } | null} liveSnapshot the live estimate at the moment of capture
 */
export function assessMeasurementConfidence(report, liveSnapshot) {
  const items = Array.isArray(report?.items) ? report.items : [];
  const total = items.length;

  if (!total) {
    return {
      level: 'none',
      label: '측정값 없음',
      reasons: ['아직 인식된 음식이 없습니다.'],
      tiers: { official: 0, matched: 0, estimated: 0, pending: 0, total: 0 },
      agreement: null,
    };
  }

  const tiers = items.reduce(
    (acc, item) => {
      acc[classifyItemTrust(item)] += 1;
      return acc;
    },
    { official: 0, matched: 0, estimated: 0, pending: 0 },
  );

  const finalCalories = Math.round(report?.totals?.calories || 0);
  const liveCalories = Number.isFinite(liveSnapshot?.calories) ? Math.round(liveSnapshot.calories) : null;

  let agreement = null;
  if (liveCalories && liveCalories > 0 && finalCalories > 0) {
    const ratio = finalCalories / liveCalories;
    agreement = {
      ratio,
      agrees: ratio >= AGREEMENT_BAND[0] && ratio <= AGREEMENT_BAND[1],
      liveCalories,
      finalCalories,
    };
  }

  const reasons = [];
  let level;

  if (tiers.pending > 0) {
    level = 'low';
    reasons.push(
      tiers.pending === total
        ? '신뢰 가능한 DB에서 일치하는 값을 찾지 못해 전체 항목을 직접 확인해야 합니다.'
        : `${tiers.pending}개 항목은 DB에서 값을 찾지 못해 직접 확인이 필요합니다.`,
    );
  } else if (agreement && !agreement.agrees) {
    level = 'medium';
    reasons.push('실시간 화면 추정치와 정밀 분석 결과의 차이가 커요. 결과를 한 번 더 확인해주세요.');
  } else if (tiers.official + tiers.matched === total) {
    level = 'high';
    reasons.push('모든 항목이 공식 데이터베이스 값과 일치했습니다.');
  } else {
    level = 'medium';
    reasons.push(`${tiers.estimated}개 항목은 사진 기반 추정치예요.`);
  }

  if (agreement?.agrees) {
    reasons.push('실시간 추정치와 정밀 분석 결과가 서로 일치합니다.');
  }

  return {
    level, // 'high' | 'medium' | 'low' | 'none'
    label: { high: '신뢰도 높음', medium: '확인 권장', low: '직접 확인 필요', none: '측정값 없음' }[level],
    reasons,
    tiers: { ...tiers, total },
    agreement,
  };
}
