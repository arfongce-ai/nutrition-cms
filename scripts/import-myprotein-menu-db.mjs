import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const productPath = path.join(rootDir, 'data', 'official-products.json');
const brand = '마이프로틴';
const origin = 'https://www.myprotein.co.kr';

// 마이프로틴 코리아(myprotein.co.kr) 공식 사이트 — 2026-11-13 Claude in Chrome으로 직접 확인.
// robots.txt에 /p/(상품 상세), /c/(카테고리) 차단 없음 확인함.
// 카테고리 목록 페이지(plain fetch, JS 실행 없이도 상품 링크가 그대로 들어있음 — 서버 렌더링)에서
// 상품 상세(/p/.../) 링크를 모으고, 각 상세 페이지의 "영양정보" 표를 텍스트로 그대로 읽는다.
// 표 형식(상세페이지 HTML에 그대로 존재, 확인함):
//   <table> 일반적인 영양성분 | 100g당 | NNg당 (1회 제공량)
//           열량 | ####kJ | ##kJ
//           열량 | ###kcal | ##kcal
//           지방 | #.#g | #.#g
//           포화지방 | ...
//           탄수화물 | ...
//           당류 | ...
//           식이섬유 | ...
//           단백질 | ...
//           나트륨 | #.##g | #.##g   ← 그램 단위! 다른 브랜드(교촌 등)는 나트륨을 mg로 저장하므로
//                                      ×1000 해서 mg로 변환한다(안 하면 센터 DB 관례와 어긋나서
//                                      나트륨이 1000배 작게 보임).
// 크레아틴 단일 제품처럼 칼로리 자체가 없는 상품은 "영양정보" 표 대신 "유효성분" 표만 있어서
// 100g당/NNg당 헤더가 없다 — 이런 상품은 건너뛴다(값을 지어내지 않음).
// 같은 상품이라도 맛(flavor)마다 페이지가 나뉘지 않고 "무맛 기준" 하나로 통일돼 있어
// (상세페이지 안내문 "*영양 정보는 무맛 기준 ... 선택한 맛에 따라 성분은 다를 수 있습니다" 확인함),
// 상품당 1개 기준값만 저장한다 — 맛별 차이는 반영 못 함(확인 못 함 / 추정 아님, 공식 사이트가
// 애초에 무맛 기준 하나만 공개).
const CATEGORIES = [
  { path: '/c/nutrition/protein/', label: '단백질보충제' },
  { path: '/c/nutrition/creatine/', label: '크레아틴' },
  { path: '/c/all-offers/kr-amino-acids/', label: '아미노산' },
  { path: '/c/nutrition/vitamins/', label: '비타민' },
  { path: '/c/nutrition/kr-weight-loss-supplements/', label: '다이어트보조식품' },
  { path: '/c/nutrition/kr-healthy-food-drinks/', label: '프로틴식품' },
  { path: '/c/nutrition/carbohydrates/', label: '탄수화물보충제' },
];

const NUTRIENT_LABEL_MAP = {
  지방: 'fat',
  포화지방: 'saturatedFat',
  트랜스지방: 'transFat',
  탄수화물: 'carb',
  당류: 'sugar',
  식이섬유: 'fiber',
  단백질: 'protein',
  나트륨: 'sodium',
  카페인: 'caffeine',
};

