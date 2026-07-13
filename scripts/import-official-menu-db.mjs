import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const productPath = path.join(rootDir, 'data', 'official-products.json');
const defaultOutputPath = path.join(rootDir, 'data', 'imported', 'starbucks-official-products.json');

const args = process.argv.slice(2);
const brand = getArg('--brand', 'starbucks');
const merge = args.includes('--merge');
const dryRun = args.includes('--dry-run');
const outputPath = path.resolve(rootDir, getArg('--out', defaultOutputPath));

const STARBUCKS_CATEGORIES = [
  { kind: 'drink', code: 'W0000171', label: '콜드 브루 커피' },
  { kind: 'drink', code: 'W0000060', label: '브루드 커피' },
  { kind: 'drink', code: 'W0000003', label: '에스프레소' },
  { kind: 'drink', code: 'W0000004', label: '프라푸치노' },
  { kind: 'drink', code: 'W0000005', label: '블렌디드' },
  { kind: 'drink', code: 'W0000422', label: '스타벅스 리프레셔' },
  { kind: 'drink', code: 'W0000061', label: '스타벅스 피지오' },
  { kind: 'drink', code: 'W0000075', label: '티(티바나)' },
  { kind: 'drink', code: 'W0000053', label: '기타 제조 음료' },
  { kind: 'drink', code: 'W0000062', label: '스타벅스 주스(병음료)' },
  { kind: 'food', code: 'W0000013', label: '브레드' },
  { kind: 'food', code: 'W0000032', label: '케이크' },
  { kind: 'food', code: 'W0000033', label: '샌드위치 & 샐러드' },
  { kind: 'food', code: 'W0000054', label: '따뜻한 푸드' },
  { kind: 'food', code: 'W0000055', label: '과일 & 요거트' },
  { kind: 'food', code: 'W0000056', label: '스낵 & 미니 디저트' },
  { kind: 'food', code: 'W0000064', label: '아이스크림' },
];

if (brand !== 'starbucks') {
  throw new Error(`Unsupported brand importer: ${brand}. Currently only "starbucks" is implemented.`);
}

const importedProducts = await importStarbucksProducts();

if (!dryRun) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(
    outputPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        brand: '스타벅스',
        source: 'https://www.starbucks.co.kr/menu/index.do',
        sourceKind: 'official_menu_json',
        importedAt: today(),
        products: importedProducts,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

let mergeStats = null;
if (merge) {
  mergeStats = await mergeIntoOfficialProducts(importedProducts);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      brand,
      fetchedProducts: importedProducts.length,
      output: path.relative(rootDir, outputPath),
      dryRun,
      merge,
      mergeStats,
    },
    null,
    2,
  ),
);

async function importStarbucksProducts() {
  const rows = [];
  for (const category of STARBUCKS_CATEGORIES) {
    const data = await fetchStarbucksCategory(category);
    const products = (Array.isArray(data.list) ? data.list : [])
      .map((item) => toOfficialProduct(item, category))
      .filter(Boolean);
    rows.push(...products);
  }

  return dedupeProducts(rows).sort((a, b) => {
    const categoryOrder = a.category.localeCompare(b.category, 'ko');
    if (categoryOrder) return categoryOrder;
    return a.productName.localeCompare(b.productName, 'ko');
  });
}

