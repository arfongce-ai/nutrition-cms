export const MODE_LABELS = {
  adult: '성인',
  child: '아동',
  senior: '노인',
};

export const GUIDELINES = {
  kdri2025: {
    amdr: {
      carbohydrate: [50, 65],
      protein: [10, 20],
      fat: [15, 30],
    },
    sodiumCdrrMg: 2300,
    addedSugarEnergyPercentLimit: 10,
  },
  ksen: {
    trainingFluidMlPerHour: [500, 800],
  },
  issn: {
    strengthProteinGPerKg: [1.4, 2.0],
    leucineMealTargetMg: 3000,
    enduranceCarbGPerKg: [5, 10],
  },
  wadaKada: {
    riskyTerms: [
      '마황',
      '에페드린',
      'ephedrine',
      '반하',
      '보두',
      '스트리크닌',
      'strychnine',
      '호미카',
      '해외 직구',
      '부스터',
      'DMAA',
      'DMHA',
      'SARMs',
    ],
  },
};

const FOOD_DATABASE = [
  { keys: ['현미밥', '잡곡밥'], emoji: '밥', calories: 165, carb: 35, protein: 3.5, fat: 1.2, sodium: 5, sugar: 0.5, fiber: 2.3, leucine: 260 },
  { keys: ['흰쌀밥', '쌀밥', '공기밥'], emoji: '밥', calories: 155, carb: 34, protein: 2.7, fat: 0.3, sodium: 2, sugar: 0.1, fiber: 0.4, leucine: 210 },
  { keys: ['닭가슴살', '닭 가슴살'], emoji: '고기', calories: 165, carb: 0, protein: 31, fat: 3.6, sodium: 74, sugar: 0, fiber: 0, leucine: 2500 },
  { keys: ['샐러드', '채소'], emoji: '채소', calories: 35, carb: 7, protein: 1.8, fat: 0.3, sodium: 35, sugar: 2.5, fiber: 2.5, leucine: 90 },
  { keys: ['김치', '배추김치'], emoji: '김치', calories: 32, carb: 5, protein: 1.7, fat: 0.4, sodium: 640, sugar: 2, fiber: 1.8, leucine: 90 },
  { keys: ['된장찌개', '찌개'], emoji: '찌개', calories: 105, carb: 8, protein: 7.5, fat: 4.5, sodium: 725, sugar: 2, fiber: 1.5, leucine: 480 },
  { keys: ['계란', '달걀'], emoji: '계란', calories: 143, carb: 0.7, protein: 12.6, fat: 9.5, sodium: 142, sugar: 0.4, fiber: 0, leucine: 1080 },
  { keys: ['두부'], emoji: '두부', calories: 84, carb: 2.5, protein: 9.3, fat: 4.2, sodium: 7, sugar: 0.6, fiber: 0.3, leucine: 720 },
  { keys: ['바나나'], emoji: '과일', calories: 89, carb: 23, protein: 1.1, fat: 0.3, sodium: 1, sugar: 12, fiber: 2.6, leucine: 70 },
  { keys: ['고구마'], emoji: '고구마', calories: 128, carb: 30, protein: 1.4, fat: 0.2, sodium: 36, sugar: 6.4, fiber: 3, leucine: 80 },
  { keys: ['우유'], emoji: '우유', calories: 61, carb: 4.8, protein: 3.2, fat: 3.3, sodium: 43, sugar: 5.1, fiber: 0, leucine: 320 },
  { keys: ['웨이', '프로틴', '단백질'], emoji: '보충제', calories: 400, carb: 12, protein: 75, fat: 6, sodium: 420, sugar: 6, fiber: 0, leucine: 7800 },
];

export function createEmptyFoodItem() {
  return {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: '',
    grams: '100',
  };
}

export function createEmptyNutritionFacts() {
  return {
    foodName: '',
    servingSize: '',
    calories: '',
    carb: '',
    sugar: '',
    protein: '',
    fat: '',
    saturatedFat: '',
    transFat: '',
    sodium: '',
  };
}

