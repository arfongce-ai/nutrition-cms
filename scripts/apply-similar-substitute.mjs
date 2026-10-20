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

  const substitutes = buildSimilarSubstitutes(currentProducts);

  // 이미 실제 데이터가 있는 상품명(브랜드 무관)은 추정값으로 덮어쓰지 않는다.
  const existingNames = new Set(currentProducts.map((p) => normalizeName(p.productName)));
  const newSubstitutes = substitutes.filter((s) => !existingNames.has(normalizeName(s.productName)));

  // 기존에 넣어둔 "일반(추정)" 항목은 다시 계산해서 교체(중복 누적 방지).
  const withoutOldEstimates = currentProducts.filter((p) => p.brand !== '일반(추정)');

  database.products = [...withoutOldEstimates, ...newSubstitutes];
  database.updatedAt = new Date().toISOString().slice(0, 10);

  await fs.writeFile(productPath, `${JSON.stringify(database, null, 2)}\n`, 'utf8');

  console.log(
    JSON.stringify(
      {
        ok: true,
        verifiedBrandsUsed: [...new Set(currentProducts.filter(isVerifiedOfficial).map((p) => p.brand))],
        estimatesAdded: newSubstitutes.length,
        estimateNames: newSubstitutes.map((s) => s.productName),
      },
      null,
      2,
    ),
  );
}
