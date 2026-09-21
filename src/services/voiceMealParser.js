const KOREAN_PORTION_NUMBERS = {
  반: 0.5,
  한: 1,
  하나: 1,
  두: 2,
  둘: 2,
  세: 3,
  셋: 3,
  네: 4,
  넷: 4,
};

const PORTION_PATTERN = /(반|한|하나|두|둘|세|셋|네|넷|\d+(?:\.\d+)?)\s*(그릇|공기|인분|접시|개|잔|컵|캔|봉)/u;
const PORTION_PATTERN_GLOBAL = /(반|한|하나|두|둘|세|셋|네|넷|\d+(?:\.\d+)?)\s*(?:그릇|공기|인분|접시|개|잔|컵|캔|봉)/gu;

export function parseVoiceMealFoods(transcript) {
  return String(transcript || '')
    .split(/\s+(?:그리고|하고|랑|과|와)\s+|(?:이랑|하고)\s+|[,，]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const gramsMatch = part.match(/(\d+(?:\.\d+)?)\s*(?:g|그램)/i);
      const portionMatch = part.match(PORTION_PATTERN);
      const name = part
        .replace(/(\d+(?:\.\d+)?)\s*(?:g|그램)/gi, '')
        .replace(PORTION_PATTERN_GLOBAL, '')
        .replace(/(?:먹었어요|먹었어|먹었습니다|섭취했어요|섭취했습니다)$/u, '')
        .replace(/^[\s'"“”‘’]+|[\s'"“”‘’]+$/gu, '')
        .trim();

      return {
        name,
        grams: gramsMatch?.[1] || '',
        portionAmount: parseKoreanPortionAmount(portionMatch?.[1]),
        portionUnit: portionMatch?.[2] || '',
      };
    })
    .filter((food) => food.name);
}

export function getVoiceUnitDefaultGrams(unit) {
  if (unit === '공기') return 210;
  if (unit === '접시') return 300;
  if (unit === '개') return 60;
  if (unit === '잔' || unit === '컵') return 250;
  if (unit === '캔') return 355;
  if (unit === '봉') return 100;
  return 500;
}

function parseKoreanPortionAmount(value) {
  if (value in KOREAN_PORTION_NUMBERS) return KOREAN_PORTION_NUMBERS[value];
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}