export function parseNutritionText(text) {
  const source = String(text || '').replaceAll(',', '');
  return compactFacts({
    foodName: extractFoodName(source),
    calories: extractNumber(source, [
      /(?:열량|칼로리|kcal|calories?)\D{0,12}(\d+(?:\.\d+)?)/i,
      /(\d+(?:\.\d+)?)\s*kcal/i,
    ]),
    carb: extractNumber(source, [/(?:탄수화물|carbohydrate|carbs?)\D{0,12}(\d+(?:\.\d+)?)/i]),
    sugar: extractNumber(source, [/(?:당류|당|sugars?)\D{0,12}(\d+(?:\.\d+)?)/i]),
    protein: extractNumber(source, [/(?:단백질|protein)\D{0,12}(\d+(?:\.\d+)?)/i]),
    fat: extractNumber(source, [/(?:지방|총지방|total fat|fat)\D{0,12}(\d+(?:\.\d+)?)/i]),
    saturatedFat: extractNumber(source, [/(?:포화지방|saturated fat)\D{0,12}(\d+(?:\.\d+)?)/i]),
    transFat: extractNumber(source, [/(?:트랜스지방|trans fat)\D{0,12}(\d+(?:\.\d+)?)/i]),
    sodium: extractNumber(source, [/(?:나트륨|sodium)\D{0,12}(\d+(?:\.\d+)?)/i]),
  });
}

export function getBmiStatus(heightCm, weightKg) {
  const meters = Number(heightCm || 170) / 100;
  const bmi = Number(weightKg || 70) / Math.max(meters * meters, 0.1);
  if (bmi < 18.5) return '저체중';
  if (bmi < 23) return '정상';
  if (bmi < 25) return '과체중';
  return '비만';
}

export function analyzeMeal(profile, foodItems, nutritionFacts, options = {}) {
  const normalizedProfile = {
    ...profile,
    medical: Array.isArray(profile.medical) ? profile.medical : ['없음'],
    bmiStatus: profile.bmiStatus || getBmiStatus(profile.height, profile.weight),
  };

  const foods = normalizeFoods(foodItems);
  const facts = { ...createEmptyNutritionFacts(), ...nutritionFacts };
  const labelItem = createLabelItem(facts);
  const items = labelItem ? [...foods, labelItem] : foods;
  const totals = sumItems(items);
  const macroPercent = createMacroPercent(totals);
  const risk = evaluateRisk(normalizedProfile, items, facts, totals, macroPercent, options);
  const stamp = risk.red.length ? 'red' : risk.yellow.length ? 'yellow' : 'green';
  const messageParagraphs = createMessage(normalizedProfile, foods, labelItem, facts, totals, macroPercent, risk, stamp, options);

  return {
    analysisType: 'meal-with-label',
    profile: normalizedProfile,
    foods,
    facts,
    items,
    totals,
    macroPercent,
    risk,
    stamp,
    stampText: createStampText(risk, stamp),
    messageParagraphs,
    messageText: messageParagraphs.join(' '),
  };
}

function normalizeFoods(foodItems) {
  return (foodItems || [])
    .filter((item) => String(item.name || '').trim())
    .map((item) => {
      const grams = Math.max(toNumber(item.grams) || 100, 1);
      const base = findFood(item.name);
      const multiplier = grams / 100;
      return {
        id: item.id,
        type: '음식',
        name: item.name.trim(),
        grams,
        emoji: base.emoji,
        matched: base.matched,
        calories: round(base.calories * multiplier),
        carb: round(base.carb * multiplier),
        protein: round(base.protein * multiplier),
        fat: round(base.fat * multiplier),
        saturatedFat: round((base.saturatedFat || 0) * multiplier),
        transFat: round((base.transFat || 0) * multiplier),
        sodium: round(base.sodium * multiplier),
        sugar: round(base.sugar * multiplier),
        fiber: round(base.fiber * multiplier),
        leucine: round(base.leucine * multiplier),
      };
    });
}

function findFood(name) {
  const normalized = String(name || '').toLowerCase().replace(/\s/g, '');
  const found = FOOD_DATABASE.find((entry) => entry.keys.some((key) => normalized.includes(key.toLowerCase().replace(/\s/g, ''))));
  if (found) return { ...found, matched: true };
  return {
    emoji: '음식',
    matched: false,
    calories: 120,
    carb: 12,
    protein: 6,
    fat: 4,
    sodium: 120,
    sugar: 2,
    fiber: 1,
    leucine: 300,
  };
}

