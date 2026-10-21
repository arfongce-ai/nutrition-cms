import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const productPath = path.join(rootDir, 'data', 'official-products.json');
const brand = '네네치킨';

// 네네치킨 공식 사이트(nenechicken.com)의 상품 상세 페이지(home_menu_detail.asp)에서
// "원산지/알레르기유발성분표/영양성분표/중량" 링크를 누르면 jQuery가
// POST https://nenechicken.com/process/origin_detail.asp (body: no=<상품번호>&subid=<하위번호>)
// 를 호출해 모달 HTML을 통째로 받아온다(Claude in Chrome으로 fetch/XHR 가로채기로 확인함, 2026-10-20).
// 이 응답 안의 <div id="NENE3" class="Subcon"> 표 하나가 네네치킨 전체 치킨 메뉴(제품당
// 부위별로 여러 행, 제품명 셀은 rowspan으로 묶임)의 열량·나트륨·당류·포화지방·단백질을 전부 담고
// 있다 — 즉 상품 아무거나 1건(no=1001&subid=5 = 후라이드)만 호출해도 치킨 전체 표를 얻는다.
// (옆에 <div id="PIZAA3">에 피자 표도 있지만 이 센터는 치킨 프랜차이즈 비교 목적이라 치킨만 수집한다.)
// 주의: 이 엔드포인트는 일반 페이지 fetch와 달리 그냥 GET으로 요청하면 빈 데이터를 주므로
// 반드시 POST + x-www-form-urlencoded body로 호출해야 한다. robots.txt는 /manager/, /Program/
// 만 차단하므로 이 경로는 허용된다.
const sourceUrl = 'https://nenechicken.com/process/origin_detail.asp';

const response = await fetch(sourceUrl, {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'user-agent': 'MOMGAGYM nutrition DB importer',
  },
  body: 'no=1001&subid=5',
});

if (!response.ok) {
  throw new Error(`네네치킨 공식 영양정보 API를 불러오지 못했습니다. HTTP ${response.status}`);
}

const html = await response.text();
const startIdx = html.indexOf('id="NENE3"');
const endIdx = html.indexOf('id="PIZAA3"');
if (startIdx === -1) {
  throw new Error('네네치킨 공식 영양정보 응답에서 치킨 영양성분표(#NENE3)를 찾지 못했습니다. 사이트 구조가 바뀌었을 수 있습니다.');
}
const tableHtml = html.slice(startIdx, endIdx === -1 ? undefined : endIdx);

const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);

const allImported = [];
let currentProductGroup = '';

for (const rowHtml of rows) {
  const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cleanText(m[1]));
  if (cells.length === 0) continue; // 헤더 행(th)

  let subCategory;
  let calories;
  let sodium;
  let sugar;
  let saturatedFat;
  let protein;

  if (cells.length === 7) {
    // 제품명(rowspan 시작) + 소분류 + 5개 영양소
    currentProductGroup = cells[0];
    [, subCategory, calories, sodium, sugar, saturatedFat, protein] = cells;
  } else if (cells.length === 6) {
    // rowspan으로 제품명 생략, 소분류부터 시작
    [subCategory, calories, sodium, sugar, saturatedFat, protein] = cells;
  } else {
    continue; // 예상 밖 구조(비고 행 등)는 건너뜀
  }

  if (!currentProductGroup || !subCategory) continue;

  const productName = subCategory === '-' || subCategory === currentProductGroup
    ? currentProductGroup
    : `${currentProductGroup} ${subCategory}`;

  const nutrients = {
    calories: parseNutrientValue(calories),
    carb: null,
    sugar: parseNutrientValue(sugar),
    protein: parseNutrientValue(protein),
    fat: null,
    saturatedFat: parseNutrientValue(saturatedFat),
    transFat: null,
    sodium: parseNutrientValue(sodium),
    caffeine: null,
  };

  if (nutrients.calories == null) continue;

  allImported.push({
    id: `nenechicken-${stableId(productName)}`,
    brand,
    productName,
    aliases: [...new Set([`네네치킨 ${productName}`, productName, productName.replace(/\s+/g, '')])],
    category: `${brand}/치킨`,
    servingSize: '1인분',
    servingGram: null,
    sourceType: 'official_nutrition_page',
    sourceLabel: '네네치킨 공식 홈페이지 원산지/알레르기유발성분표/영양성분표 모달',
    sourceUrl: 'https://nenechicken.com/home_menu_detail.asp?no=1001&subid=5&GUBUN=MENU',
    verifiedAt: new Date().toISOString().slice(0, 10),
    allergens: [],
    additiveWatch: [
      nutrients.saturatedFat != null && nutrients.saturatedFat >= 10 ? '포화지방' : '',
    ].filter(Boolean),
    nutrients,
    reviewNote:
      '네네치킨 공식 홈페이지 상품 상세 페이지의 "영양성분표/중량" 모달(치킨 표 전체)을 그대로 저장했습니다. '
      + '표에 탄수화물·지방·트랜스지방·카페인·1회 제공량(g) 항목이 없어 null입니다. 제품명은 "분류 소분류"(예: "후라이드(마일드) 한마리") 형태입니다.',
  });
}

const totalParsed = allImported.length;
if (totalParsed < 10) {
  // 사이트 구조가 바뀌어 파싱이 깨졌을 가능성이 높아 기존 데이터를 지키기 위해 중단합니다.
  throw new Error(`네네치킨 공식 메뉴가 ${totalParsed}개만 확인되어 병합을 중단했습니다.`);
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
    { ok: true, brand, imported: imported.length, totalProducts: database.products.length },
    null,
    2,
  ),
);

function parseNutrientValue(value) {
  if (value == null) return null;
  const text = String(value).replace(/,/g, '').trim();
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
