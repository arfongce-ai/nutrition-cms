const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

// 같은 검색어는 동일 결과를 반환하므로(공식/공공 DB는 자주 안 바뀜) Cloudflare 엣지에 캐시.
// 캐시 히트 시 D1을 아예 타지 않음 — 무료 D1 일일 읽기 한도를 아끼는 1차 방어선.
const EDGE_CACHE_SECONDS = 60 * 60 * 24; // 24시간

export async function onRequestOptions() {
  return new Response(null, { headers: jsonHeaders });
}

export async function onRequestGet({ request, env, ctx }) {
  const url = new URL(request.url);
  const query = String(url.searchParams.get('q') || '').trim();
  const limit = clamp(Number(url.searchParams.get('limit') || 8), 1, 20);

  if (!query) {
    return json({ ok: false, message: '검색어가 필요합니다.', candidates: [] }, 400);
  }

  if (query.length > 120) {
    return json({ ok: false, message: '검색어는 120자 이내로 입력해주세요.', candidates: [] }, 400);
  }

  if (!env.NUTRITION_DB) {
    return json(
      {
        ok: false,
        message: '서버 영양 DB가 아직 연결되지 않았습니다.',
        candidates: [],
      },
      503,
    );
  }

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const [officialRows, publicRows] = await Promise.all([
    searchOfficialMenus(env.NUTRITION_DB, query, limit),
    searchPublicFoods(env.NUTRITION_DB, query, limit),
  ]);

  const normalizedQuery = compactText(query).toLowerCase();
  const exactPublicRows = publicRows.filter((row) => compactText(row.food_name).toLowerCase() === normalizedQuery);
  const remainingPublicRows = publicRows
    .filter((row) => !exactPublicRows.includes(row))
    .sort((left, right) => rankPublicFoodName(left.food_name, normalizedQuery) - rankPublicFoodName(right.food_name, normalizedQuery));
  const candidates = [
    ...exactPublicRows.map(toPublicFoodCandidate),
    ...officialRows.map(toOfficialCandidate),
    ...remainingPublicRows.map(toPublicFoodCandidate),
  ].slice(0, limit);

  const response = json({ ok: true, query, candidates });
  response.headers.set('cache-control', `public, max-age=${EDGE_CACHE_SECONDS}`);
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function searchOfficialMenus(db, query, limit) {
  // brands/brand_menus는 공식 등록 브랜드 메뉴만 담는 소규모 테이블이라 풀스캔 비용이 낮음 — 그대로 유지.
  const like = `%${escapeLike(query)}%`;
  const compactLike = `%${escapeLike(compactText(query))}%`;

  try {
    const result = await db
      .prepare(
        `
          SELECT
            brand_menus.menu_id,
            brand_menus.menu_name,
            brand_menus.aliases_json,
            brand_menus.item_code_val,
            brand_menus.serving_label,
            brand_menus.serving_size_g,
            brand_menus.calories_kcal,
            brand_menus.carbohydrates_g,
            brand_menus.protein_g,
            brand_menus.fat_g,
            brand_menus.saturated_fat_g,
            brand_menus.trans_fat_g,
            brand_menus.sugar_g,
            brand_menus.sodium_mg,
            brand_menus.caffeine_mg,
            brand_menus.source_label,
            brand_menus.detail_deeplink_url,
            brand_menus.image_url,
            brands.brand_name,
            brands.category
          FROM brand_menus
          JOIN brands ON brands.brand_id = brand_menus.brand_id
          WHERE
            brands.brand_name LIKE ? ESCAPE '\\'
            OR brand_menus.menu_name LIKE ? ESCAPE '\\'
            OR REPLACE(brand_menus.menu_name, ' ', '') LIKE ? ESCAPE '\\'
            OR brand_menus.aliases_json LIKE ? ESCAPE '\\'
          ORDER BY
            CASE
              WHEN brands.brand_name || ' ' || brand_menus.menu_name = ? THEN 0
              WHEN brand_menus.menu_name = ? THEN 1
              WHEN brand_menus.menu_name LIKE ? ESCAPE '\\' THEN 2
              WHEN brands.brand_name LIKE ? ESCAPE '\\' THEN 3
              ELSE 4
            END,
            brand_menus.menu_name
          LIMIT ?
        `,
      )
      .bind(like, like, compactLike, like, query, query, like, like, limit)
      .all();
    return result.results || [];
  } catch {
    return [];
  }
}

async function searchPublicFoods(db, query, limit) {
  // public_foods는 공공 식품영양성분 DB(수만~수십만 행)라 LIKE '%q%' 풀스캔이 D1 읽기 한도를
  // 하루 만에 소진시킨 주범. public_foods_fts(trigram) 인덱스가 있으면 그걸 우선 사용하고,
  // 마이그레이션 전이거나(0002_public_foods_fts.sql 미적용) FTS 조회가 실패하면
  // 기존 LIKE 방식으로 안전하게 폴백한다(동작은 그대로 유지, 비용만 못 줄이는 정도).
  try {
    return await searchPublicFoodsFts(db, query, limit);
  } catch {
    return await searchPublicFoodsLike(db, query, limit);
  }
}

async function searchPublicFoodsFts(db, query, limit) {
  const like = `%${escapeLike(query)}%`;
  const compactLike = `%${escapeLike(compactText(query))}%`;

  const result = await db
    .prepare(
      `
        WITH matched AS (
          SELECT rowid FROM public_foods_fts WHERE food_name LIKE ?1 ESCAPE '\\'
          UNION
          SELECT rowid FROM public_foods_fts WHERE search_name LIKE ?1 ESCAPE '\\'
        )
        SELECT
          public_foods.food_id,
          public_foods.food_code,
          public_foods.db_type,
          public_foods.food_name,
          public_foods.category_large,
          public_foods.category_middle,
          public_foods.category_small,
          public_foods.serving_basis,
          public_foods.serving_weight,
          public_foods.calories_kcal,
          public_foods.carbohydrates_g,
          public_foods.protein_g,
          public_foods.fat_g,
          public_foods.saturated_fat_g,
          public_foods.trans_fat_g,
          public_foods.sugar_g,
          public_foods.sodium_mg,
          public_foods.fiber_g,
          public_foods.leucine_mg,
          public_foods.caffeine_mg,
          public_foods.manufacturer_name,
          public_foods.importer_name,
          public_foods.distributor_name,
          public_foods.report_no,
          public_foods.source_name,
          public_foods.source_file,
          public_foods.standard_date
        FROM matched
        JOIN public_foods ON public_foods.food_id = matched.rowid
        ORDER BY
          CASE
            WHEN public_foods.food_name = ?2 THEN 0
            WHEN public_foods.food_name LIKE ?3 ESCAPE '\\' THEN 1
            WHEN public_foods.search_name LIKE ?1 ESCAPE '\\' THEN 2
            ELSE 3
          END,
          public_foods.standard_date DESC,
          public_foods.food_name
        LIMIT ?4
      `,
    )
    .bind(like, query, `${escapeLike(query)}%`, limit)
    .all();

  // food_code / manufacturer_name / distributor_name / report_no로 찾는 케이스는
  // 바코드 조회 등 별도 API(barcode-lookup.js)가 이미 담당 — 여기서는 이름 검색만 담당해 스캔 범위를 좁힘.
  void compactLike;
  return result.results || [];
}

async function searchPublicFoodsLike(db, query, limit) {
  const like = `%${escapeLike(query)}%`;
  const prefixLike = `${escapeLike(query)}%`;
  const compactLike = `%${escapeLike(compactText(query))}%`;

  const result = await db
    .prepare(
      `
        SELECT
          food_id,
          food_code,
          db_type,
          food_name,
          category_large,
          category_middle,
          category_small,
          serving_basis,
          serving_weight,
          calories_kcal,
          carbohydrates_g,
          protein_g,
          fat_g,
          saturated_fat_g,
          trans_fat_g,
          sugar_g,
          sodium_mg,
          fiber_g,
          leucine_mg,
          caffeine_mg,
          manufacturer_name,
          importer_name,
          distributor_name,
          report_no,
          source_name,
          source_file,
          standard_date
        FROM public_foods
        WHERE
          food_name LIKE ? ESCAPE '\\'
          OR search_name LIKE ? ESCAPE '\\'
          OR food_code LIKE ? ESCAPE '\\'
          OR manufacturer_name LIKE ? ESCAPE '\\'
          OR distributor_name LIKE ? ESCAPE '\\'
          OR report_no LIKE ? ESCAPE '\\'
        ORDER BY
          CASE
            WHEN food_name = ? THEN 0
            WHEN food_name LIKE ? ESCAPE '\\' THEN 1
            WHEN search_name LIKE ? ESCAPE '\\' THEN 2
            ELSE 3
          END,
          standard_date DESC,
          food_name
        LIMIT ?
      `,
    )
    .bind(like, compactLike, like, like, like, like, query, prefixLike, compactLike, limit)
    .all();
  return result.results || [];
}

function toOfficialCandidate(row) {
  const name = row.brand_name && !String(row.menu_name).includes(row.brand_name) ? `${row.brand_name} ${row.menu_name}` : row.menu_name;
  const serving = row.serving_label || (row.serving_size_g ? `${row.serving_size_g}g` : '1회 제공량');
  const servingDetails = parseServingDetails(serving, row.serving_size_g);

  return {
    id: `server-menu-${row.menu_id}`,
    kind: 'server-official-db',
    name,
    brand: row.brand_name || '',
    category: row.category || '공식 메뉴 DB',
    serving,
    grams: '1',
    sourceLabel: row.source_label || '공식 영양정보',
    sourceUrl: row.detail_deeplink_url || '',
    official: true,
    imageUrl: row.image_url || '',
    itemCode: row.item_code_val || '',
    nutrients: createNutrients(row),
    perServing: true,
    servingAmount: servingDetails.amount,
    servingUnit: servingDetails.unit,
  };
}

function toPublicFoodCandidate(row) {
  const brand = row.manufacturer_name || row.distributor_name || row.importer_name || '';
  const category = [row.db_type, row.category_large, row.category_middle, row.category_small].filter(Boolean).join(' · ');
  const servingBasis = row.serving_basis || '';
  const packageWeight = row.serving_weight || '';
  const serving = servingBasis && packageWeight && servingBasis !== packageWeight
    ? `${servingBasis} 기준 · 제품 ${packageWeight}`
    : servingBasis || packageWeight;

  return {
    id: `server-public-${row.food_id}`,
    kind: 'server-public-food-db',
    name: row.food_name,
    brand,
    category: category || '공공 식품영양 DB',
    serving,
    grams: extractServingAmount(servingBasis) || extractServingAmount(packageWeight) || '100',
    sourceLabel: row.source_name || '식품영양성분 공공 DB',
    sourceUrl: '',
    official: true,
    imageUrl: '',
    itemCode: row.food_code || row.report_no || '',
    nutrients: createNutrients(row),
    meta: {
      sourceFile: row.source_file || '',
      standardDate: row.standard_date || '',
      reportNo: row.report_no || '',
    },
  };
}

function createNutrients(row) {
  return {
    calories: numberOrZero(row.calories_kcal),
    carb: numberOrZero(row.carbohydrates_g),
    sugar: numberOrZero(row.sugar_g),
    protein: numberOrZero(row.protein_g),
    fat: numberOrZero(row.fat_g),
    saturatedFat: numberOrZero(row.saturated_fat_g),
    transFat: numberOrZero(row.trans_fat_g),
    sodium: numberOrZero(row.sodium_mg),
    fiber: numberOrZero(row.fiber_g),
    leucine: numberOrZero(row.leucine_mg),
    caffeine: numberOrZero(row.caffeine_mg),
  };
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: jsonHeaders,
  });
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, '');
}

