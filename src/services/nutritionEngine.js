import { findOfficialBrandFood, findOfficialNutritionSources, getSafetyReferenceSource } from './officialNutritionSources.js';
import { findOfficialProductFood, findOfficialProductSources } from './officialProductDatabase.js';

export const SYSTEM_PROMPT = `
당신은 대한민국 최고의 AI 메디-스포츠 영양 코치이며, 한국 식약처 데이터 및 외식/식음료 메뉴 분석 전문가입니다.
제공된 이미지를 분석할 때 다음 5대 원칙을 실시간으로 반드시 적용하십시오:

1. [UI 간섭 배제] 이미지 내에 존재하는 카메라 초점용 원형 선, 안내선, 격자 등의 UI 그래픽 요소는 시스템 화면이므로 분석에서 완전히 제외하십시오.
2. [오인식 방지] 그릇에 담긴 국물 요리(예: 시래기국, 된장찌개 등)의 건더기 질감과 물 표면의 반사광을 '과자 봉지나 비닐 포장지'로 오인하지 마십시오.
3. [카테고리 3원화 분류 및 매핑]:
   - 트랙 A (가공식품/식음료): 브랜드 패키지, 과자, 음료수 등은 전면의 제품명 텍스트(OCR)를 기반으로 식약처 공공 데이터베이스와 매칭합니다.
   - 트랙 B (외식/직접 조리): 국, 반찬, 찌개 등 그릇에 담긴 음식은 그릇(Bowl)과 식기류의 맥락을 함께 파악하여 '조리된 외식 메뉴'로 분류합니다.
   - 트랙 C (성분표/첨가물): 영양성분표와 원재료명은 OCR 숫자, 첨가물 용어, 알레르기 표시를 분리해 제품 DB와 교차 확인합니다.
4. [데이터 엔진 근거 기준]: 분석된 결과는 반드시 다음 순서의 데이터 기준을 충족해야 합니다.
   - 보건복지부 2025 KDRI (한국인 영양소 섭취기준)
   - 대한비만학회 KSSO 가이드라인
5. [출력 포맷 규격화]: 분석 결과는 반드시 사용자의 칼로리, 탄단지, 나트륨(mg)이 포함된 정제된 JSON 형태로 반환하십시오.
6. [성분 미확인 시 예외 처리]: 정확한 영양 성분을 신뢰 가능한 DB에서 찾을 수 없으면 수치를 지어내지 말고 isPendingInfo: true로 표시하십시오. 이때 calories, carbohydrates, protein, fat, sodium은 모두 0으로 처리합니다.
`;

