const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export async function onRequestOptions() {
  return new Response(null, { headers: jsonHeaders });
}

export async function onRequestGet({ request, env }) {
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

  const [officialRows, publicRows] = await Promise.all([
    searchOfficialMenus(env.NUTRITION_DB, query, limit),
    searchPublicFoods(env.NUTRITION_DB, query, limit),
  ]);

  const candidates = [...officialRows.map(toOfficialCandidate), ...publicRows.map(toPublicFoodCandidate)].slice(0, limit);
  return json({ ok: true, query, candidates });
}

async function searchOfficialMenus(db, query, limit) {
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
  const like = `%${escapeLike(query)}%`;
  const prefixLike = `${escapeLike(query)}%`;
  const compactLike = `%${escapeLike(compactText(query))}%`;

  try {
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
  } catch {
    return [];
  }
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
  const serving = row.serving_weight || row.serving_basis || '';

  return {
    id: `server-public-${row.food_id}`,
    kind: 'server-public-food-db',
    name: row.food_name,
    brand,
    category: category || '공공 식품영양 DB',
    serving,
    grams: extractServingGrams(serving) || '100',
    sourceLabel: row.source_name || '식품영양성분 공공 DB',
    sourceUrl: '',
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

function extractServingGrams(value) {
  const match = String(value || '').match(/(\d+(?:\.\d+)?)\s*g/i);
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