function rankPublicFoodName(foodName, normalizedQuery) {
  const normalizedName = compactText(foodName).toLowerCase();
  if (normalizedName === normalizedQuery) return 0;
  if (normalizedName.endsWith(normalizedQuery)) return 1;
  if (normalizedName.startsWith(normalizedQuery)) return 2;
  if (normalizedName.includes(normalizedQuery)) return 3;
  return 4;
}

function escapeLike(value) {
  return String(value || '').replace(/[\\%_]/g, (match) => `\\${match}`);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function extractServingAmount(value) {
  const match = String(value || '').match(/(\d+(?:\.\d+)?)\s*(?:g|ml)/i);
  return match?.[1] || '';
}

function parseServingDetails(label, fallbackGrams = 0) {
  const matches = [...String(label || '').matchAll(/(\d+(?:\.\d+)?)\s*(kg|g|ml|mL|l|L|개|잔|봉|팩|병|캔|컵|그릇|조각|인분|회)/gi)];
  const match = matches[matches.length - 1];
  if (match) {
    const rawUnit = String(match[2]);
    const lowerUnit = rawUnit.toLowerCase();
    const unit = lowerUnit === 'ml' ? 'mL' : lowerUnit === 'l' ? 'L' : lowerUnit === 'kg' ? 'kg' : lowerUnit === 'g' ? 'g' : rawUnit;
    return { amount: Number(match[1]) || 1, unit };
  }
  if (Number(fallbackGrams) > 0) return { amount: Number(fallbackGrams), unit: 'g' };
  return { amount: 1, unit: '회' };
}
