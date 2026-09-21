const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const OFF_USER_AGENT = 'MomgagymNutritionCMS/1.0 - Cloudflare Pages Function';
const OFF_FIELDS = 'product_name,brands,quantity,serving_size,nutriments';

export async function onRequestOptions() {
  return new Response(null, { headers: jsonHeaders });
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const code = String(url.searchParams.get('code') || '').replace(/\D/g, '');
  if (!code || code.length < 8 || code.length > 14) {
    return json({ ok: false, message: '올바른 바코드 번호가 아닙니다.' }, 400);
  }

  let response;
  try {
    response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${OFF_FIELDS}`, {
      headers: { 'user-agent': OFF_USER_AGENT },
      cf: { cacheTtl: 3600, cacheEverything: true },
      signal: AbortSignal.timeout(6000),
    });
  } catch {
    return json({ ok: false, message: '제품 바코드 서버에 연결하지 못했습니다.' }, 502);
  }
  if (!response.ok) return json({ ok: false, message: '제품 바코드 조회에 실패했습니다.' }, 502);

  const payload = await response.json().catch(() => null);
  if (!payload || payload.status !== 1 || !payload.product) {
    return json({ ok: false, code, message: '등록된 바코드 정보를 찾지 못했습니다.' });
  }
  const candidate = toCandidate(code, payload.product);
  if (!candidate) return json({ ok: false, code, message: '제품은 찾았지만 사용할 영양정보가 없습니다.' });
  return json({ ok: true, code, candidate });
}

function toCandidate(code, product) {
  const name = String(product.product_name || '').trim();
  if (!name) return null;
  const n = product.nutriments || {};
  const calories = pickNumber(n['energy-kcal_100g']) ?? kjToKcal(pickNumber(n['energy_100g']));
  const carb = pickNumber(n.carbohydrates_100g);
  const protein = pickNumber(n.proteins_100g);
  const fat = pickNumber(n.fat_100g);
  if (calories == null && carb == null && protein == null && fat == null) return null;
  const gramsToMg = (value) => (value == null ? '' : Math.round(value * 1000));

  return {
    id: `off-${code}`,
    kind: 'open-food-facts',
    name,
    brand: String(product.brands || '').split(',')[0].trim(),
    category: '오픈 데이터(Open Food Facts)',
    grams: '100',
    perServing: false,
    servingAmount: 0,
    servingUnit: 'g',
    serving: product.quantity ? String(product.quantity) : '',
    sourceLabel: 'Open Food Facts (오픈 데이터, 공식 아님)',
    sourceUrl: `https://world.openfoodfacts.org/product/${code}`,
    official: false,
    nutrients: {
      calories: calories ?? '',
      carb: carb ?? '',
      protein: protein ?? '',
      fat: fat ?? '',
      sugar: pickNumber(n.sugars_100g) ?? '',
      saturatedFat: pickNumber(n['saturated-fat_100g']) ?? '',
      sodium: gramsToMg(pickNumber(n.sodium_100g)),
    },
  };
}

function pickNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function kjToKcal(kj) {
  return kj == null ? null : Math.round(kj / 4.184);
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}
