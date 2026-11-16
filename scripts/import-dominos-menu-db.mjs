import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const productPath = path.join(rootDir, 'data', 'official-products.json');
const brand = '도미노피자';

// 도미노피자 공식 사이트(web.dominos.co.kr)의 상품 상세 페이지.
// Claude in Chrome으로 실제 페이지 구조 확인함(2026-10-20): 이 사이트는 루트(web.dominos.co.kr/)는
// 빈 SPA 셸이라 직접 수집이 안 되지만, 개별 상품 상세 페이지(/goods/<slug>)는 서버에서 렌더링되어
// 전달되며(plain fetch로 확인 — JS 실행 없이도 <table> 9개가 그대로 들어있음), 그 안에
// "원산지·영양성분·알레르기 유발성분 정보" 모달의 영양성분 표 전체(피자/사이드/마이키친/음료 전 라인업)가
// 통째로 포함되어 있다. 즉 상품 1개 페이지만 받아도 전체 메뉴 영양정보를 얻을 수 있다.
// 혹시 이 slug(hnh = 하프앤하프)가 없어지면, 다른 /goods/<slug> 상품 페이지로 바꿔도 같은 표가 나올 가능성이 높다.
const sourceUrl = 'https://web.dominos.co.kr/goods/hnh';

// 표마다 열 구성이 달라 열 개수로 표 종류를 구분한다(표 순서가 바뀌어도 안전하도록 index가 아닌 헤더 열 개수로 판정).
// 공식 제공 필드는 열량·단백질·포화지방·나트륨·당류뿐이며 탄수화물·지방·트랜스지방·카페인은 표에 없음(null로 둠).
const TABLE_SHAPES = {
  9: { label: '피자', columns: ['productName', 'totalWeight', 'servingUnit', 'servingWeight', 'calories', 'protein', 'saturatedFat', 'sodium', 'sugar'] },
  7: { label: '사이드&마이키친', columns: ['productName', 'totalWeight', 'calories', 'protein', 'saturatedFat', 'sodium', 'sugar'] },
  6: { label: '음료&소스', columns: ['productName', 'calories', 'protein', 'saturatedFat', 'sodium', 'sugar'] },
};

const response = await fetch(sourceUrl, {
  headers: {
    accept: 'text/html,application/xhtml+xml',
    'user-agent': 'MOMGAGYM nutrition DB importer',
  },
});

if (!response.ok) {
  throw new Error(`도미노피자 공식 상품 페이지를 불러오지 못했습니다. HTTP ${response.status}`);
}

// 주의: 이 페이지는 UTF-8이 아니라 EUC-KR로 서비스됨(Claude in Chrome으로 document.characterSet 확인,
// 2026-10-20). UTF-8로 디코딩하면 한글이 모두 깨지므로 반드시 euc-kr로 디코딩해야 한다.
const html = new TextDecoder('euc-kr').decode(await response.arrayBuffer());
const { products: allImported, sourceSummaries } = parseAllTables(html, sourceUrl);

const totalParsed = allImported.length;
if (totalParsed < 150) {
  // 사이트 구조가 바뀌어 파싱이 깨졌을 가능성이 높아 기존 데이터를 지키기 위해 중단합니다.
  throw new Error(
    `도미노피자 공식 메뉴가 ${totalParsed}개만 확인되어 병합을 중단했습니다. (표별: ${JSON.stringify(sourceSummaries)})`,
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

function parseAllTables(htmlText, pageUrl) {
  const products = [];
  const sourceSummaries = [];

  const tableBlocks = [...htmlText.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)].map((m) => m[1]);

  for (const tableHtml of tableBlocks) {
    const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
    if (rows.length < 2) continue; // 헤더만 있거나 빈 표

    const headerCells = extractCells(rows[0]);
    const shape = TABLE_SHAPES[headerCells.length];
    if (!shape) continue; // 알레르기·원산지·토핑 표 등 영양성분이 아닌 표는 건너뜀

    let count = 0;
    for (const rowHtml of rows.slice(1)) {
      const cells = extractCells(rowHtml);
      if (cells.length !== shape.columns.length) continue;

      const row = {};
      shape.columns.forEach((key, idx) => {
        row[key] = cells[idx];
      });

      const productName = cleanText(row.productName);
      if (!productName) continue;

      const nutrients = {
        calories: parseNutrientValue(row.calories),
        carb: null,
        sugar: parseNutrientValue(row.sugar),
        protein: parseNutrientValue(row.protein),
        fat: null,
        saturatedFat: parseNutrientValue(row.saturatedFat),
        transFat: null,
        sodium: parseNutrientValue(row.sodium),
        caffeine: null,
      };

      const hasAnyNutrient = Object.values(nutrients).some((v) => v !== null);
      if (!hasAnyNutrient) continue;

      const servingGram = parseNutrientValue(row.servingWeight ?? row.totalWeight);
      const servingSize = row.servingUnit
        ? `${cleanText(row.servingUnit)} (${servingGram ?? '?'}g, 총 ${parseNutrientValue(row.totalWeight) ?? '?'}g)`
        : row.totalWeight
          ? `1개 (총 ${parseNutrientValue(row.totalWeight) ?? '?'}g)`
          : '1개';

      products.push({
        id: `dominos-${stableId(`${shape.label}|${productName}`)}`,
        brand,
        productName,
        aliases: [...new Set([`도미노피자 ${productName}`, productName, productName.replace(/\s+/g, '')])],
        category: `${brand}/${shape.label}`,
        servingSize,
        servingGram,
        sourceType: 'official_nutrition_page',
        sourceLabel: '도미노피자 공식 홈페이지 원산지·영양성분·알레르기 유발성분 정보',
        sourceUrl: pageUrl,
        verifiedAt: new Date().toISOString().slice(0, 10),
        allergens: [],
        additiveWatch: [
          nutrients.saturatedFat != null && nutrients.saturatedFat >= 10 ? '포화지방' : '',
        ].filter(Boolean),
        nutrients,
        reviewNote:
          '도미노피자 공식 홈페이지 상품 상세 페이지의 "원산지·영양성분·알레르기 유발성분 정보" 모달 중 영양성분 표를 그대로 저장했습니다. 공식 표에 탄수화물·지방·트랜스지방·카페인 항목이 없어 null입니다.',
      });
      count += 1;
    }
    sourceSummaries.push({ shape: shape.label, columns: headerCells.length, count });
  }

  return { products, sourceSummaries };
}

function extractCells(rowHtml) {
  return [...rowHtml.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => cleanText(m[1]));
}

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
