import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const productPath = path.join(rootDir, 'data', 'official-products.json');
const sourceUrl = 'https://www.lotteeatz.com/upload/etc/kkd/items.html';
const brand = '크리스피크림도넛';

const response = await fetch(sourceUrl, {
  headers: {
    accept: 'text/html,application/xhtml+xml',
    'user-agent': 'MOMGAGYM nutrition DB importer',
  },
});

if (!response.ok) {
  throw new Error(`크리스피크림 공식 영양정보를 불러오지 못했습니다. HTTP ${response.status}`);
}

const html = new TextDecoder('utf-8').decode(await response.arrayBuffer());
const verifiedAt = extractVerifiedAt(html);
const imported = parseOfficialMenuRows(html, verifiedAt);

if (imported.length < 50) {
  throw new Error(`공식 메뉴가 ${imported.length}개만 확인되어 병합을 중단했습니다.`);
}

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
      verifiedAt,
      totalProducts: database.products.length,
      sourceUrl,
    },
    null,
    2,
  ),
);

function parseOfficialMenuRows(htmlText, date) {
  const products = [];
  const tbodyPattern = /<tbody[^>]*>([\s\S]*?)<\/tbody>/gi;
  let tbodyMatch;

  while ((tbodyMatch = tbodyPattern.exec(htmlText))) {
    const body = tbodyMatch[1];
    const category = cleanText(body.match(/<th[^>]*>([\s\S]*?)<\/th>/i)?.[1]) || '메뉴';
    const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowPattern.exec(body))) {
      const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => cleanText(match[1]));
      if (cells.length < 8) continue;

      const [productName, weight, calories, saturatedFat, sugar, protein, sodium, caffeine, allergenText = ''] = cells;
      if (!productName || !weight) continue;

      const servingGram = parseNutrientValue(weight);
      const caffeineValue = parseNutrientValue(caffeine);
      const saturatedFatValue = parseNutrientValue(saturatedFat);

      products.push({
        id: `krispy-kreme-${stableId(`${category}|${productName}`)}`,
        brand,
        productName,
        aliases: createAliases(productName),
        category: `${brand}/${category}`,
        servingSize: servingGram == null ? '1회 제공량' : `${servingGram} g / 1회 제공량`,
        servingGram,
        sourceType: 'official_nutrition_page',
        sourceLabel: '롯데GRS 크리스피크림도넛 공식 영양성분표',
        sourceUrl,
        verifiedAt: date,
        allergens: allergenText
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        additiveWatch: [
          caffeineValue > 0 ? '카페인' : '',
          saturatedFatValue >= 10 ? '포화지방' : '',
        ].filter(Boolean),
        nutrients: {
          calories: parseNutrientValue(calories),
          carb: null,
          sugar: parseNutrientValue(sugar),
          protein: parseNutrientValue(protein),
          fat: null,
          saturatedFat: saturatedFatValue,
          transFat: null,
          sodium: parseNutrientValue(sodium),
          fiber: null,
          leucine: null,
          caffeine: caffeineValue,
        },
        reviewNote: '공식 표에 공개된 중량, 열량, 포화지방, 당류, 단백질, 나트륨, 카페인 및 알레르기 정보만 저장했습니다. 공개되지 않은 탄수화물·총지방 값은 null입니다.',
      });
    }
  }

  const unique = new Map();
  products.forEach((product) => unique.set(`${product.category}|${product.productName}`, product));
  return [...unique.values()];
}

function extractVerifiedAt(htmlText) {
  const text = cleanText(htmlText);
  const match = text.match(/(20\d{2})\.(\d{2})\.(\d{2})일부/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : new Date().toISOString().slice(0, 10);
}

function createAliases(productName) {
  const compact = productName.replace(/\s+/g, '');
  return [...new Set([
    `${brand} ${productName}`,
    `크리스피크림 ${productName}`,
    `크리스피 크림 ${productName}`,
    productName,
    compact,
  ])];
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
