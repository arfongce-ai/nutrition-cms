import officialProductData from '../../data/official-products.json';
import officialSourceData from '../../data/official-product-sources.json';

const PRODUCT_RECORDS = Array.isArray(officialProductData.products) ? officialProductData.products : [];
const SOURCE_RECORDS = Array.isArray(officialSourceData.sources) ? officialSourceData.sources : [];

export function findOfficialProductFood(text) {
  const normalized = normalizeSearchText(text);
  if (!normalized) return null;

  const product = PRODUCT_RECORDS.find((entry) => {
    const terms = [entry.brand, entry.productName, ...(entry.aliases || [])];
    return terms.some((term) => normalized.includes(normalizeSearchText(term)));
  });

  if (!product) return null;
  return toFoodEntry(product);
}

export function findOfficialProductSources(text) {
  const normalized = normalizeSearchText(text);
  if (!normalized) return [];

  return SOURCE_RECORDS.filter((entry) => {
    const terms = [entry.brand, ...(entry.aliases || [])];
    return terms.some((term) => normalized.includes(normalizeSearchText(term)));
  });
}

export function getOfficialProductStats() {
  return {
    productCount: PRODUCT_RECORDS.length,
    sourceCount: SOURCE_RECORDS.length,
    updatedAt: officialProductData.updatedAt || officialSourceData.updatedAt || '',
  };
}

function toFoodEntry(product) {
  const nutrients = product.nutrients || {};
  return {
    brand: product.brand,
    keys: [product.productName, ...(product.aliases || [])],
    serving: product.servingSize || '',
    sourceLabel: product.sourceLabel || `${product.brand} 공식 제품 영양정보`,
    sourceUrl: product.sourceUrl || '',
    category: product.category || '',
    emoji: createEmoji(product.category),
    official: true,
    officialProduct: true,
    perServing: true,
    calories: numberValue(nutrients.calories),
    carb: numberValue(nutrients.carb),
    protein: numberValue(nutrients.protein),
    fat: numberValue(nutrients.fat),
    saturatedFat: numberValue(nutrients.saturatedFat),
    transFat: numberValue(nutrients.transFat),
    sodium: numberValue(nutrients.sodium),
    sugar: numberValue(nutrients.sugar),
    fiber: numberValue(nutrients.fiber),
    leucine: numberValue(nutrients.leucine),
  };
}

function createEmoji(category = '') {
  if (category.includes('커피') || category.includes('음료')) return '음료';
  if (category.includes('버거')) return '버거';
  if (category.includes('샌드위치')) return '샌드위치';
  if (category.includes('스낵') || category.includes('가공식품')) return '스낵';
  if (category.includes('죽') || category.includes('한식')) return '한식';
  return '공식제품';
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^0-9a-z가-힣]/g, '');
}