function createLabelItem(facts) {
  const hasNumbers = ['calories', 'carb', 'protein', 'fat', 'sodium', 'sugar'].some((key) => toNumber(facts[key]) > 0);
  if (!hasNumbers) return null;
  return {
    type: '영양성분표',
    name: facts.foodName || '포장식품',
    grams: 0,
    emoji: '라벨',
    calories: toNumber(facts.calories),
    carb: toNumber(facts.carb),
    protein: toNumber(facts.protein),
    fat: toNumber(facts.fat),
    saturatedFat: toNumber(facts.saturatedFat),
    transFat: toNumber(facts.transFat),
    sodium: toNumber(facts.sodium),
    sugar: toNumber(facts.sugar),
    fiber: 0,
    leucine: 0,
  };
}

function sumItems(items) {
  return items.reduce(
    (acc, item) => {
      acc.calories += Number(item.calories || 0);
      acc.carb += Number(item.carb || 0);
      acc.protein += Number(item.protein || 0);
      acc.fat += Number(item.fat || 0);
      acc.saturatedFat += Number(item.saturatedFat || 0);
      acc.transFat += Number(item.transFat || 0);
      acc.sodium += Number(item.sodium || 0);
      acc.sugar += Number(item.sugar || 0);
      acc.fiber += Number(item.fiber || 0);
      acc.leucine += Number(item.leucine || 0);
      return acc;
    },
    { calories: 0, carb: 0, protein: 0, fat: 0, saturatedFat: 0, transFat: 0, sodium: 0, sugar: 0, fiber: 0, leucine: 0 },
  );
}

function createMacroPercent(totals) {
  const estimatedEnergy = totals.carb * 4 + totals.protein * 4 + totals.fat * 9;
  const energy = Math.max(totals.calories || estimatedEnergy, 1);
  return {
    carb: Math.round(((totals.carb * 4) / energy) * 100),
    protein: Math.round(((totals.protein * 4) / energy) * 100),
    fat: Math.round(((totals.fat * 9) / energy) * 100),
    sugar: Math.round(((totals.sugar * 4) / energy) * 100),
  };
}

function evaluateRisk(profile, items, facts, totals, macroPercent, options) {
  const red = [];
  const yellow = [];
  const hasMedical = (term) => profile.medical.includes(term);
  const labelText = `${items.map((item) => item.name).join(' ')} ${facts.servingSize || ''} ${options.ocrText || ''}`.toLowerCase();
  const hasRiskyTerm = GUIDELINES.wadaKada.riskyTerms.some((term) => labelText.includes(term.toLowerCase()));
  const hasFood = items.some((item) => item.type === '음식');

  if (!hasFood) {
    yellow.push('음식명 확인 필요');
  }

  if (hasRiskyTerm) {
    red.push('KADA/WADA 금지성분 또는 부정이물 의심 항목');
  }

  if (hasMedical('고혈압') && totals.sodium >= 1200) {
    red.push('고혈압 사용자에게 높은 나트륨');
  } else if (totals.sodium >= 900) {
    yellow.push('한 끼 나트륨 주의');
  }

  if (hasMedical('당뇨') && (totals.sugar >= 18 || macroPercent.sugar > GUIDELINES.kdri2025.addedSugarEnergyPercentLimit)) {
    red.push('혈당 관리에 부담이 될 수 있는 당류');
  } else if (totals.sugar >= 15) {
    yellow.push('당류가 높은 식사');
  }

  if (hasMedical('만성신장질환') && (totals.protein >= 30 || totals.sodium >= 1000)) {
    red.push('콩팥 부담 가능성이 있는 단백질 또는 나트륨');
  }

  if (hasMedical('이상지질혈증') && (totals.saturatedFat >= 7 || totals.transFat > 0)) {
    red.push('혈중지질 관리에 불리한 포화지방 또는 트랜스지방');
  } else if (totals.saturatedFat >= 5 || totals.transFat > 0) {
    yellow.push('포화지방 또는 트랜스지방 주의');
  }

  if (['과체중', '비만'].includes(profile.bmiStatus) && totals.calories >= 750) {
    yellow.push('체중 감량 목표 대비 높은 한 끼 열량');
  }

  if (profile.sport === '근력파워' && totals.leucine > 0 && totals.leucine < GUIDELINES.issn.leucineMealTargetMg) {
    yellow.push('근력 운동 후 류신 목표 미달 가능성');
  }

  if (profile.sport === '지구력' && macroPercent.carb < 55 && totals.calories > 0) {
    yellow.push('지구력 운동 전후 탄수화물 보충 부족');
  }

  if (profile.mode === 'adult' && totals.calories > 0 && (totals.carb || totals.protein || totals.fat)) {
    const [carbMin, carbMax] = GUIDELINES.kdri2025.amdr.carbohydrate;
    if (macroPercent.carb < carbMin || macroPercent.carb > carbMax) {
      yellow.push('KDRI 탄수화물 에너지적정비율 범위 이탈');
    }
  }

  return { red: unique(red), yellow: unique(yellow) };
}

