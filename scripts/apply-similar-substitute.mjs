import fs from 'node:fs/promises';
import path from 'node:path';

// "확인 안 된 브랜드는 비슷한 음식으로 대체" 고정규칙 적용 스크립트
// (claude/2026-10-20_고정규칙_영양정보_미공개_유사대체.md)
//
// 어떻게 동작하나:
// 1. data/official-products.json에서 "실제로 확인된" 브랜드 데이터만 기준으로 쓴다.
//    기준 = reviewNote에 "공식 홈페이지"가 들어있고 sourceType이 official_* 인 항목만.
//    (오래된 1~2개짜리 임시 샘플 데이터는 절대 기준으로 안 씀 — 추측 방지)
// 2. 상품명을 정규화해서(괄호/사이즈/HOT·ICE 표시 제거) 같은 음료가 2개 이상 브랜드에서
//    확인된 경우에만 평균값을 낸다. 1개 브랜드에만 있는 메뉴는 대체 기준으로 안 쓴다
//    (그건 "비슷한 음식"이 아니라 "그 브랜드만의 메뉴"일 수 있어서).
// 3. 평균값으로 brand: "일반(추정)" 항목을 새로 추가한다. 실제 확인된 데이터는 절대 덮지 않는다
//    (이미 브랜드 데이터가 있는 상품명은 건너뜀).
// 4. 모든 추정 항목은 sourceType: 'estimated_similar_average', basedOnBrands로 기준을 명시하고,
//    공식 데이터인 것처럼 보이지 않게 reviewNote에 "추정값"이라고 못박는다.
//
// 사용: node scripts/apply-similar-substitute.mjs

const rootDir = process.cwd();
const productPath = path.join(rootDir, 'data', 'official-products.json');

const NORMALIZE_RULES = [
  [/\(.*?\)/g, ''], // (HOT), (ICE), (Tall) 등 괄호 설명 제거
  [/\bhot\b|\bice\b|핫|아이스/gi, ''],
  [/\s+/g, ' '],
];

function normalizeName(name) {
  let text = String(name || '');
  for (const [pattern, replacement] of NORMALIZE_RULES) {
    text = text.replace(pattern, replacement);
  }
  return text.trim();
}

function isVerifiedOfficial(product) {
  const note = String(product.reviewNote || '');
  const sourceType = String(product.sourceType || '');
  // 2026-10-20 확인: official-products.json에는 실제로 영양정보 페이지를 긁은 데이터(sourceType
  // 'official_nutrition_page')와, 예전에 OCR 매칭용으로 대충 넣어둔 "대표 음료 우선 매핑값"
  // (sourceType 'official_menu_page', 전부 같은 템플릿 문구, 그 자체로 "분기 업데이트 때 공식
  // 페이지에서 재확인해야 합니다"라고 적혀 있어 미확인임을 자인함)이 섞여 있다.
  // 대체 기준값은 전자만 쓴다 — 후자는 "확인 못 함" 데이터이므로 대체 기준으로 쓰면 추측 위에
  // 추측을 쌓는 셈이 된다.
  if (sourceType !== 'official_nutrition_page') return false;
  if (note.includes('대표 음료 우선 매핑값')) return false;
  return true;
}

