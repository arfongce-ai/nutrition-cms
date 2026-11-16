import officialProductData from '../../data/official-products.json';
import officialSourceData from '../../data/official-product-sources.json';

const PRODUCT_RECORDS = Array.isArray(officialProductData.products) ? officialProductData.products : [];
const SOURCE_RECORDS = Array.isArray(officialSourceData.sources) ? officialSourceData.sources : [];

export function findOfficialProductFood(text) {
  const normalized = normalizeSearchText(text);
  if (!normalized) return null;

  const product = PRODUCT_RECORDS.find((entry) => {
    const brand = normalizeSearchText(entry.brand);
    const hasBrand = brand && normalized.includes(brand);
    const productName = normalizeSearchText(entry.productName);
    if (hasBrand && productName && (normalized === productName || normalized === brand + productName)) return true;

    return (entry.aliases || []).some((term) => {
      const alias = normalizeSearchText(term);
      if (!alias || (normalized !== alias && normalized !== brand + alias)) return false;
      const aliasHasBrand = brand && alias.includes(brand);
      return hasBrand || aliasHasBrand || !isGenericBeverageName(alias);
    });
  });

  if (!product) return null;
  return toFoodEntry(product);
}

// 2026-11-14 추가: 브랜드 자체가 미확인이라 위 findOfficialProductFood가 아예 못 찾는 경우
// (예: 노브랜드버거·역전할머니맥주·허닭 등)를 위한 마지막 안전망. 상품명이 정확히 같아야 하는
// 위 매칭과 달리, 음식명에 "치킨" 같은 카테고리 키워드가 "포함"만 되어도 매칭한다 — 그래서
// matchType: 'category'로 표시된 항목(scripts/apply-similar-substitute.mjs의
// buildCategorySubstitutes가 만든 평균값)만 대상으로 하고, 실제 브랜드 데이터는 절대 이 경로로
// 안 돌아가게 막는다.
export function findCategorySubstituteFood(text) {
  const normalized = normalizeSearchText(text);
  if (!normalized) return null;

  const product = PRODUCT_RECORDS.find((entry) => {
    if (entry.matchType !== 'category') return false;
    return (entry.categoryKeywords || []).some((keyword) => {
      const normalizedKeyword = normalizeSearchText(keyword);
      return normalizedKeyword && normalized.includes(normalizedKeyword);
    });
  });

  if (!product) return null;
  return toFoodEntry(product);
}

export function searchOfficialProductFoods(text, limit = 6) {
  const normalized = normalizeSearchText(text);
  if (!normalized) return [];

  return PRODUCT_RECORDS.map((product) => ({
    product,
    score: scoreProductMatch(product, normalized),
  }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => toFoodEntry(item.product));
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
  // 2026-11-13: apply-similar-substitute.mjs가 만드는 "일반(추정)" 항목(sourceType
  // 'estimated_similar_average' — 여러 브랜드 평균값, 특정 브랜드의 실측값이 아님)은
  // 공식 확정값과 절대 같은 것으로 보이면 안 됨(센터 설계원칙: 추정값을 확정 판정처럼
  // 보이게 하지 않는다). 이전에는 여기서 무조건 official:true를 리턴해서 유사 대체
  // 추정값이 공식 데이터와 구분 없이 회원에게 노출됐고, reviewNote(그 안의 "[추정값]"
  // 문구)도 아예 전달이 안 됐음(교촌 윙 조각수 추정 등 브랜드 내부 추정에도 동일하게
  // 영향) — 둘 다 고침.
  const isSimilarSubstitute = product.sourceType === 'estimated_similar_average';
  const isEstimated = isSimilarSubstitute || /\[추정값\]/.test(String(product.reviewNote || ''));
  return {
    brand: product.brand,
    keys: [product.productName, ...(product.aliases || [])],
    serving: product.servingSize || '',
    sourceLabel: product.sourceLabel || `${product.brand} 공식 제품 영양정보`,
    sourceUrl: product.sourceUrl || '',
    imageUrl: product.imageUrl || '',
    category: product.category || '',
    emoji: createEmoji(product.category),
    official: !isSimilarSubstitute,
    officialProduct: !isSimilarSubstitute,
    estimated: isEstimated,
    reviewNote: product.reviewNote || '',
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
    caffeine: numberValue(nutrients.caffeine),
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

function scoreProductMatch(product, normalized) {
  const brand = normalizeSearchText(product.brand);
  const productName = normalizeSearchText(product.productName);
  const aliases = (product.aliases || []).map(normalizeSearchText).filter(Boolean);
  const terms = [brand, productName, ...aliases].filter(Boolean);
  let score = 0;

  if (brand && normalized.includes(brand)) score += 8;
  if (productName && normalized.includes(productName)) score += 14;
  if (productName && productName.includes(normalized)) score += 10;

  aliases.forEach((alias) => {
    if (normalized.includes(alias)) score += alias.length >= 4 ? 8 : 4;
    if (alias.includes(normalized)) score += normalized.length >= 3 ? 6 : 2;
  });

  if (!score && normalized.length >= 2) {
    score = terms.some((term) => term.includes(normalized) || normalized.includes(term)) ? 2 : 0;
  }

  return score;
}

function isGenericBeverageName(value) {
  return [
    '아메리카노',
    '카페아메리카노',
    '카페라떼',
    '라떼',
    '밀크티',
    '블랙밀크티',
  ].includes(value);
}