function createStampText(risk, stamp) {
  if (stamp === 'red') {
    return `[조심해요(빨간)] ${risk.red[0] || '안전 확인이 필요한 식사'} 때문에 섭취 전 확인이 필요합니다.`;
  }
  if (stamp === 'yellow') {
    return `[생각해요(노란)] ${risk.yellow[0] || '균형 보완이 필요한 식사'} 항목을 확인하세요.`;
  }
  return '[참 잘했어요(초록)] 현재 입력된 음식 중심 분석이 목표와 안전 기준에 잘 맞습니다.';
}

function createMessage(profile, foods, labelItem, facts, totals, macroPercent, risk, stamp, options) {
  if (profile.mode === 'child') return createChildMessage(foods, labelItem, stamp);
  if (profile.mode === 'senior') return createSeniorMessage(profile, totals, stamp);
  return createAdultMessage(profile, foods, labelItem, facts, totals, macroPercent, risk, options);
}

function createAdultMessage(profile, foods, labelItem, facts, totals, macroPercent, risk, options) {
  const weight = Math.max(Number(profile.weight || 70), 1);
  const sodiumRatio = Math.round((totals.sodium / GUIDELINES.kdri2025.sodiumCdrrMg) * 100);
  const paragraphs = [];

  if (!foods.length) {
    paragraphs.push('사진 촬영은 완료되었습니다. 음식명을 먼저 입력하면 음식 기준 영양 추정이 바로 시작됩니다. 포장식품이면 아래 영양성분표 숫자도 함께 입력해 더 정확하게 보정하세요.');
  } else if (risk.red.length) {
    paragraphs.push(`안전 필터에서 ${risk.red.join(', ')}이 감지되었습니다. 보충제, 한약, 해외 직구 제품은 KADA 금지약물검색 서비스 또는 Global DRO 확인 전까지 섭취를 보류하세요.`);
  } else {
    paragraphs.push(`음식 분석 기준으로 현재 탄수화물 ${macroPercent.carb}%, 단백질 ${macroPercent.protein}%, 지방 ${macroPercent.fat}%입니다. 2025 KDRI 성인 AMDR인 탄수화물 50~65%, 단백질 10~20%, 지방 15~30%와 비교했습니다.`);
  }

  paragraphs.push(`현재 합산 나트륨은 ${Math.round(totals.sodium)} mg으로 성인 CDRR 2,300 mg/일의 약 ${sodiumRatio}%입니다. 고혈압 이력이 있으면 국물류, 김치류, 가공식품을 같은 끼니에 겹치지 않게 조절하세요.`);

  if (labelItem) {
    paragraphs.push(`${facts.foodName || '포장식품'} 영양성분표도 함께 반영했습니다. 촬영 사진에서 글자가 자동 입력되지 않으면 숫자를 직접 고치면 리포트가 즉시 다시 계산됩니다.`);
  }

  if (profile.sport === '근력파워') {
    const target = GUIDELINES.issn.strengthProteinGPerKg.map((value) => Math.round(value * weight));
    paragraphs.push(`근력·파워 종목은 ISSN 기준 하루 단백질 약 ${target[0]}~${target[1]} g을 3~4시간 간격으로 나누는 전략이 유리합니다. 현재 단백질은 ${Math.round(totals.protein)} g입니다.`);
  } else if (profile.sport === '팀스포츠') {
    paragraphs.push('팀스포츠는 반복 고강도 움직임 때문에 탄수화물과 전해질 보충이 중요합니다. 운동 전후에는 탄수화물과 수분을 함께 확인하세요.');
  } else if (profile.sport === '지구력') {
    const carbs = GUIDELINES.issn.enduranceCarbGPerKg.map((value) => Math.round(value * weight));
    paragraphs.push(`지구력 종목은 훈련량에 따라 하루 탄수화물 ${carbs[0]}~${carbs[1]} g 수준이 필요할 수 있습니다. 장시간 훈련 중에는 시간당 500~800 ml 수분·전해질도 함께 확인하세요.`);
  }

  return paragraphs;
}

