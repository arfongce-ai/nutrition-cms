import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const productPath = path.join(rootDir, 'data', 'official-products.json');
const brand = '컴포즈커피';

// 컴포즈커피 공식 사이트(composecoffee.com)의 "영양성분·알레르기 유발물질" 페이지.
// Claude in Chrome으로 실제 확인함(2026-10-20): 일반 HTML <table>(thead/tbody) 형태라 다른 브랜드보다 단순함.
// URL: https://composecoffee.com/compose?search_tag={카테고리명}&tab=nutrition&page={N}
// 카테고리 탭 9개(사이트에 적힌 그대로, encodeURIComponent로 인코딩해서 요청):
const CATEGORY_TAGS = [
  '01. 추천메뉴',
  '02. 커피ㆍ콜드브루',
  '03. 베버리지',
  '04. 프라페ㆍ스무디',
  '05. 밀크쉐이크',
  '06. 에이드ㆍ주스',
  '07. 티',
  '08. 푸드ㆍ디저트',
  '09. 아이스크림',
];

// 테이블 컬럼 순서(실제 페이지에서 확인한 thead 순서 그대로): 품목명, 컵용량(ml), 무게(g), 칼로리(kcal),
// 카페인(mg), 나트륨(mg), 탄수화물(g), 당류(g), 지방(g), 포화지방(g), 단백질(g)
const COLUMN_FIELDS = ['servingMl', 'weightG', 'calories', 'caffeine', 'sodium', 'carb', 'sugar', 'fat', 'saturatedFat', 'protein'];

const MAX_PAGES_PER_CATEGORY = 20; // 안전장치 — 실제로는 보통 1~3페이지. 이 이상이면 뭔가 잘못됐다고 보고 멈춤.

const allImported = [];
const sourceSummaries = [];

for (const tag of CATEGORY_TAGS) {
  let categoryCount = 0;
  for (let page = 1; page <= MAX_PAGES_PER_CATEGORY; page += 1) {
    const sourceUrl = `https://composecoffee.com/compose?search_tag=${encodeURIComponent(tag)}&tab=nutrition&page=${page}`;
    const response = await fetch(sourceUrl, {
      headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'MOMGAGYM nutrition DB importer' },
    });

    if (!response.ok) {
      throw new Error(`컴포즈커피 공식 메뉴(${tag} ${page}페이지)를 불러오지 못했습니다. HTTP ${response.status}`);
    }

    const html = new TextDecoder('utf-8').decode(await response.arrayBuffer());
    const rows = parseTablePage(html, { category: tag, sourceUrl });
    if (rows.length === 0) break; // 이 카테고리의 마지막 페이지를 지나침 — 다음 카테고리로.

    categoryCount += rows.length;
    allImported.push(...rows);
  }
  sourceSummaries.push({ tag, count: categoryCount });
}

const totalParsed = allImported.length;
if (totalParsed < 60) {
  // 사이트 구조가 바뀌어 파싱이 깨졌을 가능성이 높아 기존 데이터를 지키기 위해 중단합니다.
  throw new Error(
    `컴포즈커피 공식 메뉴가 ${totalParsed}개만 확인되어 병합을 중단했습니다. (카테고리별: ${JSON.stringify(sourceSummaries)})`,
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

function parseTablePage(htmlText, { category, sourceUrl }) {
  const products = [];

  const tbodyMatch = htmlText.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return products;

  const rowMatches = [...tbodyMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];

  for (const rowMatch of rowMatches) {
    const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (cells.length < 1 + COLUMN_FIELDS.length) continue; // 품목명 + 10개 수치 컬럼

    // 품목명 칸에는 "공개/비공개" 상태 뱃지 span이 앞에 붙어있어 제거하고 남은 텍스트만 쓴다.
    const nameCellWithoutBadge = cells[0].replace(/<span[^>]*class="[^"]*\bcafemenu_status_badge\b[^"]*"[^>]*>[\s\S]*?<\/span>/i, '');
    const productName = cleanText(nameCellWithoutBadge);
    if (!productName) continue;

    const values = {};
    COLUMN_FIELDS.forEach((field, i) => {
      values[field] = parseNutrientValue(cleanText(cells[1 + i]));
    });

    const nutrients = {
      calories: values.calories,
      carb: values.carb,
      sugar: values.sugar,
      protein: values.protein,
      fat: values.fat,
      saturatedFat: values.saturatedFat,
      transFat: null,
      sodium: values.sodium,
      caffeine: values.caffeine,
    };

    const hasAnyNutrient = Object.values(nutrients).some((v) => v !== null);
    if (!hasAnyNutrient) continue;

    products.push({
      id: `compose-${stableId(`${category}|${productName}`)}`,
      brand,
      productName,
      aliases: createAliases(productName),
      category: `${brand}/${category.replace(/^\d+\.\s*/, '')}`,
      servingSize: values.servingMl != null ? `${values.servingMl}ml` : '1회 제공량',
      servingGram: values.weightG,
      sourceType: 'official_nutrition_page',
      sourceLabel: '컴포즈커피 공식 홈페이지 영양성분·알레르기 유발물질',
      sourceUrl,
      verifiedAt: new Date().toISOString().slice(0, 10),
      allergens: [],
      additiveWatch: [
        nutrients.caffeine && nutrients.caffeine > 0 ? '카페인' : '',
        nutrients.saturatedFat != null && nutrients.saturatedFat >= 10 ? '포화지방' : '',
      ].filter(Boolean),
      nutrients,
      reviewNote: '컴포즈커피 공식 홈페이지 영양성분 표를 그대로 저장했습니다. 표에 없는 항목(-)은 null입니다.',
    });
  }

  return products;
}

function createAliases(productName) {
  const compact = productName.replace(/\s+/g, '');
  return [...new Set([`컴포즈커피 ${productName}`, productName, compact])];
}

function parseNutrientValue(value) {
  const text = String(value || '').replace(/,/g, '').trim();
  if (!text || text === '-' || text === '–') return null;
  const number = Number.parseFloat(text);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value) {
  return decodeEntities(String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');
}

function stableId(value) {
  return createHash('sha1').update(value).digest('hex').slice(0, 12);
}