export const STRICT_ANALYSIS_RULES = {
  pendingPolicy: '신뢰 가능한 DB 값을 찾지 못하면 isPendingInfo true로 표시하고 영양값은 모두 0으로 처리합니다.',
  requiredJsonShape: {
    foodName: '',
    isPendingInfo: true,
    servingSizeGrams: 0,
    nutrients: {
      calories: 0,
      carbohydrates: 0,
      protein: 0,
      fat: 0,
      sodium: 0,
    },
  },
  evidenceBase: ['2025 KDRI', 'KSSO'],
};

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
  { keys: ['방울토마토', '토마토'], emoji: '토마토', calories: 18, carb: 3.9, protein: 0.9, fat: 0.2, sodium: 5, sugar: 2.6, fiber: 1.2, leucine: 27 },
  { keys: ['고구마'], emoji: '고구마', calories: 128, carb: 30, protein: 1.4, fat: 0.2, sodium: 36, sugar: 6.4, fiber: 3, leucine: 80 },
  { keys: ['우유'], emoji: '우유', calories: 61, carb: 4.8, protein: 3.2, fat: 3.3, sodium: 43, sugar: 5.1, fiber: 0, leucine: 320 },
  { keys: ['요거트', '요구르트', 'yogurt', 'yoghurt'], emoji: '요거트', calories: 63, carb: 7, protein: 3.5, fat: 2.5, sodium: 46, sugar: 6.5, fiber: 0, leucine: 310 },
  { keys: ['견과류', '아몬드', '호두', '캐슈넛', 'nuts', 'almond', 'walnut'], emoji: '견과', calories: 607, carb: 20, protein: 20, fat: 54, saturatedFat: 5, transFat: 0, sodium: 8, sugar: 4.5, fiber: 8, leucine: 1400 },
  { keys: ['아메리카노', '블랙커피', '커피', 'americano', 'blackcoffee'], emoji: '커피', calories: 3, carb: 0.5, protein: 0.2, fat: 0, sodium: 1.5, sugar: 0, fiber: 0, leucine: 0 },
  { keys: ['카페라떼', '카페 라떼', '라떼', 'latte', 'cafelatte'], emoji: '커피', calories: 42, carb: 3.5, protein: 2, fat: 2, saturatedFat: 1.3, transFat: 0, sodium: 28, sugar: 2.6, fiber: 0, leucine: 140 },
  { keys: ['밀크티', '버블티', 'milk tea', 'milktea'], emoji: '음료', calories: 59, carb: 10, protein: 1.5, fat: 1.5, saturatedFat: 1.1, transFat: 0, sodium: 34, sugar: 8, fiber: 0, leucine: 105 },
  { keys: ['스무디', '프라페', 'smoothie', 'frappe'], emoji: '음료', calories: 56, carb: 12, protein: 0.7, fat: 0.6, saturatedFat: 0.3, transFat: 0, sodium: 24, sugar: 10, fiber: 0.4, leucine: 35 },
  { keys: ['과일음료', '에이드', '주스', '쥬스', 'juice', 'ade'], emoji: '음료', calories: 45, carb: 11, protein: 0.2, fat: 0, sodium: 8, sugar: 10, fiber: 0.2, leucine: 5 },
  { keys: ['제로 탄산음료', '제로콜라', '제로사이다', 'zero soda', 'zero coke'], emoji: '음료', calories: 0, carb: 0, protein: 0, fat: 0, sodium: 6, sugar: 0, fiber: 0, leucine: 0 },
  { keys: ['탄산음료', '콜라', '사이다', '스프라이트', 'cola', 'coke', 'soda', 'sprite'], emoji: '음료', calories: 40, carb: 10.5, protein: 0, fat: 0, sodium: 6, sugar: 10.5, fiber: 0, leucine: 0 },
  { keys: ['웨이', '프로틴', '단백질'], emoji: '보충제', calories: 400, carb: 12, protein: 75, fat: 6, sodium: 420, sugar: 6, fiber: 0, leucine: 7800 },
  { keys: ['나쵸', '나초', 'nacho', '타코', 'taco', '스낵', '과자', '칩', 'chip', 'snack'], emoji: '스낵', calories: 518, carb: 63, protein: 6.5, fat: 27, saturatedFat: 10.8, transFat: 0, sodium: 500, sugar: 5.4, fiber: 4, leucine: 420 },
];

const ALLERGEN_TERMS = [
  '난류',
  '계란',
  '달걀',
  '우유',
  '메밀',
  '땅콩',
  '대두',
  '밀',
  '고등어',
  '게',
  '새우',
  '돼지고기',
  '복숭아',
  '토마토',
  '아황산',
  '호두',
  '닭고기',
  '쇠고기',
  '소고기',
  '오징어',
  '조개',
  '굴',
  '전복',
  '홍합',
  '잣',
];

const SUPPLEMENT_REVIEW_TERMS = [
  '보충제',
  '프로틴',
  '웨이',
  '부스터',
  '크레아틴',
  'bcaa',
  'eaa',
  '마이프로틴',
  '셀렉스',
  '칼로바이',
  '스포맥스',
  '정관장',
  '홍삼',
  '한약',
  '한약재',
  '마황',
  '반하',
  '보두',
  '호미카',
];