async function fetchStarbucksCategory(category) {
  const url = `https://www.starbucks.co.kr/upload/json/menu/${category.code}.js`;
  const response = await fetch(url, {
    headers: {
      accept: 'application/json,text/javascript,*/*',
      'user-agent': 'MOMGAGYM nutrition DB importer',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const text = new TextDecoder('utf-8').decode(await response.arrayBuffer());
  return JSON.parse(text);
}

function toOfficialProduct(item, category) {
  const productName = cleanText(item.product_NM);
  const productCode = cleanText(item.product_CD);
  if (!productName || !productCode || !hasNutritionValue(item)) return null;

  const calories = numberValue(item.kcal);
  const carb = numberValue(item.chabo);
  const protein = numberValue(item.protein);
  const fat = numberValue(item.fat);
  const sugar = numberValue(item.sugars);
  const sodium = numberValue(item.sodium);
  const saturatedFat = numberValue(item.sat_FAT);
  const transFat = numberValue(item.trans_FAT);
  const caffeine = numberValue(item.caffeine);
  const isDrink = category.kind === 'drink';
  const sourceUrl = `https://www.starbucks.co.kr/menu/${isDrink ? 'drink' : 'food'}_view.do?product_cd=${encodeURIComponent(productCode)}`;
  const imageUrl = createImageUrl(item);

  return {
    id: `starbucks-${slugify(productName)}-${productCode}`,
    brand: '스타벅스',
    productName,
    aliases: createAliases(productName),
    category: `스타벅스/${isDrink ? '음료' : '푸드'}/${category.label}`,
    servingSize: isDrink ? 'Tall 사이즈 기준' : '1회 제공량 기준',
    sourceType: 'official_menu_page',
    sourceLabel: `스타벅스 공식 ${isDrink ? '음료' : '푸드'} 영양정보`,
    sourceUrl,
    sourceProductCode: productCode,
    verifiedAt: today(),
    reviewNote: isDrink
      ? '스타벅스 공식 메뉴 JSON 데이터 기준입니다. 음료는 공식 영양정보 표의 Tall 사이즈 기준값을 적용합니다.'
      : '스타벅스 공식 메뉴 JSON 데이터 기준입니다. 푸드는 공식 영양정보 표의 1회 제공량 기준값을 적용합니다.',
    allergens: parseList(item.allergy),
    additiveWatch: createAdditiveWatch({ caffeine, sugar, sodium, saturatedFat }),
    imageUrl,
    nutrients: {
      calories,
      carb,
      sugar,
      protein,
      fat,
      saturatedFat,
      transFat,
      sodium,
      fiber: 0,
      leucine: 0,
      caffeine,
    },
  };
}

async function mergeIntoOfficialProducts(products) {
  const data = JSON.parse(await fs.readFile(productPath, 'utf8'));
  const currentProducts = Array.isArray(data.products) ? data.products : [];
  let added = 0;
  let updated = 0;

  products.forEach((incoming) => {
    const existingIndex = currentProducts.findIndex((product) => isSameProduct(product, incoming));
    if (existingIndex >= 0) {
      const existing = currentProducts[existingIndex];
      currentProducts[existingIndex] = {
        ...existing,
        ...incoming,
        id: existing.id,
        aliases: unique([...(existing.aliases || []), ...(incoming.aliases || [])]),
        nutrients: {
          ...(existing.nutrients || {}),
          ...(incoming.nutrients || {}),
        },
      };
      updated += 1;
      return;
    }

    currentProducts.push(incoming);
    added += 1;
  });

  data.updatedAt = today();
  data.products = currentProducts;

  if (!dryRun) {
    await fs.writeFile(productPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  }

  return {
    added,
    updated,
    totalProducts: data.products.length,
  };
}

function isSameProduct(current, incoming) {
  if (current.id === incoming.id) return true;
  if (current.brand !== incoming.brand) return false;

  if (current.sourceProductCode && current.sourceProductCode === incoming.sourceProductCode) return true;

  return canonicalProductName(current.productName) === canonicalProductName(incoming.productName);
}

function hasNutritionValue(item) {
  return ['kcal', 'chabo', 'protein', 'fat', 'sugars', 'sodium', 'sat_FAT', 'trans_FAT', 'caffeine'].some((key) => {
    const value = String(item[key] ?? '').trim();
    return value !== '' && value !== '-';
  });
}

function createAliases(productName) {
  const noBrand = productName.replace(/^스타벅스\s*/i, '').trim();
  const compact = noBrand.replace(/\s+/g, '');
  return unique([productName, `스타벅스 ${noBrand}`, noBrand, compact]).filter((value) => value && value !== productName);
}

function createAdditiveWatch({ caffeine, sugar, sodium, saturatedFat }) {
  return unique([
    caffeine > 0 ? '카페인' : '',
    sugar >= 20 ? '당류' : '',
    sodium >= 800 ? '나트륨' : '',
    saturatedFat >= 5 ? '포화지방' : '',
  ]).filter(Boolean);
}

function createImageUrl(item) {
  const base = cleanText(item.img_UPLOAD_PATH).replace('www.istarbucks', 'image.istarbucks');
  const filePath = cleanText(item.file_PATH);
  if (!base || !filePath) return '';
  return `${base}${filePath}`;
}

function dedupeProducts(products) {
  const byCode = new Map();
  products.forEach((product) => {
    const key = product.sourceProductCode || canonicalProductName(product.productName);
    const previous = byCode.get(key);
    if (!previous || scoreCompleteness(product) > scoreCompleteness(previous)) {
      byCode.set(key, product);
    }
  });
  return [...byCode.values()];
}

function scoreCompleteness(product) {
  const nutrients = product.nutrients || {};
  return Object.values(nutrients).filter((value) => Number(value) > 0).length;
}

function parseList(value) {
  return cleanText(value)
    .split(/[,/·|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function numberValue(value) {
  const normalized = String(value ?? '').replace(/,/g, '').trim();
  if (!normalized || normalized === '-') return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^0-9a-z가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function canonicalProductName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/^스타벅스\s*/g, '')
    .replace(/\b(tall|grande|venti|trenta)\b/g, '')
    .replace(/사이즈|기준/g, '')
    .replace(/[^0-9a-z가-힣]/g, '');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function unique(items) {
  return [...new Set(items)];
}

function getArg(name, fallback = '') {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] || fallback;
}
