import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const productPath = path.join(rootDir, 'data', 'official-products.json');
const brand = '빽다방';

// 빽다방 공식 사이트의 메뉴 카테고리 5개 (2026-10-20 확인).
// 카테고리가 추가/삭제되면 이 목록을 갱신해야 합니다.
const CATEGORY_PAGES = [
  { slug: 'menu_new', label: '신메뉴' },
  { slug: 'menu_coffee', label: '커피' },
  { slug: 'menu_drink', label: '음료' },
  { slug: 'menu_dessert', label: '아이스크림/디저트' },
  { slug: 'menu_ccino', label: '빽스치노' },
];

const NUTRIENT_FIELD_MAP = {
  칼로리: 'calories',
  카페인: 'caffeine',
  나트륨: 'sodium',
  탄수화물: 'carb',
  당류: 'sugar',
  포화지방: 'saturatedFat',
  트랜스지방: 'transFat',
  단백질: 'protein',
  지방: 'fat',
};

const allImported = [];
const sourceSummaries = [];

for (const { slug, label } of CATEGORY_PAGES) {
  const sourceUrl = `https://paikdabang.com/menu/${slug}/`;
  const response = await fetch(sourceUrl, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'MOMGAGYM nutrition DB importer',
    },
  });

  if (!response.ok) {
    throw new Error(`빽다방 공식 메뉴(${label})를 불러오지 못했습니다. HTTP ${response.status}`);
  }

  const html = new TextDecoder('utf-8').decode(await response.arrayBuffer());
  const verifiedAt = extractVerifiedAt(html);
  const parsed = parseCategoryPage(html, { category: label, sourceUrl, verifiedAt });
  sourceSummaries.push({ label, sourceUrl, count: parsed.length });
  allImported.push(...parsed);
}

const totalParsed = allImported.length;
if (totalParsed < 100) {
  // 사이트 구조가 바뀌어 파싱이 깨졌을 가능성이 높아 기존 데이터를 지키기 위해 중단합니다.
  throw new Error(
    `빽다방 공식 메뉴가 ${totalParsed}개만 확인되어 병합을 중단했습니다. (카테고리별: ${JSON.stringify(sourceSummaries)})`,
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
      sources: sourceSummaries,
    },
    null,
    2,
  ),
);

function parseCategoryPage(htmlText, { category, sourceUrl, verifiedAt }) {
  const products = [];

  // <li> 안에서 상품명은 <p class="menu_tit">에 정확히 한 번만 나옵니다.
  // 이 태그를 상품 경계로 써서, 한 상품명부터 다음 상품명 전까지를 그 상품의 조각(chunk)으로 잘라냅니다.
  // (li 안에 ingredient_table이라는 또 다른 ul>li가 중첩돼 있어, 괄호 짝 맞추기로 li를 직접 자르면
  //  잘못된 지점에서 끝나기 쉬우므로 이 방식을 씁니다.)
  const titlePattern = /<p class="menu_tit">([\s\S]*?)<\/p>/gi;
  const marks = [];
  let titleMatch;
  while ((titleMatch = titlePattern.exec(htmlText))) {
    marks.push({ index: titleMatch.index, name: cleanText(titleMatch[1]) });
  }

  for (let i = 0; i < marks.length; i += 1) {
    const { index, name: productName } = marks[i];
    if (!productName) continue;
    const end = i + 1 < marks.length ? marks[i + 1].index : htmlText.length;
    const chunk = htmlText.slice(index, end);

    const basisLines = [...chunk.matchAll(/<p class="menu_ingredient_basis">([\s\S]*?)<\/p>/gi)].map((m) =>
      cleanText(m[1]),
    );
    const allergenLine = basisLines.find((line) => line.includes('알레르기'));
    const capacityLine = basisLines.find((line) => line.includes('컵용량'));

    const tableMatch = chunk.match(/<ul class="ingredient_table">([\s\S]*?)<\/ul>/i);
    const nutrients = {
      calories: null,
      carb: null,
      sugar: null,
      protein: null,
      fat: null,
      saturatedFat: null,
      transFat: null,
      sodium: null,
      fiber: null,
      leucine: null,
      caffeine: null,
    };

    if (tableMatch) {
      const rowPattern = /<li>\s*<div>([^<]+)<\/div>\s*<div>([^<]*)<\/div>\s*<\/li>/gi;
      let rowMatch;
      while ((rowMatch = rowPattern.exec(tableMatch[1]))) {
        const rawLabel = cleanText(rowMatch[1]);
        const rawValue = cleanText(rowMatch[2]);
        const labelName = rawLabel.replace(/\([^)]*\)/, '').trim();
        const field = NUTRIENT_FIELD_MAP[labelName];
        if (field) {
          nutrients[field] = parseNutrientValue(rawValue);
        }
      }
    }

    products.push({
      id: `paikdabang-${stableId(`${category}|${productName}`)}`,
      brand,
      productName,
      aliases: createAliases(productName),
      category: `${brand}/${category}`,
      servingSize: capacityLine ? capacityLine.replace(/^※\s*/, '') : '1회 제공량',
      servingGram: null,
      sourceType: 'official_nutrition_page',
      sourceLabel: '빽다방 공식 홈페이지 메뉴 영양정보',
      sourceUrl,
      verifiedAt,
      allergens: allergenLine
        ? allergenLine
            .replace(/^※\s*알레르기 유발 성분\s*:\s*/, '')
            .split(/[,·\s]+/)
            .map((value) => value.trim())
            .filter(Boolean)
        : [],
      additiveWatch: [
        nutrients.caffeine && nutrients.caffeine > 0 ? '카페인' : '',
        nutrients.saturatedFat != null && nutrients.saturatedFat >= 10 ? '포화지방' : '',
      ].filter(Boolean),
      nutrients,
      reviewNote:
        '빽다방 공식 홈페이지 메뉴 상세의 영양정보 표를 그대로 저장했습니다. 표에 없는 항목은 null입니다.',
    });
  }

  return products;
}

function extractVerifiedAt(htmlText) {
  const text = cleanText(htmlText);
  const match = text.match(/(20\d{2})[.\-](\d{2})[.\-](\d{2})\s*(기준|부터|시행)/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : new Date().toISOString().slice(0, 10);
}

function createAliases(productName) {
  const compact = productName.replace(/\s+/g, '');
  return [
    ...new Set([`빽다방 ${productName}`, productName, compact]),
  ];
}

function parseNutrientValue(value) {
  const text = String(value || '').replace(/,/g, '').trim();
  if (!text || text === '-' || text === '–') return null;
  if (/1\s*g?\s*미만/i.test(text)) return 0.5;
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