const ADDITIVE_RULES = [
  {
    category: '보존료',
    terms: ['소르빈산', '소르빈산칼륨', '안식향산', '안식향산나트륨', '보존료'],
    caution: '보관성을 높이는 첨가물 후보입니다. 가공식품 섭취 빈도와 총량을 확인하세요.',
  },
  {
    category: '감미료',
    terms: ['아스파탐', '수크랄로스', '아세설팜칼륨', '사카린', '스테비올배당체', '감미료'],
    caution: '단맛을 내는 첨가물 후보입니다. 당뇨 관리 중이거나 아동은 섭취 빈도를 확인하세요.',
  },
  {
    category: '착색료',
    terms: ['타르색소', '식용색소', '착색료', '황색4호', '황색5호', '적색40호', '청색1호'],
    caution: '색을 내는 첨가물 후보입니다. 민감 체질이나 아동은 제품 표시를 한 번 더 확인하세요.',
  },
  {
    category: '향미증진제',
    terms: ['L-글루탐산나트륨', '글루탐산나트륨', 'MSG', '향미증진제', "5'-리보뉴클레오티드이나트륨"],
    caution: '맛을 강화하는 첨가물 후보입니다. 나트륨 관리가 필요하면 함께 확인하세요.',
  },
  {
    category: '유화제/증점제',
    terms: ['유화제', '증점제', '카라기난', '잔탄검', 'CMC', '카복시메틸셀룰로스'],
    caution: '식감을 안정화하는 첨가물 후보입니다. 위장 민감도가 있으면 섭취 후 반응을 확인하세요.',
  },
  {
    category: '산도조절제/인산염',
    terms: ['산도조절제', '구연산', '인산염', '폴리인산나트륨', '피로인산나트륨'],
    caution: '산도나 식감을 조절하는 첨가물 후보입니다. 신장질환이 있으면 인산염 표기를 확인하세요.',
  },
  {
    category: '산화방지제',
    terms: ['산화방지제', 'BHA', 'BHT', '토코페롤'],
    caution: '품질 변화를 줄이는 첨가물 후보입니다. 제품 원재료명을 확인하세요.',
  },
  {
    category: '발색제',
    terms: ['아질산나트륨', '아질산염', '발색제'],
    caution: '가공육 등에 쓰이는 발색제 후보입니다. 가공육 섭취 빈도를 줄이는 것이 좋습니다.',
  },
  {
    category: '아황산류',
    terms: ['아황산', '이산화황', '메타중아황산나트륨', '아황산류'],
    caution: '알레르기 민감자에게 문제가 될 수 있는 표시 성분 후보입니다. 알레르기 이력이 있으면 주의하세요.',
  },
  {
    category: '카페인',
    terms: ['카페인', '고카페인'],
    caution: '카페인 후보입니다. 아동, 임산부, 고혈압 관리 중인 사용자는 섭취량을 확인하세요.',
  },
];

export function createEmptyFoodItem() {
  return {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: '',
    grams: '100',
    perServing: false,
  };
}

