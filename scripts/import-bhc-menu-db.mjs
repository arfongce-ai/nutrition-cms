import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const productPath = path.join(rootDir, 'data', 'official-products.json');
const brand = 'bhc치킨';

// bhc치킨 공식 사이트(www.bhc.co.kr)의 JSON API.
// Claude in Chrome 네트워크 요청으로 실제 응답 확인함(2026-10-20):
//   카테고리 목록: GET https://www.bhc.co.kr/api/v1/web/categories/list
//     → body: [{cateIdx, cateNm, subCateList:[...]}, ...] (확인 시점: 치킨(1)·신메뉴(22)·
//        BHC시그니처(23)·콜팝(47)·사이드(50) 5개)
//   카테고리별 상품 목록: GET https://www.bhc.co.kr/api/v1/web/categories/{cateIdx}/products
//     → body: [{productCd, productNm, ...}, ...] (영양정보는 없음 — 목록은 상품 코드만 줌)
//   상품 상세(영양정보 포함): GET https://www.bhc.co.kr/api/v1/web/products/{productCd}
//     → body.optionList: [{optionNm, weight, optionNutrition:{calories,proteins,sugars,
//        saturatedFat,sodium,carbs,fat,cholesterol}}, ...]
//     한 상품에 여러 옵션(부위별: 순살/스틱/윙/콤보/한마리 등, 또는 세트 구성)이 있고 옵션마다
//     영양정보가 다르다. 세트/콤보처럼 부위가 안 나뉘는 옵션은 optionNutrition 값이 전부 빈
//     문자열("")로 와서 제외한다. carbs·fat·cholesterol은 API가 항상 비워서 null 처리.
// 신메뉴(22)·BHC시그니처(23)는 치킨(1)/사이드(50)에 이미 있는 상품을 다시 모아 보여주는
// 프로모션 묶음이라 productCd가 겹친다 — 전역으로 productCd 기준 중복 제거하되, 구조상
// 카테고리(치킨 > 콜팝 > 사이드)를 우선해 분류하고 신메뉴/시그니처에만 있는 상품은 마지막에 채운다.
const CATEGORY_PRIORITY = [
  { id: 1, label: '치킨' },
  { id: 47, label: '콜팝' },
  { id: 50, label: '사이드' },
  { id: 22, label: '신메뉴' },
  { id: 23, label: 'BHC시그니처' },
];

const sourceSummaries = [];
const productCdToCategory = new Map(); // productCd -> {label, productNm}

for (const cat of CATEGORY_PRIORITY) {
  const listUrl = `https://www.bhc.co.kr/api/v1/web/categories/${cat.id}/products`;
  const response = await fetch(listUrl, {
    headers: { accept: 'application/json', 'user-agent': 'MOMGAGYM nutrition DB importer' },
  });
  if (!response.ok) {
    throw new Error(`bhc치킨 공식 카테고리 상품 목록(${cat.label})을 불러오지 못했습니다. HTTP ${response.status}`);
  }
  const json = await response.json();
  const items = json.body || [];
  let newCount = 0;
  for (const item of items) {
    if (!productCdToCategory.has(item.productCd)) {
      productCdToCategory.set(item.productCd, { label: cat.label, productNm: item.productNm });
      newCount += 1;
    }
  }
  sourceSummaries.push({ label: cat.label, listed: items.length, newProducts: newCount });
}

const allImported = [];