function createChildMessage(foods, labelItem, stamp) {
  const name = foods[0]?.name || labelItem?.name || '오늘 음식';
  if (stamp === 'red') {
    return [
      `${name}은 혼자 먹기 전에 어른에게 먼저 보여주는 게 좋아요.`,
      '너무 달거나 짠 음식, 알 수 없는 가루는 몸을 피곤하게 만들 수 있어요.',
      '보충제나 알약보다 밥, 고기, 과일, 우유 같은 진짜 음식을 먼저 먹자.',
      '[엄마·아빠에게 알림장 보내기] 오늘 식단 카드를 보호자에게 보내주세요.',
    ];
  }
  if (stamp === 'yellow') {
    return [
      `${name}은 조금만 더 생각해서 먹으면 더 좋아요.`,
      '달콤하거나 짠맛이 강하면 물을 마시고 다음 식사에는 채소 친구도 함께 먹자.',
      '밥, 단백질 반찬, 과일을 골고루 먹으면 키도 쑥쑥 자라고 운동할 힘도 생겨요.',
      '[엄마·아빠에게 알림장 보내기] 오늘 식단 카드를 보호자에게 보내주세요.',
    ];
  }
  return [
    `${name}은 오늘 기준으로 괜찮아 보여요.`,
    '그래도 한 가지 음식만 많이 먹기보다 여러 음식을 골고루 먹는 게 좋아요.',
    '다음 식사에는 채소와 물도 함께 챙기면 더 멋진 건강 대장이 될 수 있어요.',
    '[엄마·아빠에게 알림장 보내기] 오늘 식단 카드를 보호자에게 보내주세요.',
  ];
}

function createSeniorMessage(profile, totals, stamp) {
  const paragraphs = [];
  const has = (term) => profile.medical.includes(term);

  paragraphs.push(stamp === 'red' ? '어르신, 이 식사는 조심하셔야 해요.' : stamp === 'yellow' ? '어르신, 이 식사는 조금만 조절하면 더 좋아요.' : '어르신, 이 식사는 전반적으로 괜찮아 보여요.');

  if (has('당뇨')) {
    paragraphs.push('당류가 높은 음식은 혈당을 빠르게 올릴 수 있어요.');
    paragraphs.push('드신 뒤에는 물을 한 잔 마시고 가볍게 걸어주세요.');
  }

  if (has('고혈압') || totals.sodium >= 900) {
    paragraphs.push('나트륨이 높은 식사는 혈압에 부담이 될 수 있어요.');
    paragraphs.push('오늘은 국물과 김치를 조금 덜 드시는 편이 좋습니다.');
  }

  if (has('만성신장질환')) {
    paragraphs.push('콩팥이 약하시면 단백질과 나트륨 숫자를 꼭 확인하셔야 해요.');
    paragraphs.push('단백질 가루나 진한 한약은 의료진과 상의한 뒤 드세요.');
  }

  if (paragraphs.length < 4) {
    paragraphs.push('한 번에 많이 드시기보다 식사와 함께 천천히 드세요.');
    paragraphs.push('운동하신 날에는 물을 조금씩 자주 마시는 것이 좋습니다.');
  }

  return paragraphs;
}

function extractFoodName(text) {
  const lines = String(text || '')
    .split(/\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 2 && line.length <= 32);
  const rejected = /(영양|성분|nutrition|calories?|나트륨|탄수화물|단백질|지방|당류)/i;
  return lines.find((line) => !rejected.test(line)) || '';
}

function extractNumber(text, patterns) {
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

function compactFacts(facts) {
  return Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== '' && value != null));
}

function toNumber(value) {
  const parsed = Number(String(value ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function unique(items) {
  return [...new Set(items)];
}