export function createEstimatedFoodItem() {
  return {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: '촬영 음식',
    grams: '250',
    estimated: true,
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
  const source = normalizeNutritionOcrText(text);
  const parsed = {
    foodName: extractFoodName(source),
    calories: extractNutritionValue(source, ['열량', '칼로리', 'calories', 'calorie'], ['kcal', '㎉']) || extractNumber(source, [
      /(?:열량|칼로리|calories?)\D{0,20}(\d+(?:\.\d+)?)/i,
      /(\d+(?:\.\d+)?)\s*(?:kcal|㎉|칼로리)/i,
    ]),
    carb: extractNutritionValue(source, ['탄수화물', '탄수', 'carbohydrate', 'carbs'], ['g']) || extractNumber(source, [/(?:탄수화물|탄수|carbohydrate|carbs?)\D{0,20}(\d+(?:\.\d+)?)/i]),
    sugar: extractNutritionValue(source, ['당류', '당', 'sugars', 'sugar'], ['g']) || extractNumber(source, [/(?:당류|당|sugars?)\D{0,20}(\d+(?:\.\d+)?)/i]),
    protein: extractNutritionValue(source, ['단백질', 'protein'], ['g']) || extractNumber(source, [/(?:단백질|protein)\D{0,20}(\d+(?:\.\d+)?)/i]),
    fat: extractNutritionValue(source, ['총지방', '지방', 'total fat', 'fat'], ['g']) || extractNumber(source, [/(?:총지방|지방|total fat|fat)\D{0,20}(\d+(?:\.\d+)?)/i]),
    saturatedFat: extractNutritionValue(source, ['포화지방', 'saturated fat'], ['g']) || extractNumber(source, [/(?:포화지방|saturated fat)\D{0,20}(\d+(?:\.\d+)?)/i]),
    transFat: extractNutritionValue(source, ['트랜스지방', 'trans fat'], ['g']) || extractNumber(source, [/(?:트랜스지방|trans fat)\D{0,20}(\d+(?:\.\d+)?)/i]),
    sodium: extractNutritionValue(source, ['나트륨', 'sodium'], ['mg']) || extractNumber(source, [/(?:나트륨|sodium)\D{0,20}(\d+(?:\.\d+)?)/i]),
  };

  return compactFacts(sanitizeNutritionFacts(parsed));
}

function normalizeNutritionOcrText(text) {
  return String(text || '')
    .replaceAll(',', '')
    .replace(/([가-힣A-Za-z])\s+(\d)/g, '$1 $2')
    .replace(/(\d)\s*(kcal|mg|g|%)/gi, '$1 $2')
    .replace(/([가-힣])\s*[:：]\s*/g, '$1 ')
    .replace(/[㎉]/g, 'kcal')
    .replace(/[㎎]/g, 'mg')
    .replace(/[㎏]/g, 'kg')
    .replace(/[０-９]/g, (value) => String.fromCharCode(value.charCodeAt(0) - 0xfee0))
    .replace(/kca[il1]/gi, 'kcal')
    .replace(/m9/gi, 'mg')
    .replace(/(\d)\s*[lI]\s*(?=\d)/g, '$11')
    .replace(/(\d)\s*\|\s*(?=\d)/g, '$11');
}

function extractNutritionValue(text, labels, units = []) {
  const source = String(text || '').normalize('NFKC');
  const unitPattern = units.length ? `(?:${units.map(escapeRegExp).join('|')})?` : '';

  for (const label of labels) {
    const looseLabel = String(label)
      .split('')
      .map((letter) => escapeRegExp(letter))
      .join('\\s*');
    const pattern = new RegExp(`${looseLabel}[\\s:：\\-·.]*.{0,24}?(\\d+(?:\\.\\d+)?)\\s*${unitPattern}`, 'i');
    const match = source.match(pattern);
    if (match?.[1]) return match[1];
  }

  return '';
}

function sanitizeNutritionFacts(facts) {
  const limits = {
    calories: 1600,
    carb: 300,
    sugar: 250,
    protein: 250,
    fat: 250,
    saturatedFat: 120,
    transFat: 50,
    sodium: 7000,
  };

  return Object.fromEntries(
    Object.entries(facts).filter(([key, value]) => {
      if (key === 'foodName') return Boolean(String(value || '').trim());
      if (value === '' || value == null) return false;
      const numeric = Number(String(value).replace(/[^\d.]/g, ''));
      if (!Number.isFinite(numeric)) return false;
      return numeric >= 0 && numeric <= (limits[key] || 10000);
    }),
  );
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  const safetyText = createSafetyText(items, facts, options);
  const additives = detectAdditives(safetyText);
  const glycemic = evaluateGlycemicImpact(normalizedProfile, items, facts, totals, macroPercent, options);
  const risk = evaluateRisk(normalizedProfile, items, facts, totals, macroPercent, options, additives, glycemic);
  const dietScore = createDietScore(items, totals, macroPercent, risk, glycemic);
  const stamp = risk.red.length ? 'red' : risk.yellow.length ? 'yellow' : 'green';
  const messageParagraphs = createMessage(normalizedProfile, foods, labelItem, facts, totals, macroPercent, risk, stamp, options, additives);
  const sourceItems = createSourceItems(items, facts, options, additives);

  return {
    analysisType: 'meal-with-label',
    profile: normalizedProfile,
    foods,
    facts,
    items,
    totals,
    macroPercent,
    risk,
    glycemic,
    dietScore,
    additives,
    sourceItems,
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
      const defaultAmount = item.perServing ? toNumber(item.servingAmount) || 1 : 100;
      const grams = Math.max(toNumber(item.grams) || defaultAmount, item.perServing ? 0.01 : 1);
      const attachedFood = createAttachedFoodBase(item);
      const base = attachedFood || findFood(item.name);
      const basisAmount = Math.max(toNumber(item.servingAmount) || toNumber(item.nutrientBasisGrams) || 100, 0.01);
      const multiplier = attachedFood ? grams / basisAmount : base.perServing ? 1 : grams / 100;
      return {
        id: item.id,
        type: '음식',
        name: item.name.trim(),
        grams,
        estimated: Boolean(item.estimated),
        quantity: item.quantity || '',
        unitLabel: item.unitLabel || '',
        foodType: item.foodType || '',
        sizeLabel: item.sizeLabel || '',
        confidence: item.confidence || '',
        confidenceScore: item.confidenceScore || 0,
        recognitionSource: item.recognitionSource || '',
        perServing: Boolean(base.perServing),
        servingAmount: base.perServing ? basisAmount : 0,
        servingUnit: item.servingUnit || (base.perServing ? '회' : 'g'),
        visualReason: item.visualReason || '',
        emoji: base.emoji,
        matched: base.matched,
        official: Boolean(base.official || item.sourceLabel),
        brand: item.brand || base.brand || '',
        category: item.category || base.category || '',
        serving: item.serving || base.serving || '',
        sourceLabel: item.sourceLabel || base.sourceLabel || '',
        sourceUrl: item.sourceUrl || base.sourceUrl || '',
        isPendingInfo: Boolean(base.isPendingInfo),
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

function createAttachedFoodBase(item) {
  const nutrients = item?.nutrients || null;
  if (!nutrients) return null;
  const hasValue = ['calories', 'carb', 'protein', 'fat', 'sodium', 'sugar'].some((key) => toNumber(nutrients[key]) > 0);
  if (!hasValue) return null;

  return {
    emoji: '공공DB',
    matched: true,
    official: true,
    brand: item.brand || '',
    category: item.category || '공공 식품영양 DB',
    serving: item.serving || '',
    sourceLabel: item.sourceLabel || '식품영양성분 공공 DB',
    sourceUrl: item.sourceUrl || '',
    perServing: Boolean(item.perServing),
    servingAmount: Number(item.servingAmount || 0),
    servingUnit: item.servingUnit || '',
    calories: toNumber(nutrients.calories),
    carb: toNumber(nutrients.carb),
    protein: toNumber(nutrients.protein),
    fat: toNumber(nutrients.fat),
    saturatedFat: toNumber(nutrients.saturatedFat),
    transFat: toNumber(nutrients.transFat),
    sodium: toNumber(nutrients.sodium),
    sugar: toNumber(nutrients.sugar),
    fiber: toNumber(nutrients.fiber),
    leucine: toNumber(nutrients.leucine),
  };
}

function findFood(name) {
  const normalized = String(name || '').toLowerCase().replace(/\s/g, '');
  const officialProduct = findOfficialProductFood(name);
  if (officialProduct) return { ...officialProduct, matched: true, official: true, perServing: true };

  const official = findOfficialBrandFood(name);
  if (official) return { ...official, matched: true, official: true, perServing: true };

  const found = FOOD_DATABASE.find((entry) => entry.keys.some((key) => normalized.includes(key.toLowerCase().replace(/\s/g, ''))));
  if (found) return { ...found, matched: true, ...createSourceFallback(name) };
  return {
    emoji: '음식',
    matched: false,
    isPendingInfo: true,
    ...createSourceFallback(name),
    calories: 0,
    carb: 0,
    protein: 0,
    fat: 0,
    saturatedFat: 0,
    transFat: 0,
    sodium: 0,
    sugar: 0,
    fiber: 0,
    leucine: 0,
  };
}

function createSourceFallback(name) {
  const officialProductSource = findOfficialProductSources(name)[0];
  if (officialProductSource) {
    return {
      brand: officialProductSource.brand,
      category: officialProductSource.category,
      sourceLabel: `${officialProductSource.brand} 공식 제품/메뉴 영양정보 확인`,
      sourceUrl: officialProductSource.url,
    };
  }

  const source = findOfficialNutritionSources(name)[0];
  if (!source) return {};
  return {
    brand: source.brand,
    category: source.category,
    sourceLabel: `${source.brand} 공식 메뉴/영양성분표`,
    sourceUrl: source.url,
  };
}

function createSourceItems(items, facts = {}, options = {}, additives = []) {
  const sources = items
    .filter((item) => item.sourceUrl)
    .map((item) => ({
      name: item.name,
      brand: item.brand || '',
      category: item.category || '',
      sourceLabel: item.sourceLabel || '공식 메뉴/영양성분표',
      sourceUrl: item.sourceUrl,
      official: Boolean(item.official),
      serving: item.serving || '',
      type: item.official ? 'official-value' : 'official-source',
    }));

  const safetySources = createSafetyReferenceItems(items, facts, options, additives);
  return [...sources, ...safetySources].filter(
    (source, index, allSources) => allSources.findIndex((item) => item.sourceUrl === source.sourceUrl && item.name === source.name) === index,
  );
}

function createSafetyText(items, facts = {}, options = {}) {
  return [
    items.map((item) => item.name).join(' '),
    facts.foodName,
    facts.servingSize,
    options.ocrText,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function detectAdditives(text = '') {
  const normalized = String(text || '').toLowerCase().replace(/\s+/g, '');
  const detected = [];

  ADDITIVE_RULES.forEach((rule) => {
    rule.terms.forEach((term) => {
      const normalizedTerm = String(term).toLowerCase().replace(/\s+/g, '');
      if (normalizedTerm && normalized.includes(normalizedTerm)) {
        detected.push({
          category: rule.category,
          term,
          caution: rule.caution,
        });
      }
    });
  });

  return detected.filter(
    (item, index, allItems) => allItems.findIndex((other) => other.category === item.category && other.term === item.term) === index,
  );
}

function createSafetyReferenceItems(items, facts = {}, options = {}, additives = []) {
  const text = createSafetyText(items, facts, options);

  const references = [];
  const hasAllergenTerm = ALLERGEN_TERMS.some((term) => text.includes(term.toLowerCase()));
  const hasSupplementTerm = SUPPLEMENT_REVIEW_TERMS.some((term) => text.includes(term.toLowerCase()));
  const hasDopingRiskTerm = GUIDELINES.wadaKada.riskyTerms.some((term) => text.includes(term.toLowerCase()));

  if (additives.length) {
    references.push(createReferenceSource('foodAdditives', '식품첨가물 표시 확인'));
  }

  if (hasAllergenTerm) {
    references.push(createReferenceSource('foodAllergy', '알레르기 성분 확인'));
  }

  if (hasSupplementTerm || hasDopingRiskTerm) {
    references.push(createReferenceSource('kada', hasDopingRiskTerm ? '도핑 위험 성분 확인' : '보충제 도핑 안전 확인'));
    references.push(createReferenceSource('medication', '약물·첨가제 성분 확인'));
  }

  return references.filter(Boolean);
}

function createReferenceSource(key, name) {
  const source = getSafetyReferenceSource(key);
  if (!source) return null;
  return {
    name,
    brand: source.brand,
    category: source.category,
    sourceLabel: source.sourceLabel,
    sourceUrl: source.sourceUrl,
    official: false,
    serving: '',
    type: 'safety-reference',
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

function evaluateGlycemicImpact(profile, items, facts, totals, macroPercent, options = {}) {
  const text = createSafetyText(items, facts, options);
  const factors = [];
  const hasDiabetes = profile.medical.includes('당뇨');
  const highGlycemicTerms = ['흰쌀밥', '공기밥', '떡볶이', '떡', '라면', '국수', '우동', '빵', '스무디', '프라페', '주스', '쥬스', '에이드', '콜라', '사이다', '스프라이트', '탄산음료', '밀크티'];
  const moderateGlycemicTerms = ['현미밥', '잡곡밥', '고구마', '바나나', '요거트'];
  const hasHighGlycemicFood = highGlycemicTerms.some((term) => text.includes(term.toLowerCase()));
  const hasModerateGlycemicFood = moderateGlycemicTerms.some((term) => text.includes(term.toLowerCase()));
  const carbLoad = round(totals.carb);
  let score = 0;

  if (totals.sugar >= 18) {
    score += 2;
    factors.push(`당류 ${Math.round(totals.sugar)}g`);
  } else if (totals.sugar >= 10) {
    score += 1;
    factors.push(`당류 ${Math.round(totals.sugar)}g`);
  }

  if (carbLoad >= 85) {
    score += 2;
    factors.push(`탄수화물 ${Math.round(carbLoad)}g`);
  } else if (carbLoad >= 55) {
    score += 1;
    factors.push(`탄수화물 ${Math.round(carbLoad)}g`);
  }

  if (macroPercent.carb >= 66 && totals.calories > 0) {
    score += 1;
    factors.push(`탄수 비율 ${macroPercent.carb}%`);
  }

  if (hasHighGlycemicFood) {
    score += 2;
    factors.push('빠르게 흡수되는 탄수화물 메뉴');
  } else if (hasModerateGlycemicFood) {
    score += 1;
    factors.push('탄수화물 중심 메뉴');
  }

  if (totals.protein >= 20 && totals.fiber >= 4) {
    score -= 1;
    factors.push('단백질·식이섬유 완충');
  }

  if (hasDiabetes) score += 1;

  const level = score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low';
  const label = level === 'high' ? '높음' : level === 'medium' ? '보통' : '낮음';
  const advice =
    level === 'high'
      ? '밥·면·음료 양을 줄이고 단백질/채소를 먼저 먹는 순서가 유리합니다.'
      : level === 'medium'
        ? '탄수화물 양과 당류를 확인하고 식후 가벼운 활동을 더하면 좋습니다.'
        : '현재 입력값 기준 혈당 부담은 크지 않습니다.';

  return {
    level,
    label,
    carbLoad,
    sugar: round(totals.sugar),
    factors: unique(factors).slice(0, 4),
    advice,
  };
}

function createDietScore(items, totals, macroPercent, risk, glycemic) {
  const hasFood = items.length > 0;
  let score = hasFood ? 92 : 70;
  const pendingCount = items.filter((item) => item.isPendingInfo).length;

  score -= risk.red.length * 18;
  score -= risk.yellow.length * 7;
  score -= pendingCount * 10;

  if (totals.calories >= 850) score -= 8;
  if (totals.sodium >= 1200) score -= 10;
  else if (totals.sodium >= 900) score -= 5;
  if (totals.sugar >= 18) score -= 8;
  else if (totals.sugar >= 12) score -= 4;
  if (macroPercent.protein < 10 && totals.calories > 0) score -= 5;
  if (glycemic.level === 'high') score -= 8;
  else if (glycemic.level === 'medium') score -= 4;
  if (totals.protein >= 20) score += 3;
  if (totals.fiber >= 4) score += 3;

  const value = Math.max(0, Math.min(100, Math.round(score)));
  return {
    value,
    label: value >= 85 ? '좋음' : value >= 70 ? '보통' : value >= 55 ? '주의' : '조심',
  };
}

function evaluateRisk(profile, items, facts, totals, macroPercent, options, additives = [], glycemic = null) {
  const red = [];
  const yellow = [];
  const hasMedical = (term) => profile.medical.includes(term);
  const labelText = `${items.map((item) => item.name).join(' ')} ${facts.servingSize || ''} ${options.ocrText || ''}`.toLowerCase();
  const hasRiskyTerm = GUIDELINES.wadaKada.riskyTerms.some((term) => labelText.includes(term.toLowerCase()));
  const pendingItems = items.filter((item) => item.isPendingInfo);
  const hasFood = items.some((item) => item.type === '음식' || item.type === '영양성분표');

  if (!hasFood && !options.skipMissingFoodRisk) {
    yellow.push('음식명 확인 필요');
  }

  if (pendingItems.length) {
    const pendingNames = pendingItems.slice(0, 3).map((item) => item.name).join(', ');
    yellow.push(`영양성분 확인 필요: ${pendingNames}`);
  }

  if (additives.length) {
    const additiveNames = additives.slice(0, 3).map((item) => item.term).join(', ');
    yellow.push(`식품첨가물 표시 확인 필요: ${additiveNames}`);
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

  if (glycemic?.level === 'high' && hasMedical('당뇨')) {
    red.push('혈당 상승 부담이 큰 탄수화물 조합');
  } else if (glycemic?.level === 'high') {
    yellow.push('혈당 변동 주의');
  } else if (glycemic?.level === 'medium' && hasMedical('당뇨')) {
    yellow.push('혈당 관리 식사 순서 확인 필요');
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

function createMessage(profile, foods, labelItem, facts, totals, macroPercent, risk, stamp, options, additives = []) {
  if (profile.mode === 'child') return createChildMessage(foods, labelItem, stamp);
  if (profile.mode === 'senior') return createSeniorMessage(profile, totals, stamp);
  return createAdultMessage(profile, foods, labelItem, facts, totals, macroPercent, risk, options, additives);
}

function createAdultMessage(profile, foods, labelItem, facts, totals, macroPercent, risk, options, additives = []) {
  const weight = Math.max(Number(profile.weight || 70), 1);
  const sodiumRatio = Math.round((totals.sodium / GUIDELINES.kdri2025.sodiumCdrrMg) * 100);
  const hasEstimatedFood = foods.some((food) => food.estimated);
  const pendingFoods = foods.filter((food) => food.isPendingInfo);
  const paragraphs = [];

  if (!foods.length) {
    paragraphs.push('사진 촬영은 완료되었습니다. 음식명을 먼저 입력하면 음식 기준 영양 추정이 바로 시작됩니다. 포장식품이면 아래 영양성분표 숫자도 함께 입력해 더 정확하게 보정하세요.');
  } else if (risk.red.length) {
    paragraphs.push(`안전 필터에서 ${risk.red.join(', ')}이 감지되었습니다. 보충제, 한약, 해외 직구 제품은 KADA 금지약물검색 서비스 또는 Global DRO 확인 전까지 섭취를 보류하세요.`);
  } else if (pendingFoods.length) {
    const pendingNames = pendingFoods.map((food) => food.name).join(', ');
    paragraphs.push(`${pendingNames}은 현재 데이터베이스에서 신뢰 가능한 영양성분을 찾지 못했습니다. 임의로 칼로리와 탄단지, 나트륨 수치를 만들지 않고 0으로 표시했습니다. 제품 성분표를 가까이 촬영하거나 음식명과 제공량을 보정하면 다시 계산됩니다.`);
  } else if (hasEstimatedFood) {
    paragraphs.push(`사진 속 음식을 자동 추정값으로 먼저 분석했습니다. 현재는 촬영 음식 ${foods[0]?.grams || 250}g 기준의 임시 계산이며, 정확도를 높이고 싶을 때만 음식명과 양을 수정하세요. 현재 탄수화물 ${macroPercent.carb}%, 단백질 ${macroPercent.protein}%, 지방 ${macroPercent.fat}%로 2025 KDRI 성인 AMDR 범위와 비교했습니다.`);
  } else {
    paragraphs.push(`음식 분석 기준으로 현재 탄수화물 ${macroPercent.carb}%, 단백질 ${macroPercent.protein}%, 지방 ${macroPercent.fat}%입니다. 2025 KDRI 성인 AMDR인 탄수화물 50~65%, 단백질 10~20%, 지방 15~30%와 비교했습니다.`);
  }

  paragraphs.push(`현재 합산 나트륨은 ${Math.round(totals.sodium)} mg으로 성인 CDRR 2,300 mg/일의 약 ${sodiumRatio}%입니다. 고혈압 이력이 있으면 국물류, 김치류, 가공식품을 같은 끼니에 겹치지 않게 조절하세요.`);

  if (labelItem) {
    paragraphs.push(`${facts.foodName || '포장식품'} 영양성분표도 함께 반영했습니다. 촬영 사진에서 글자가 자동 입력되지 않으면 숫자를 직접 고치면 리포트가 즉시 다시 계산됩니다.`);
  }

  if (additives.length) {
    const additiveSummary = additives.slice(0, 4).map((item) => `${item.category}(${item.term})`).join(', ');
    paragraphs.push(`성분표 또는 원재료명에서 ${additiveSummary} 후보가 감지되었습니다. 이는 유해 판정이 아니라 표시사항 확인용이며, 알레르기 이력, 고혈압/신장질환, 아동 섭취, 운동선수 보충제 사용 상황에서는 제품 라벨과 공식 정보를 한 번 더 확인하세요.`);
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