export function buildSimilarSubstitutes(products) {
  const verified = products.filter(isVerifiedOfficial);

  const groups = new Map(); // normalizedName -> [{brand, nutrients, category}]
  for (const product of verified) {
    const key = normalizeName(product.productName);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(product);
  }

  const substitutes = [];
  for (const [name, entries] of groups.entries()) {
    const distinctBrands = new Set(entries.map((e) => e.brand));
    if (distinctBrands.size < 2) continue; // 2개 이상 브랜드에서 확인된 메뉴만 "비슷한 음식" 기준으로 인정

    const averagedNutrients = averageNutrients(entries.map((e) => e.nutrients || {}));
    substitutes.push({
      id: `estimate-${slug(name)}`,
      brand: '일반(추정)',
      productName: name,
      aliases: [name, name.replace(/\s+/g, '')],
      category: entries[0].category ? entries[0].category.split('/').slice(1).join('/') || '카페 음료' : '카페 음료',
      servingSize: '1잔(평균)',
      servingGram: null,
      sourceType: 'estimated_similar_average',
      sourceLabel: `유사 브랜드 평균 추정 (${[...distinctBrands].join(', ')} 기준)`,
      sourceUrl: '',
      verifiedAt: new Date().toISOString().slice(0, 10),
      allergens: [],
      additiveWatch: [],
      nutrients: averagedNutrients,
      basedOnBrands: [...distinctBrands],
      basedOnCount: entries.length,
      reviewNote:
        `[추정값] 특정 브랜드의 공식 데이터가 없어 비슷한 메뉴(${[...distinctBrands].join('·')})의 평균값으로 대체한 추정치입니다. ` +
        `실제 매장·브랜드별 값과 다를 수 있습니다.`,
    });
  }

  return substitutes;
}

function averageNutrients(nutrientList) {
  const fields = ['calories', 'carb', 'sugar', 'protein', 'fat', 'saturatedFat', 'transFat', 'sodium', 'fiber', 'leucine', 'caffeine'];
  const result = {};
  for (const field of fields) {
    const values = nutrientList.map((n) => n[field]).filter((v) => typeof v === 'number' && Number.isFinite(v));
    result[field] = values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;
  }
  return result;
}

// ---- 카테고리 평균 추정(치킨) — 2026-11-14 추가 ----
// 위 buildSimilarSubstitutes()는 "같은 상품명"이 2개 이상 브랜드에서 확인될 때만 동작한다.
// 그런데 노브랜드버거·역전할머니맥주·허닭 등은 브랜드 자체가 미확인이라 상품명이 겹칠 다른
// 브랜드가 없다. 이런 경우를 위해 상품명이 아니라 "치킨" 같은 카테고리 키워드로 매칭되는
// 두 번째 대체 단계를 추가한다(실제 매칭은 officialProductDatabase.js의
// findCategorySubstituteFood가 담당, 여기서는 평균값만 만든다).
//
// 기준 브랜드: 치킨 전문 브랜드 중 공식 영양정보(isVerifiedOfficial)가 있는 교촌·bhc·BBQ·네네
// 4곳의 "치킨" 카테고리 메뉴 전체.
//
// 왜 100g 기준으로 맞추나: 브랜드마다 표기가 다르다 — 교촌은 "1마리(조리 전 OOOg)"처럼 중량이
// 적혀 있어 100g당으로 환산해야 하고, bhc·BBQ·네네는 "1인분"이라고만 적혀 있어 중량이 없다.
// 2026-11-14 확인: bhc·BBQ·네네의 "1인분" 칼로리 평균(278~308kcal)이 교촌을 중량으로 나눠
// 100g 환산한 값(평균 342kcal)과 같은 범위라서, 네 브랜드 모두 사실상 "100g당" 표로 보고 그대로
// 평균 기준에 포함한다. (중량 표기가 없는 1인분 값을 그대로 다른 브랜드의 '마리' 전체값과
// 평균 내면 단위가 안 맞아 수치가 깨지므로, 반드시 이 환산을 거쳐야 한다.)
const CHICKEN_CATEGORY_BRANDS = ['교촌치킨', 'bhc치킨', 'BBQ치킨', '네네치킨'];
const CHICKEN_CATEGORY_MIN_ITEMS = 8; // 데이터가 너무 적으면 평균 자체가 의미 없어 아예 안 만듦

