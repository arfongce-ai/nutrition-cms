import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const productPath = path.join(rootDir, 'data', 'official-products.json');
const brand = 'BBQ치킨';

// BBQ치킨 공식 배달 사이트(bbq.co.kr)의 JSON API.
// Claude in Chrome 네트워크 요청으로 실제 응답 확인함(2026-10-20, www.bbq.co.kr은 bbq.co.kr로 리다이렉트됨):
//   카테고리 목록: GET https://bbq.co.kr/api/delivery/menu/category
//     → [{id, categoryName, ...}, ...] (확인 시점: 8개 — 필릭스PICK(34)·추천(17)·세트(18)·치킨(19)·
//        피자&버거(20)·사이드(21)·소스&시즈닝&무(22)·음료(23))
//   카테고리별 상품: GET https://bbq.co.kr/api/delivery/menu/{categoryId}
//     → [{id, menuName, menuType, menuPrice, nutrient:{calorie,sugars,protein,saturatedFat,natrium},
//         allergy:"알류, 우유, ...", origin:[{name,region}], weightList:[...], ...}, ...]
//     영양정보가 상품 목록 응답에 이미 포함되어 있어 상세 호출이 필요 없다(치킨 22개 중 21개,
//     세트 27개 중 11개, 사이드 26개 중 19개 등 — 세트/프로모션 상품 일부는 nutrient가 비어있음, 정상).
// 필릭스PICK(34)·추천(17)은 다른 카테고리 상품을 다시 모아 보여주는 프로모션 묶음이라(확인 시점:
// 추천 14개 중 nutrient 있는 건 6개뿐, 필릭스PICK은 전부 0개) 중복을 피하기 위해 수집 대상에서 제외하고
// 구조상 카테고리(세트·치킨·피자&버거·사이드·소스&시즈닝&무·음료) 6개만 쓴다.
// API가 1회 제공량(g) 자체를 숫자로 안 주고 weightList는 "조리전 중량" 옵션 설명 텍스트라
// servingGram은 null로 둔다.
const CATEGORIES = [
  { id: 18, label: '세트' },
  { id: 19, label: '치킨' },
  { id: 20, label: '피자&버거' },
  { id: 21, label: '사이드' },
  { id: 22, label: '소스&시즈닝&무' },
  { id: 23, label: '음료' },
];

const allImported = [];
const sourceSummaries = [];

for (const cat of CATEGORIES) {
  const sourceUrl = `https://bbq.co.kr/api/delivery/menu/${cat.id}`;
  const response = await fetch(sourceUrl, {
    headers: { accept: 'application/json', 'user-agent': 'MOMGAGYM nutrition DB importer' },
  });

  if (!response.ok) {
    throw new Error(`BBQ치킨 공식 메뉴 API(${cat.label})를 불러오지 못했습니다. HTTP ${response.status}`);
  }

  const items = await response.json();
  let count = 0;

  for (const item of items) {
    const nutrient = item.nutrient;
    if (!nutrient || nutrient.calorie == null) continue; // 영양정보 없는 세트/프로모션 상품은 건너뜀

    const productName = cleanText(item.menuName);
    if (!productName) continue;

    const nutrients = {
      calories: toNumber(nutrient.calorie),
      carb: null,
      sugar: toNumber(nutrient.sugars),
      protein: toNumber(nutrient.protein),
      fat: null,
      saturatedFat: toNumber(nutrient.saturatedFat),
      transFat: null,
      sodium: toNumber(nutrient.natrium),
      caffeine: null,
    };

    const allergens = typeof item.allergy === 'string'
      ? item.allergy.split(/[,、]/).map((s) => s.trim()).filter(Boolean)
      : [];

    allImported.push({
      id: `bbq-${stableId(`${cat.label}|${item.id}|${productName}`)}`,
      brand,
      productName,
      aliases: [...new Set([`BBQ치킨 ${productName}`, `비비큐 ${productName}`, productName, productName.replace(/\s+/g, '')])],
      category: `${brand}/${cat.label}`,
      servingSize: '1인분',
      servingGram: null,
      sourceType: 'official_nutrition_page',
      sourceLabel: 'BBQ치킨 공식 배달 사이트 메뉴 API',
      sourceUrl,
      verifiedAt: new Date().toISOString().slice(0, 10),
      allergens,
      additiveWatch: [
        nutrients.saturatedFat != null && nutrients.saturatedFat >= 10 ? '포화지방' : '',
      ].filter(Boolean),
      nutrients,
      reviewNote:
        'BBQ치킨 공식 배달 사이트(bbq.co.kr) 메뉴 API 응답에 포함된 영양정보를 그대로 저장했습니다. '
        + 'API가 탄수화물·지방·트랜스지방·카페인·1회 제공량(g)을 제공하지 않아 해당 항목은 null입니다.',
    });
    count += 1;
  }
  sourceSummaries.push({ label: cat.label, listed: items.length, count });
}

const totalParsed = allImported.length;
if (totalParsed < 50) {
  // 사이트 구조가 바뀌어 파싱이 깨졌을 가능성이 높아 기존 데이터를 지키기 위해 중단합니다.
  throw new Error(
    `BBQ치킨 공식 메뉴가 ${totalParsed}개만 확인되어 병합을 중단했습니다. (카테고리별: ${JSON.stringify(sourceSummaries)})`,
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
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stableId(value) {
  return createHash('sha1').update(value).digest('hex').slice(0, 12);
}
