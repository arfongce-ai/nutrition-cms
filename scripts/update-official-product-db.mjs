import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const productPath = path.join(rootDir, 'data', 'official-products.json');
const sourcePath = path.join(rootDir, 'data', 'official-product-sources.json');

const args = process.argv.slice(2);
const validateOnly = args.includes('--validate-only');
const quarterly = args.includes('--quarterly');
const seedFiles = getRepeatedArgValues('--seed');

const products = JSON.parse(await fs.readFile(productPath, 'utf8'));
const sources = JSON.parse(await fs.readFile(sourcePath, 'utf8'));

validateProductDatabase(products);
validateSourceDatabase(sources);

if (seedFiles.length && !validateOnly) {
  const extracted = [];
  for (const file of seedFiles) {
    const text = await fs.readFile(path.resolve(rootDir, file), 'utf8');
    extracted.push(...extractSourcesFromMarkdown(text));
  }

  sources.sources = mergeSources(sources.sources, extracted);
}

if (quarterly && !validateOnly) {
  const checkedAt = new Date().toISOString().slice(0, 10);
  products.updatedAt = checkedAt;
  sources.updatedAt = checkedAt;
  sources.sources = sources.sources.map((source) => ({
    ...source,
    lastScheduledReviewAt: checkedAt,
    reviewNote: source.reviewNote || 'Quarterly source review scheduled. Product-level nutrition values must be verified before use.',
  }));
}

if (!validateOnly) {
  await fs.writeFile(productPath, `${JSON.stringify(products, null, 2)}\n`, 'utf8');
  await fs.writeFile(sourcePath, `${JSON.stringify(sources, null, 2)}\n`, 'utf8');
}

console.log(
  JSON.stringify(
    {
      ok: true,
      products: products.products.length,
      sources: sources.sources.length,
      validateOnly,
      quarterly,
    },
    null,
    2,
  ),
);

function getRepeatedArgValues(flag) {
  const values = [];
  args.forEach((arg, index) => {
    if (arg === flag && args[index + 1]) values.push(args[index + 1]);
  });
  return values;
}

function extractSourcesFromMarkdown(text) {
  const rows = [];
  let category = '미분류';

  String(text || '')
    .split(/\r?\n/)
    .forEach((line) => {
      const heading = line.match(/^#{2,4}\s*(.+)$/);
      if (heading) {
        category = heading[1].replace(/\s*[-–]\s*\d+곳.*/, '').trim();
        return;
      }

      const match = line.match(/^\s*\d+\.\s+\*\*(.+?)\*\*:\s+\[(.+?)\]\((https?:\/\/[^)]+)\)/);
      if (!match) return;

      const brand = match[1].replace(/\s*\(.+?\)\s*/g, '').trim();
      const url = cleanUrl(match[3]);
      if (!brand || !url) return;

      rows.push({
        brand,
        category,
        url,
        aliases: createAliases(brand),
        sourceKind: inferSourceKind(line),
      });
    });

  return rows;
}

function cleanUrl(url) {
  const value = String(url || '').trim();
  const googleMatch = value.match(/[?&]q=(https?:\/\/.+)$/);
  if (googleMatch) {
    try {
      return decodeURIComponent(googleMatch[1]);
    } catch {
      return googleMatch[1];
    }
  }
  return value;
}

function createAliases(brand) {
  return [...new Set(String(brand).split(/[\/·()]/).map((part) => part.trim()).filter(Boolean).concat(brand))];
}

function inferSourceKind(line) {
  if (/영양|성분|nutrition|allergy|알레르기/i.test(line)) return 'official_menu_or_nutrition';
  if (/스마트스토어|shop|mall/i.test(line)) return 'official_shop_or_smartstore';
  return 'official_homepage';
}

function mergeSources(current, next) {
  const byKey = new Map();
  [...current, ...next].forEach((source) => {
    const key = `${normalize(source.brand)}|${normalize(source.url)}`;
    if (!key.includes('|')) return;
    const previous = byKey.get(key) || {};
    byKey.set(key, {
      ...previous,
      ...source,
      aliases: [...new Set([...(previous.aliases || []), ...(source.aliases || [])])],
    });
  });
  return [...byKey.values()].sort((a, b) => a.brand.localeCompare(b.brand, 'ko'));
}

function validateProductDatabase(data) {
  if (!Array.isArray(data.products)) throw new Error('official-products.json must contain products array.');
  data.products.forEach((product) => {
    const required = ['id', 'brand', 'productName', 'sourceUrl', 'nutrients'];
    required.forEach((key) => {
      if (!product[key]) throw new Error(`Product ${product.id || product.productName || 'unknown'} is missing ${key}.`);
    });
  });
}

function validateSourceDatabase(data) {
  if (!Array.isArray(data.sources)) throw new Error('official-product-sources.json must contain sources array.');
  data.sources.forEach((source) => {
    if (!source.brand || !source.url) throw new Error('Every source must include brand and url.');
  });
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '');
}