export function buildCategorySubstitutes(products) {
  const verified = products.filter(isVerifiedOfficial);
  const chickenItems = verified.filter(
    (product) =>
      CHICKEN_CATEGORY_BRANDS.includes(product.brand) &&
      String(product.category || '').split('/').pop() === '치킨',
  );
  if (chickenItems.length < CHICKEN_CATEGORY_MIN_ITEMS) return [];

  const per100gNutrients = chickenItems.map((product) => {
    const nutrients = product.nutrients || {};
    const gram = product.servingGram;
    // servingGram이 있으면(교촌) 100g당으로 환산, 없으면(bhc·BBQ·네네) 이미 100g당 값으로 간주.
    const scale = gram && gram > 0 ? 100 / gram : 1;
    const scaled = {};
    for (const [field, value] of Object.entries(nutrients)) {
      scaled[field] = typeof value === 'number' && Number.isFinite(value) ? value * scale : null;
    }
    return scaled;
  });

  const averagedNutrients = averageNutrients(per100gNutrients);
  const distinctBrands = [...new Set(chickenItems.map((product) => product.brand))];

  return [
    {
      id: 'estimate-category-chicken',
      brand: '일반(추정)',
      productName: '치킨(일반)',
      aliases: [],
      matchType: 'category', // 상품명 완전일치가 아니라 키워드 포함 매칭용 — findCategorySubstituteFood 전용
      categoryKeywords: ['치킨', '후라이드치킨', '양념치킨', '프라이드치킨', '통닭', '후라이드'],
      category: '치킨/일반(추정)',
      servingSize: '100g 기준(추정)',
      servingGram: 100,
      sourceType: 'estimated_similar_average',
      sourceLabel: `치킨 전문 브랜드 평균 추정 (${distinctBrands.join('·')} 메뉴 전체, 100g 기준)`,
      sourceUrl: '',
      verifiedAt: new Date().toISOString().slice(0, 10),
      allergens: [],
      additiveWatch: [],
      nutrients: averagedNutrients,
      basedOnBrands: distinctBrands,
      basedOnCount: chickenItems.length,
      reviewNote:
        `[추정값] 브랜드를 확인할 수 없는 치킨 메뉴라서 치킨 전문 브랜드(${distinctBrands.join('·')}) 공식 메뉴 ` +
        `전체 평균(100g당)으로 대체한 추정치입니다. 실제 매장·메뉴·조리법에 따라 값이 크게 다를 수 있습니다.`,
    },
  ];
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// --- 실행부: data/official-products.json을 읽어서 추정 항목을 추가한다 ---
if (process.argv[1] && process.argv[1].endsWith('apply-similar-substitute.mjs')) {
  const database = JSON.parse(await fs.readFile(productPath, 'utf8'));
  const currentProducts = Array.isArray(database.products) ? database.products : [];

  const nameSubstitutes = buildSimilarSubstitutes(currentProducts);
  const categorySubstitutes = buildCategorySubstitutes(currentProducts);

  // 이미 실제 데이터가 있는 상품명(브랜드 무관)은 추정값으로 덮어쓰지 않는다.
  // (카테고리 추정은 상품명이 아니라 키워드로 매칭되므로 이 체크 대상이 아님)
  const existingNames = new Set(currentProducts.map((p) => normalizeName(p.productName)));
  const newNameSubstitutes = nameSubstitutes.filter((s) => !existingNames.has(normalizeName(s.productName)));

  // 기존에 넣어둔 "일반(추정)" 항목(상품명 기준 + 카테고리 기준 전부)은 다시 계산해서 교체(중복 누적 방지).
  const withoutOldEstimates = currentProducts.filter((p) => p.brand !== '일반(추정)');

  database.products = [...withoutOldEstimates, ...newNameSubstitutes, ...categorySubstitutes];
  database.updatedAt = new Date().toISOString().slice(0, 10);

  await fs.writeFile(productPath, `${JSON.stringify(database, null, 2)}\n`, 'utf8');

  console.log(
    JSON.stringify(
      {
        ok: true,
        verifiedBrandsUsed: [...new Set(currentProducts.filter(isVerifiedOfficial).map((p) => p.brand))],
        estimatesAdded: newNameSubstitutes.length,
        estimateNames: newNameSubstitutes.map((s) => s.productName),
        categoryEstimatesAdded: categorySubstitutes.length,
        categoryEstimateNames: categorySubstitutes.map((s) => s.productName),
      },
      null,
      2,
    ),
  );
}
