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
  ksso: {
    dailyDeficitKcal: [500, 1000],
  },
  ksen: {
    trainingFluidMlPerHour: [500, 800],
  },
  issn: {
    strengthProteinGPerKg: [1.4, 2.0],
    leucineMealTargetMg: 3000,
    enduranceCarbGPerKg: [5, 10],
    caffeineMgPerKg: [3, 6],
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

export const SCENARIOS = {
  balanced: [
    {
      type: '식단',
      name: '현미밥 반 공기',
      emoji: '🍚',
      calories: 165,
      carb: 35,
      protein: 3.5,
      fat: 1.2,
      sodium: 5,
      sugar: 0.5,
      fiber: 2.3,
      leucine: 260,
    },
    {
      type: '식단',
      name: '닭가슴살 샐러드',
      emoji: '🥗',
      calories: 290,
      carb: 13,
      protein: 36,
      fat: 10,
      sodium: 520,
      sugar: 4,
      fiber: 5.8,
      leucine: 2550,
    },
    {
      type: '식단',
      name: '배추김치',
      emoji: '🥬',
      calories: 32,
      carb: 5,
      protein: 1.7,
      fat: 0.4,
      sodium: 640,
      sugar: 2,
      fiber: 1.8,
      leucine: 90,
    },
  ],
  highSodium: [
    {
      type: '식단',
      name: '흰쌀밥',
      emoji: '🍚',
      calories: 310,
      carb: 68,
      protein: 5.2,
      fat: 0.6,
      sodium: 3,
      sugar: 0.2,
      fiber: 0.8,
      leucine: 360,
    },
    {
      type: '식단',
      name: '된장찌개',
      emoji: '🥘',
      calories: 210,
      carb: 16,
      protein: 15,
      fat: 9,
      sodium: 1450,
      sugar: 4,
      fiber: 3,
      leucine: 970,
    },
    {
      type: '식단',
      name: '배추김치',
      emoji: '🥬',
      calories: 36,
      carb: 6,
      protein: 1.8,
      fat: 0.5,
      sodium: 760,
      sugar: 2.4,
      fiber: 2,
      leucine: 95,
    },
  ],
  sportsRecovery: [
    {
      type: '식단',
      name: '바나나',
      emoji: '🍌',
      calories: 105,
      carb: 27,
      protein: 1.3,
      fat: 0.3,
      sodium: 1,
      sugar: 14,
      fiber: 3,
      leucine: 70,
    },
    {
      type: '보충제',
      name: '국내 인증 웨이프로틴',
      emoji: '🥛',
      calories: 130,
      carb: 4,
      protein: 24,
      fat: 2,
      sodium: 140,
      sugar: 2,
      fiber: 0,
      leucine: 2600,
    },
    {
      type: '식단',
      name: '고구마',
      emoji: '🍠',
      calories: 180,
      carb: 42,
      protein: 2.5,
      fat: 0.2,
      sodium: 48,
      sugar: 10,
      fiber: 5,
      leucine: 130,
    },
  ],
  dopingRisk: [
    {
      type: '보충제',
      name: '해외 직구 부스터 파우더',
      emoji: '⚠️',
      calories: 35,
      carb: 8,
      protein: 0,
      fat: 0,
      sodium: 180,
      sugar: 4,
      fiber: 0,
      leucine: 0,
    },
    {
      type: '한약',
      name: '마황 성분 다이어트 한약',
      emoji: '🌿',
      calories: 0,
      carb: 0,
      protein: 0,
      fat: 0,
      sodium: 0,
      sugar: 0,
      fiber: 0,
      leucine: 0,
    },
  ],
};

export function getBmiStatus(heightCm, weightKg) {
  const meters = Number(heightCm || 170) / 100;
  const bmi = Number(weightKg || 70) / Math.max(meters * meters, 0.1);
  if (bmi < 18.5) return '저체중';
  if (bmi < 23) return '정상';
  if (bmi < 25) return '과체중';
  return '비만';
}

export function analyzeMeal(profile, items) {
  const normalizedProfile = {
    ...profile,
    bmiStatus: profile.bmiStatus || getBmiStatus(profile.height, profile.weight),
  };

  const totals = items.reduce(
    (acc, item) => {
      acc.calories += Number(item.calories || 0);
      acc.carb += Number(item.carb || 0);
      acc.protein += Number(item.protein || 0);
      acc.fat += Number(item.fat || 0);
      acc.sodium += Number(item.sodium || 0);
      acc.sugar += Number(item.sugar || 0);
      acc.fiber += Number(item.fiber || 0);
      acc.leucine += Number(item.leucine || 0);
      return acc;
    },
    { calories: 0, carb: 0, protein: 0, fat: 0, sodium: 0, sugar: 0, fiber: 0, leucine: 0 },
  );

  const energy = Math.max(totals.calories, 1);
  const macroPercent = {
    carb: Math.round(((totals.carb * 4) / energy) * 100),
    protein: Math.round(((totals.protein * 4) / energy) * 100),
    fat: Math.round(((totals.fat * 9) / energy) * 100),
    sugar: Math.round(((totals.sugar * 4) / energy) * 100),
  };

  const risk = evaluateRisk(normalizedProfile, items, totals, macroPercent);
  const stamp = risk.red.length ? 'red' : risk.yellow.length ? 'yellow' : 'green';
  const messageParagraphs = createMessage(normalizedProfile, items, totals, macroPercent, risk, stamp);

  return {
    profile: normalizedProfile,
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

function evaluateRisk(profile, items, totals, macroPercent) {
  const red = [];
  const yellow = [];
  const names = items.map((item) => item.name || '').join(' ');
  const lowerNames = names.toLowerCase();
  const hasTerm = (terms) => terms.some((term) => lowerNames.includes(term.toLowerCase()));
  const hasMedical = (term) => profile.medical.includes(term);

  if (hasTerm(GUIDELINES.wadaKada.riskyTerms)) {
    red.push('KADA/WADA 금지성분 또는 부정이물 의심 항목');
  }

  if (hasMedical('고혈압') && totals.sodium >= 1200) {
    red.push('고혈압 사용자의 고나트륨 식사');
  } else if (totals.sodium >= 900) {
    yellow.push('한 끼 나트륨 주의');
  }

  if (hasMedical('당뇨') && (macroPercent.sugar > GUIDELINES.kdri2025.addedSugarEnergyPercentLimit || names.includes('흰쌀밥'))) {
    red.push('혈당을 빠르게 올릴 수 있는 식사');
  } else if (macroPercent.sugar > GUIDELINES.kdri2025.addedSugarEnergyPercentLimit) {
    yellow.push('당류 비율 주의');
  }

  if (hasMedical('만성신장질환') && (totals.protein >= 30 || names.includes('프로틴'))) {
    red.push('콩팥 부담 가능성이 있는 고단백 식사');
  }

  if (['과체중', '비만'].includes(profile.bmiStatus) && totals.calories >= 750) {
    yellow.push('체중 감량 목표 대비 높은 한 끼 열량');
  }

  if (profile.sport === '근력파워' && totals.leucine < GUIDELINES.issn.leucineMealTargetMg) {
    yellow.push('근력 운동 후 류신 목표 미달 가능성');
  }

  if (profile.sport === '지구력' && macroPercent.carb < 55) {
    yellow.push('지구력 운동 전후 탄수화물 보충 부족');
  }

  if (profile.sport === '팀스포츠' && totals.carb < 45) {
    yellow.push('반복 고강도 운동을 위한 글리코겐 보충 부족');
  }

  const [carbMin, carbMax] = GUIDELINES.kdri2025.amdr.carbohydrate;
  if (profile.mode === 'adult' && (macroPercent.carb < carbMin || macroPercent.carb > carbMax)) {
    yellow.push('KDRI 탄수화물 에너지적정비율 범위 이탈');
  }

  return { red, yellow };
}

function createStampText(risk, stamp) {
  if (stamp === 'red') {
    return `[조심해요(빨간)] ${risk.red[0] || '안전 확인이 필요한 식사'} 때문에 즉시 조정이 필요합니다.`;
  }
  if (stamp === 'yellow') {
    return `[생각해요(노란)] ${risk.yellow[0] || '균형 보완이 필요한 식사'} 항목을 확인하세요.`;
  }
  return '[참 잘했어요(초록)] 오늘 식사는 현재 목표와 안전 기준에 잘 맞습니다.';
}

function createMessage(profile, items, totals, macroPercent, risk, stamp) {
  if (profile.mode === 'child') return createChildMessage(items, stamp);
  if (profile.mode === 'senior') return createSeniorMessage(profile, items, totals, stamp);
  return createAdultMessage(profile, items, totals, macroPercent, risk);
}

function createAdultMessage(profile, items, totals, macroPercent, risk) {
  const weight = Math.max(Number(profile.weight || 70), 1);
  const sodiumRatio = Math.round((totals.sodium / GUIDELINES.kdri2025.sodiumCdrrMg) * 100);
  const paragraphs = [];

  if (risk.red.length) {
    paragraphs.push(`KADA/WADA 안전 필터에서 ${risk.red.join(', ')}이 감지되었습니다. 성분 불명 해외 보충제나 한약재는 KADA 금지약물검색 서비스 또는 Global DRO 확인 전까지 섭취를 보류하세요.`);
  } else {
    paragraphs.push(`2025 KDRI AMDR 기준으로 현재 탄수화물 ${macroPercent.carb}%, 단백질 ${macroPercent.protein}%, 지방 ${macroPercent.fat}%입니다. 성인 권장 범위인 탄수화물 50~65%, 단백질 10~20%, 지방 15~30%와 비교해 평가했습니다.`);
  }

  paragraphs.push(`나트륨은 ${Math.round(totals.sodium)} mg으로 성인 CDRR 2,300 mg/일의 약 ${sodiumRatio}%입니다. 고혈압 이력이 있거나 국물류가 포함된 날에는 국물 섭취를 줄이고 채소와 수분을 함께 배치하세요.`);

  if (profile.sport === '근력파워') {
    const target = GUIDELINES.issn.strengthProteinGPerKg.map((value) => Math.round(value * weight));
    paragraphs.push(`근력·파워 종목은 ISSN 기준 하루 단백질 약 ${target[0]}~${target[1]} g을 3~4시간 간격으로 나누는 전략이 유리합니다. 이 식사의 류신은 ${Math.round(totals.leucine)} mg입니다.`);
  } else if (profile.sport === '팀스포츠') {
    const caffeine = GUIDELINES.issn.caffeineMgPerKg.map((value) => Math.round(value * weight));
    paragraphs.push(`팀스포츠는 반복 고강도 움직임 때문에 글리코겐 재충전과 전해질 관리가 중요합니다. 카페인은 체중 기준 약 ${caffeine[0]}~${caffeine[1]} mg 범위가 전략 섭취 범위지만, 고혈압 이력이 있으면 피하세요.`);
  } else if (profile.sport === '지구력') {
    const carbs = GUIDELINES.issn.enduranceCarbGPerKg.map((value) => Math.round(value * weight));
    paragraphs.push(`지구력 종목은 훈련량에 따라 하루 탄수화물 ${carbs[0]}~${carbs[1]} g 수준의 로딩 전략이 필요할 수 있습니다. 장시간 훈련 중에는 시간당 500~800 ml 수분·전해질 보충을 함께 확인하세요.`);
  } else {
    paragraphs.push('오늘 식단은 체중 관리와 생활 체육 모두에 적용할 수 있는 기본 평가입니다. 보충제는 성분표와 인증 여부가 확인된 제품만 사용하세요.');
  }

  return paragraphs;
}

function createChildMessage(items, stamp) {
  const names = items.map((item) => item.name || '').join(', ');
  if (stamp === 'red') {
    return [
      '오늘 음식 중에 어린이가 혼자 먹으면 안 되는 가루나 한약이 보여요.',
      '운동을 잘하고 싶어도 알 수 없는 가루보다 밥, 고기, 과일 친구를 먼저 먹는 게 몸을 튼튼하게 해줘요.',
      `지금은 꼭 엄마, 아빠, 선생님께 "${names}"를 보여주고 먹어도 되는지 물어보자.`,
      '[엄마·아빠에게 알림장 보내기] 오늘 식단 카드를 보호자에게 보내주세요.',
    ];
  }
  if (stamp === 'yellow') {
    return [
      '오늘은 잘 먹었지만 조금만 더 생각하면 더 튼튼해질 수 있어요.',
      '짠 국물이나 단 간식은 몸이 금방 피곤해질 수 있으니 다음에는 조금만 먹어보자.',
      '밥, 고기, 채소, 과일 친구를 골고루 먹으면 키도 쑥쑥 자라고 운동할 힘도 생겨요.',
      '[엄마·아빠에게 알림장 보내기] 오늘 식단 카드를 보호자에게 보내주세요.',
    ];
  }
  return [
    '와, 오늘 식사는 참 잘했어요!',
    '몸을 튼튼하게 만드는 반찬과 힘을 내는 밥을 함께 먹어서 아주 좋아요.',
    '다음 식사에도 채소 친구를 한 입 더 먹으면 더 멋진 건강 대장이 될 수 있어요.',
    '[엄마·아빠에게 알림장 보내기] 오늘 식단 카드를 보호자에게 보내주세요.',
  ];
}

function createSeniorMessage(profile, items, totals, stamp) {
  const paragraphs = [];
  const has = (term) => profile.medical.includes(term);
  const hasSupplement = items.some((item) => item.type === '보충제' || item.type === '한약');

  paragraphs.push(stamp === 'red' ? '어르신, 오늘 식사는 조심하셔야 해요.' : stamp === 'yellow' ? '어르신, 오늘 식사는 조금만 조절하면 더 좋아요.' : '어르신, 오늘 식사는 전반적으로 잘 챙기셨어요.');

  if (has('당뇨')) {
    paragraphs.push('혈당이 빨리 오르지 않게 흰쌀밥은 한 숟가락만 덜어 드세요.');
    paragraphs.push('식사 후에는 가볍게 걷고 물을 한 잔 드시면 좋아요.');
  }

  if (has('고혈압') || totals.sodium >= 900) {
    paragraphs.push('혈압 관리를 위해 국물은 남겨주세요.');
    paragraphs.push('김치와 찌개를 함께 드신 날은 다음 끼니를 싱겁게 드시는 게 좋습니다.');
  }

  if (has('만성신장질환')) {
    paragraphs.push('콩팥이 약하시면 단백질 가루와 진한 한약은 꼭 의료진과 상의하세요.');
    paragraphs.push('칼륨과 인을 제한해야 하는 단계인지 먼저 확인하는 것이 안전합니다.');
  }

  if (hasSupplement) {
    paragraphs.push('검증되지 않은 가루나 약재는 간과 콩팥에 무리를 줄 수 있어요.');
    paragraphs.push('드시기 전에 의사나 약사에게 제품명을 보여주세요.');
  }

  if (paragraphs.length < 4) {
    paragraphs.push('근육이 줄지 않도록 계란, 두부, 생선 같은 부드러운 단백질을 조금씩 챙겨주세요.');
    paragraphs.push('운동하신 날에는 땀으로 빠진 수분을 보충하기 위해 물을 천천히 드세요.');
  }

  return paragraphs;
}
