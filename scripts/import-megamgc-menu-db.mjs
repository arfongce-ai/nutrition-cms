import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const productPath = path.join(rootDir, 'data', 'official-products.json');
const brand = '메가MGC커피';

// 메가MGC커피 공식 사이트(www.mega-mgccoffee.com)의 메뉴 AJAX 엔드포인트 menu.php.
// Claude in Chrome으로 실제 네트워크 요청·DOM 구조 확인함(2026-10-20):
//   https://www.mega-mgccoffee.com/menu/menu.php?page=N&menu_category1=C1&menu_category2=C2&category=&list_checkbox_all=all
// menu_category1: 1=음료(최대 9페이지 확인), 2=푸드(최대 2페이지 확인). 3=상품(텀블러 등 비식품)은 제외.
// 페이지 수가 더 늘어나면(신메뉴 추가 등) 이 목록을 갱신해야 합니다 — 아래 maxPage는 확인 시점 기준이며,
// 혹시 더 있어도 안전하게 비어있는 페이지는 그냥 0개로 처리되고 중단되지 않습니다.
const CATEGORY_PAGES = [
  { cat1: 1, cat2: 1, label: '음료', maxPage: 9 },
  { cat1: 2, cat2: 2, label: '푸드', maxPage: 2 },
];

const NUTRIENT_FIELD_MAP = {
  포화지방: 'saturatedFat',
  당류: 'sugar',
  나트륨: 'sodium',
  단백질: 'protein',
  트랜스지방: 'transFat',
  탄수화물: 'carb',
  카페인: 'caffeine',
};

const allImported = [];
const sourceSummaries = [];

for (const { cat1, cat2, label, maxPage } of CATEGORY_PAGES) {
  let categoryCount = 0;
  for (let page = 1; page <= maxPage; page += 1) {
    const sourceUrl = `https://www.mega-mgccoffee.com/menu/menu.php?page=${page}&menu_category1=${cat1}&menu_category2=${cat2}&category=&list_checkbox_all=all`;
    const response = await fetch(sourceUrl, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'MOMGAGYM nutrition DB importer',
      },
    });

    if (!response.ok) {
      throw new Error(`메가MGC커피 공식 메뉴(${label} ${page}페이지)를 불러오지 못했습니다. HTTP ${response.status}`);
    }

    const html = new TextDecoder('utf-8').decode(await response.arrayBuffer());
    const parsed = parsePage(html, { category: label, sourceUrl });
    categoryCount += parsed.length;
    allImported.push(...parsed);
  }
  sourceSummaries.push({ label, count: categoryCount });
}

const totalParsed = allImported.length;
if (totalParsed < 60) {
  // 사이트 구조가 바뀌어 파싱이 깨졌을 가능성이 높아 기존 데이터를 지키기 위해 중단합니다.
  throw new Error(
    `메가MGC커피 공식 메뉴가 ${totalParsed}개만 확인되어 병합을 중단했습니다. (카테고리별: ${JSON.stringify(sourceSummaries)})`,
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

function parsePage(htmlText, { category, sourceUrl }) {
  const products = [];

  // <div class="inner_modal">(공백 유의) 블록을 상품 경계로 쓴다. 같은 접두사를 쓰는
  // inner_modal_open / inner_modal_title과 헷갈리지 않도록 class 속성 정확히 "inner_modal"인 것만 찾는다.
  const marker = /<div[^>]*\bclass="inner_modal"[^>]*>/gi;
  const marks = [];
  let markMatch;
  while ((markMatch = marker.exec(htmlText))) {
    marks.push(markMatch.index);
  }

  for (let i = 0; i < marks.length; i += 1) {
    const start = marks[i];
    const end = i + 1 < marks.length ? marks[i + 1] : htmlText.length;
    const chunk = htmlText.slice(start, end);

    const nameMatch = chunk.match(/<[^>]*class="[^"]*\bcont_text_title\b[^"]*"[^>]*>[\s\S]*?<b>([\s\S]*?)<\/b>/i);
    const productName = cleanText(nameMatch ? nameMatch[1] : '');
    if (!productName) continue;

    const engMatch = chunk.match(/<div[^>]*class="[^"]*\bcont_text_info\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const engName = cleanText(engMatch ? engMatch[1] : '');

    // "1회 제공량 425 kcal" 형태 — 숫자(소수 가능) + kcal 를 뽑는다.
    const kcalMatch = chunk.match(/1회\s*제공량[\s\S]{0,40}?([\d.,]+)\s*kcal/i);

    const nutrients = {
      calories: kcalMatch ? parseNutrientValue(kcalMatch[1]) : null,
      carb: null,
      sugar: null,
      protein: null,
      fat: null,
      saturatedFat: null,
      transFat: null,
      sodium: null,
      caffeine: null,
    };

    const listMatch = chunk.match(/<[^>]*class="[^"]*\bcont_list2\b[^"]*"[^>]*>([\s\S]*?)<\/ul>/i);
    if (listMatch) {
      const items = [...listMatch[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => cleanText(m[1]));
      for (const item of items) {
        const m = item.match(/^([가-힣]+)\s*([\d.,]+)\s*(g|mg)?$/);
        if (!m) continue;
        const field = NUTRIENT_FIELD_MAP[m[1]];
        if (field) nutrients[field] = parseNutrientValue(m[2]);
      }
    }

    const hasAnyNutrient = nutrients.calories !== null || Object.values(nutrients).some((v) => v !== null);
    if (!hasAnyNutrient) continue;

    products.push({
      id: `megamgc-${stableId(`${category}|${productName}`)}`,
      brand,
      productName,
      aliases: createAliases(productName, engName),
      category: `${brand}/${category}`,
      servingSize: '1회 제공량',
      servingGram: null,
      sourceType: 'official_nutrition_page',
      sourceLabel: '메가MGC커피 공식 홈페이지 메뉴 영양정보',
      sourceUrl,
      verifiedAt: new Date().toISOString().slice(0, 10),
      allergens: [],
      additiveWatch: [
        nutrients.caffeine && nutrients.caffeine > 0 ? '카페인' : '',
        nutrients.saturatedFat != null && nutrients.saturatedFat >= 10 ? '포화지방' : '',
      ].filter(Boolean),
      nutrients,
      reviewNote:
        '메가MGC커피 공식 홈페이지 메뉴 상세(모달)의 영양정보를 그대로 저장했습니다. 표에 없는 항목은 null입니다.',
    });
  }

  return products;
}

function createAliases(productName, engName) {
  const compact = productName.replace(/\s+/g, '');
  return [...new Set([`메가MGC커피 ${productName}`, productName, compact, engName].filter(Boolean))];
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
