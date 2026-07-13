import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const productPath = path.join(rootDir, 'data', 'official-products.json');
const defaultOutputPath = path.join(rootDir, 'data', 'imported', 'd1-official-products-seed.sql');
const args = process.argv.slice(2);
const outputPath = path.resolve(rootDir, getArg('--out', defaultOutputPath));

const productData = JSON.parse(await fs.readFile(productPath, 'utf8'));
const products = Array.isArray(productData.products) ? productData.products : [];
const brands = collectBrands(products);
const lines = [
  '-- Generated from data/official-products.json. Review before applying to production D1.',
  'PRAGMA foreign_keys = ON;',
  '',
];

brands.forEach((brand) => {
  lines.push(
    `INSERT INTO brands (brand_name, category, list_page_url, nutrition_page_url, deeplink_pattern, scrap_method, updated_at) VALUES (${[
      sqlString(brand.brandName),
      sqlString(brand.category),
      sqlString(brand.listPageUrl),
      sqlString(brand.nutritionPageUrl),
      'NULL',
      sqlString(brand.scrapMethod),
      sqlString(today()),
    ].join(', ')}) ON CONFLICT(brand_name) DO UPDATE SET category = excluded.category, list_page_url = excluded.list_page_url, nutrition_page_url = excluded.nutrition_page_url, scrap_method = excluded.scrap_method, updated_at = excluded.updated_at;`,
  );
});

lines.push('');

products.forEach((product) => {
  const nutrients = product.nutrients || {};
  lines.push(
    `INSERT INTO brand_menus (${[
      'brand_id',
      'menu_name',
      'aliases_json',
      'item_code_val',
      'serving_label',
      'serving_size_g',
      'calories_kcal',
      'carbohydrates_g',
      'protein_g',
      'fat_g',
      'saturated_fat_g',
      'trans_fat_g',
      'sugar_g',
      'sodium_mg',
      'caffeine_mg',
      'source_type',
      'source_label',
      'detail_deeplink_url',
      'image_url',
      'verified_at',
      'updated_at',
    ].join(', ')}) VALUES (${[
      `(SELECT brand_id FROM brands WHERE brand_name = ${sqlString(product.brand)})`,
      sqlString(product.productName),
      sqlString(JSON.stringify(product.aliases || [])),
      sqlString(product.sourceProductCode || ''),
      sqlString(product.servingSize || ''),
      sqlNumber(product.servingGram),
      sqlNumber(nutrients.calories),
      sqlNumber(nutrients.carb),
      sqlNumber(nutrients.protein),
      sqlNumber(nutrients.fat),
      sqlNumber(nutrients.saturatedFat),
      sqlNumber(nutrients.transFat),
      sqlNumber(nutrients.sugar),
      sqlNumber(nutrients.sodium),
      sqlNumber(nutrients.caffeine ?? 0),
      sqlString(product.sourceType || 'official_menu_page'),
      sqlString(product.sourceLabel || ''),
      sqlString(product.sourceUrl || ''),
      sqlString(product.imageUrl || ''),
      sqlString(product.verifiedAt || productData.updatedAt || ''),
      sqlString(today()),
    ].join(', ')}) ON CONFLICT(brand_id, menu_name, item_code_val) DO UPDATE SET aliases_json = excluded.aliases_json, serving_label = excluded.serving_label, serving_size_g = excluded.serving_size_g, calories_kcal = excluded.calories_kcal, carbohydrates_g = excluded.carbohydrates_g, protein_g = excluded.protein_g, fat_g = excluded.fat_g, saturated_fat_g = excluded.saturated_fat_g, trans_fat_g = excluded.trans_fat_g, sugar_g = excluded.sugar_g, sodium_mg = excluded.sodium_mg, caffeine_mg = excluded.caffeine_mg, source_type = excluded.source_type, source_label = excluded.source_label, detail_deeplink_url = excluded.detail_deeplink_url, image_url = excluded.image_url, verified_at = excluded.verified_at, updated_at = excluded.updated_at;`,
  );
});

lines.push('');

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, lines.join('\n'), 'utf8');

console.log(
  JSON.stringify(
    {
      ok: true,
      brands: brands.length,
      products: products.length,
      output: path.relative(rootDir, outputPath),
    },
    null,
    2,
  ),
);

function collectBrands(rows) {
  const byBrand = new Map();
  rows.forEach((product) => {
    if (!product.brand) return;
    const current = byBrand.get(product.brand) || {
      brandName: product.brand,
      category: product.category || '공식 메뉴',
      listPageUrl: product.sourceUrl || '',
      nutritionPageUrl: product.sourceUrl || '',
      scrapMethod: product.sourceType === 'verified_label_photo' ? 'MANUAL' : 'OFFICIAL_JSON',
    };

    current.category = current.category || product.category || '공식 메뉴';
    current.listPageUrl = current.listPageUrl || product.sourceUrl || '';
    current.nutritionPageUrl = current.nutritionPageUrl || product.sourceUrl || '';
    if (String(product.brand).includes('스타벅스')) current.scrapMethod = 'OFFICIAL_JSON';
    byBrand.set(product.brand, current);
  });
  return [...byBrand.values()].sort((a, b) => a.brandName.localeCompare(b.brandName, 'ko'));
}

function sqlString(value) {
  if (value == null || value === '') return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : 'NULL';
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function getArg(name, fallback = '') {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] || fallback;
}