async function collectProductUrls() {
  const urls = new Map(); // url -> [categoryLabels]
  for (const cat of CATEGORIES) {
    const response = await fetch(`${origin}${cat.path}`, {
      headers: { 'user-agent': 'MOMGAGYM nutrition DB importer', accept: 'text/html' },
    });
    if (!response.ok) {
      console.error(`[경고] 마이프로틴 카테고리(${cat.label})를 불러오지 못함: HTTP ${response.status}`);
      continue;
    }
    const html = await response.text();
    const links = [...new Set([...html.matchAll(/href="(\/p\/[^"?#]+)"/g)].map((m) => m[1]))];
    for (const link of links) {
      const url = `${origin}${link}`;
      if (!urls.has(url)) urls.set(url, []);
      urls.get(url).push(cat.label);
    }
  }
  return urls;
}

function extractNutritionTable(html) {
  // "영양정보" 표만 정확히 집어내기 위해, <table>...</table> 블록 중에서 헤더 행에
  // "100g당"과 "N g당"이 둘 다 있는 표만 찾는다(유효성분 표/다른 표와 섞이지 않게).
  const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)].map((m) => m[1]);
  for (const table of tables) {
    const rows = [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((tr) =>
      [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) =>
        c[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(),
      ),
    );
    // "100g당"칸과, 그와 별개로 "N g당"(1회 제공량) 칸이 둘 다 있는 표만 진짜 영양정보 표로 인정.
    const headerRow = rows.find(
      (row) => row.some((cell) => cell === '100g당') && row.some((cell) => /^\d+(\.\d+)?g당$/.test(cell) && cell !== '100g당'),
    );
    if (!headerRow) continue;

    // "100g당"도 /^\d+(\.\d+)?g당$/에 걸리므로, 100g당 칸 자체는 제외하고 찾아야 함
    // (아니면 항상 100g당 칸(index 1)을 "1회 제공량" 칸으로 잘못 읽게 됨 — 테스트로 발견).
    const servingCellIndex = headerRow.findIndex((cell) => /^\d+(\.\d+)?g당$/.test(cell) && cell !== '100g당');
    const servingGramMatch = headerRow[servingCellIndex].match(/^(\d+(?:\.\d+)?)g당$/);
    const servingGram = servingGramMatch ? Number.parseFloat(servingGramMatch[1]) : null;
    if (!servingGram) continue;

    return { rows, servingCellIndex, servingGram };
  }
  return null;
}

function parseNutrients(rows, servingCellIndex) {
  const nutrients = {
    calories: null, carb: null, sugar: null, protein: null, fat: null,
    saturatedFat: null, transFat: null, sodium: null, fiber: null, caffeine: null,
  };

  for (const row of rows) {
    const label = row[0];
    const valueText = row[servingCellIndex];
    if (!label || !valueText) continue;

    if (label === '열량') {
      // "열량" 행이 kJ용·kcal용 두 줄로 나뉘어 있음 — 단위로 구분(행 순서에 의존하지 않음).
      if (/kcal/i.test(valueText)) {
        nutrients.calories = toNumber(valueText);
      }
      continue;
    }

    const key = NUTRIENT_LABEL_MAP[label];
    if (!key) continue;
    const amount = toNumber(valueText);
    if (amount == null) continue;
    // 나트륨은 이 사이트가 g 단위로 표기 — 센터 DB 관례(mg)에 맞춰 1000배 환산.
    nutrients[key] = key === 'sodium' ? round(amount * 1000) : amount;
  }

  return nutrients;
}

function toNumber(text) {
  const match = String(text || '').match(/(\d+(?:\.\d+)?)/);
  return match ? Number.parseFloat(match[1]) : null;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function cleanText(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const productUrls = await collectProductUrls();
const allImported = [];
let skippedNoTable = 0;
let skippedNoName = 0;

for (const [url, categoryLabels] of productUrls.entries()) {
  const response = await fetch(url, { headers: { 'user-agent': 'MOMGAGYM nutrition DB importer' } });
  if (!response.ok) continue;
  const html = await response.text();

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const productName = h1Match ? cleanText(h1Match[1]) : '';
  if (!productName) {
    skippedNoName += 1;
    continue;
  }

  const table = extractNutritionTable(html);
  if (!table) {
    skippedNoTable += 1; // 유효성분만 있고 칼로리 표가 없는 상품(순수 크레아틴 등) — 값 지어내지 않고 건너뜀
    continue;
  }

  const nutrients = parseNutrients(table.rows, table.servingCellIndex);
  if (nutrients.calories == null) {
    skippedNoTable += 1;
    continue;
  }

  const totalServingMatch = html.match(/총\s*(\d+)\s*회\s*제공량/);
  const category = categoryLabels[0] || '기타';

  allImported.push({
    id: `myprotein-${stableId(url)}`,
    brand,
    productName,
    aliases: [...new Set([`마이프로틴 ${productName}`, `Myprotein ${productName}`, productName, productName.replace(/\s+/g, '')])],
    category: `${brand}/${category}`,
    servingSize: `1회 제공량 (${table.servingGram}g)`,
    servingGram: table.servingGram,
    sourceType: 'official_nutrition_page',
    sourceLabel: '마이프로틴 코리아 공식 홈페이지 상품 상세 페이지 영양정보',
    sourceUrl: url,
    verifiedAt: new Date().toISOString().slice(0, 10),
    allergens: [],
    additiveWatch: [nutrients.saturatedFat != null && nutrients.saturatedFat >= 10 ? '포화지방' : ''].filter(Boolean),
    nutrients,
    reviewNote:
      '마이프로틴 코리아 공식 홈페이지 상품 상세 페이지의 "영양정보" 표(무맛 기준, 1회 제공량 기준)를 그대로 저장했습니다. '
      + (totalServingMatch ? `총 ${totalServingMatch[1]}회 제공량 기준 포장입니다. ` : '')
      + '나트륨은 원문이 g 단위라 mg로 환산했습니다. 맛(flavor)에 따라 실제 수치는 다를 수 있습니다(공식 사이트가 무맛 기준 1개만 공개).',
  });
}

const totalParsed = allImported.length;
if (totalParsed < 30) {
  throw new Error(
    `마이프로틴 공식 영양정보가 ${totalParsed}개만 확인되어 병합을 중단했습니다. `
    + `(상품 링크 ${productUrls.size}개, 표 없음/건너뜀 ${skippedNoTable}개, 이름 없음 ${skippedNoName}개 — 사이트 구조가 바뀌었을 수 있습니다)`,
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
    {
      ok: true,
      brand,
      imported: imported.length,
      totalProducts: database.products.length,
      linksFound: productUrls.size,
      skippedNoTable,
      skippedNoName,
    },
    null,
    2,
  ),
);

function stableId(value) {
  return createHash('sha1').update(value).digest('hex').slice(0, 12);
}