for (const [productCd, { label, productNm }] of productCdToCategory) {
  const detailUrl = `https://www.bhc.co.kr/api/v1/web/products/${productCd}`;
  const response = await fetch(detailUrl, {
    headers: { accept: 'application/json', 'user-agent': 'MOMGAGYM nutrition DB importer' },
  });
  if (!response.ok) continue; // 개별 상품 조회 실패는 건너뜀(전체 중단하지 않음)

  const json = await response.json();
  const body = json.body;
  if (!body) continue;

  const baseName = cleanText(body.productNm || productNm);
  if (!baseName) continue;

  const options = Array.isArray(body.optionList) ? body.optionList : [];
  const nameCounts = new Map();
  const usable = options.filter((opt) => {
    const n = opt.optionNutrition;
    return n && toNumber(n.calories) != null;
  });
  usable.forEach((opt) => nameCounts.set(opt.optionNm, (nameCounts.get(opt.optionNm) ?? 0) + 1));

  for (const opt of usable) {
    const n = opt.optionNutrition;
    const optionLabel = cleanText(opt.optionNm);
    // 옵션이 1개뿐이면 상품명만 쓰고, 여러 개면 "상품명 (옵션명)"으로 구분한다(순살/윙/콤보 등).
    const productName = options.length > 1 ? `${baseName} (${optionLabel})` : baseName;

    const nutrients = {
      calories: toNumber(n.calories),
      carb: toNumber(n.carbs),
      sugar: toNumber(n.sugars),
      protein: toNumber(n.proteins),
      fat: toNumber(n.fat),
      saturatedFat: toNumber(n.saturatedFat),
      transFat: null,
      sodium: toNumber(n.sodium),
      caffeine: null,
    };

    allImported.push({
      id: `bhc-${stableId(`${label}|${productCd}|${optionLabel}`)}`,
      brand,
      productName,
      aliases: [...new Set([`bhc치킨 ${productName}`, `비에이치씨 ${productName}`, productName, productName.replace(/\s+/g, '')])],
      category: `${brand}/${label}`,
      servingSize: optionLabel ? `1인분 (${optionLabel})` : '1인분',
      servingGram: null,
      sourceType: 'official_nutrition_page',
      sourceLabel: 'bhc치킨 공식 홈페이지 상품 상세 API',
      sourceUrl: detailUrl,
      verifiedAt: new Date().toISOString().slice(0, 10),
      allergens: Array.isArray(body.allergenInfo)
        ? [...new Set(body.allergenInfo.flatMap((a) => String(a.allergen || '').split(/[,、]/).map((s) => s.trim()).filter(Boolean)))]
        : [],
      additiveWatch: [
        nutrients.saturatedFat != null && nutrients.saturatedFat >= 10 ? '포화지방' : '',
      ].filter(Boolean),
      nutrients,
      reviewNote:
        'bhc치킨 공식 홈페이지(bhc.co.kr) 상품 상세 API의 옵션별 영양정보(optionNutrition)를 그대로 저장했습니다. '
        + 'API가 탄수화물·지방·콜레스테롤을 항상 빈 값으로 주는 경우가 많아 해당 항목은 null일 수 있고, 트랜스지방·카페인·1회 제공량(g)은 API에 없어 null입니다.',
    });
  }
}

const totalParsed = allImported.length;
if (totalParsed < 80) {
  // 사이트 구조가 바뀌어 파싱이 깨졌을 가능성이 높아 기존 데이터를 지키기 위해 중단합니다.
  throw new Error(
    `bhc치킨 공식 메뉴가 ${totalParsed}개만 확인되어 병합을 중단했습니다. (카테고리별: ${JSON.stringify(sourceSummaries)})`,
  );
}

const unique = new Map();
allImported.forEach((product) => unique.set(`${product.category}|${product.productName}`, product));
const imported = [...unique.values()];

const database = JSON.parse(await fs.readFile(productPath, 'utf8'));
const currentProducts = Array.isArray(database.products) ? database.products : [];
const preserved = currentProducts.filter((product) => product.brand !== brand);

database.updatedAt = new Date().toISOString().slice(0, 10);
database.products = [...preserved, ...imported];

await fs.writeFile(productPath, `${JSON.stringify(database, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify(
    { ok: true, brand, imported: imported.length, totalProducts: database.products.length, sources: sourceSummaries },
    null,
    2,
  ),
);

function toNumber(value) {
  if (value == null || value === '') return null;
  const text = String(value).replace(/,/g, '').trim();
  if (!text || text === '-') return null;
  const number = Number.parseFloat(text);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stableId(value) {
  return createHash('sha1').update(value).digest('hex').slice(0, 12);
}
