import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const productPath = path.join(rootDir, 'data', 'official-products.json');
const brand = '한솥도시락';
const baseUrl = 'https://www.hsd.co.kr';

// 한솥도시락 공식 사이트(hsd.co.kr). Claude in Chrome 네트워크 요청·XHR 가로채기로 실제 구조 확인함(2026-10-20):
//   1) 카테고리별 상품 목록: POST {base}/api/menu/menu_list/{cate1}/{cate2}
//      → {cate1Info, subdata:[{cate2Info, goodsList:[{idx, title, price, ...}]}]}
//      이 API는 Spring Security CSRF 보호가 걸려 있어 일반 페이지(예: /menu/menu_list)를 먼저
//      GET해서 응답 HTML의 <meta name="_csrf" content="..."> 토큰과 그때 내려오는 세션 쿠키를
//      같이 보내야 한다(토큰만 있고 쿠키가 없으면 403). 이 목록 API의 goodsList[].calorie 필드는
//      실제로는 전부 0으로 와서 쓸모가 없다 — 진짜 열량은 상품 상세 페이지에만 있다.
//   2) 상품 상세: GET {base}/menu/menu_view/{idx} — 인증·쿠키 없이 그냥 GET해도 되는 서버 렌더링
//      페이지. <h3 class="he_tit"><span class="dp1">소분류</span><span class="dp2">상품명</span></h3>
//      와 "열량</h4> ... <p><span>966.8</span>Kcal</p>" 형태로 열량이 텍스트로 있다. 한솥도시락은
//      공식 사이트에 열량 외 다른 영양소(나트륨·당류·단백질 등)를 아예 제공하지 않는다(상품 상세에
//      열량 다음 바로 알레르기 정보로 넘어감) — "칼로리만이라도"라는 요청에 정확히 맞는 사례다.
// 좌측 메뉴 19개 소분류(cate1/cate2 쌍)를 순회해 상품 idx를 모으고, 상품마다 상세 페이지를 받는다.
const CATEGORY_PAIRS = [
  { cate1: '1', cate2: '63', label: '신메뉴' },
  { cate1: '59', cate2: '60', label: '스페셜' },
  { cate1: '2', cate2: '24', label: '프리미엄' },
  { cate1: '3', cate2: '9', label: '사각도시락/고기고기' },
  { cate1: '3', cate2: '10', label: '사각도시락/모둠' },
  { cate1: '3', cate2: '66', label: '사각도시락/더블' },
  { cate1: '4', cate2: '12', label: '보울도시락/마요' },
  { cate1: '4', cate2: '14', label: '보울도시락/볶음밥' },
  { cate1: '4', cate2: '15', label: '보울도시락/찌개' },
  { cate1: '4', cate2: '16', label: '보울도시락/덮밥' },
  { cate1: '4', cate2: '17', label: '보울도시락/비빔밥' },
  { cate1: '4', cate2: '64', label: '보울도시락/정식' },
  { cate1: '5', cate2: '18', label: '단품/실속반찬' },
  { cate1: '5', cate2: '22', label: '미니반찬&집반찬' },
  { cate1: '5', cate2: '47', label: '밥' },
  { cate1: '5', cate2: '67', label: '소스' },
  { cate1: '53', cate2: '54', label: '스낵' },
  { cate1: '53', cate2: '55', label: '치킨' },
  { cate1: '53', cate2: '56', label: '디저트' },
];

// --- 1) CSRF 토큰 + 세션 쿠키 확보 ---
const bootstrapResponse = await fetch(`${baseUrl}/menu/menu_list`, {
  headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'MOMGAGYM nutrition DB importer' },
});
if (!bootstrapResponse.ok) {
  throw new Error(`한솥도시락 공식 메뉴 페이지를 불러오지 못했습니다. HTTP ${bootstrapResponse.status}`);
}
const bootstrapHtml = await bootstrapResponse.text();
const csrfMatch = bootstrapHtml.match(/<meta\s+name="_csrf"\s+content="([^"]+)"/);
const csrfToken = csrfMatch ? csrfMatch[1] : null;
if (!csrfToken) {
  throw new Error('한솥도시락 공식 사이트에서 CSRF 토큰(meta[name="_csrf"])을 찾지 못했습니다. 사이트 구조가 바뀌었을 수 있습니다.');
}
const cookieHeader = extractCookieHeader(bootstrapResponse);
if (!cookieHeader) {
  throw new Error('한솥도시락 공식 사이트에서 세션 쿠키(Set-Cookie)를 받지 못했습니다. CSRF 보호 때문에 상품 목록 API 호출이 막힐 수 있습니다.');
}

// --- 2) 카테고리별 상품 idx + 상품명 수집 ---
const productMap = new Map(); // idx -> {title, category}
const sourceSummaries = [];

for (const { cate1, cate2, label } of CATEGORY_PAIRS) {
  const listUrl = `${baseUrl}/api/menu/menu_list/${cate1}/${cate2}`;
  const response = await fetch(listUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json; charset=utf-8',
      'content-type': 'application/json; charset=utf-8',
      'x-csrf-token': csrfToken,
      'x-requested-with': 'XMLHttpRequest',
      cookie: cookieHeader,
      'user-agent': 'MOMGAGYM nutrition DB importer',
    },
  });

  if (!response.ok) {
    throw new Error(`한솥도시락 공식 상품 목록 API(${label})를 불러오지 못했습니다. HTTP ${response.status}`);
  }

  const json = await response.json();
  const goods = (json.subdata || []).flatMap((sub) => sub.goodsList || []);
  let newCount = 0;
  for (const item of goods) {
    if (!productMap.has(item.idx)) {
      productMap.set(item.idx, { title: item.title, category: label });
      newCount += 1;
    }
  }
  sourceSummaries.push({ label, listed: goods.length, newProducts: newCount });
}

// --- 3) 상품 상세에서 실제 열량 수집 ---
const allImported = [];

for (const [idx, { title, category }] of productMap) {
  const detailUrl = `${baseUrl}/menu/menu_view/${idx}`;
  const response = await fetch(detailUrl, {
    headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'MOMGAGYM nutrition DB importer' },
  });
  if (!response.ok) continue; // 개별 상품 조회 실패는 건너뜀(전체 중단하지 않음)

  const html = await response.text();
  const kcalMatch = html.match(/열량<\/h4>\s*<p><span>([\d.,]+)<\/span>\s*Kcal/i);
  const calories = kcalMatch ? parseNutrientValue(kcalMatch[1]) : null;
  if (calories == null) continue; // 열량 미표기 상품(소스·음료 등 일부)은 건너뜀

  const titleMatch = html.match(/class="dp2">([^<]+)<\/span>/);
  const productName = cleanText(titleMatch ? titleMatch[1] : title);
  if (!productName) continue;

  allImported.push({
    id: `hansot-${stableId(`${category}|${idx}`)}`,
    brand,
    productName,
    aliases: [...new Set([`한솥도시락 ${productName}`, `한솥 ${productName}`, productName, productName.replace(/\s+/g, '')])],
    category: `${brand}/${category}`,
    servingSize: '1인분',
    servingGram: null,
    sourceType: 'official_nutrition_page',
    sourceLabel: '한솥도시락 공식 홈페이지 상품 상세 페이지',
    sourceUrl: detailUrl,
    verifiedAt: new Date().toISOString().slice(0, 10),
    allergens: [],
    additiveWatch: [],
    nutrients: {
      calories,
      carb: null,
      sugar: null,
      protein: null,
      fat: null,
      saturatedFat: null,
      transFat: null,
      sodium: null,
      caffeine: null,
    },
    reviewNote:
      '한솥도시락 공식 홈페이지 상품 상세 페이지에 표기된 열량만 저장했습니다. '
      + '공식 사이트가 열량 외 나트륨·당류·단백질 등 다른 영양소 수치를 제공하지 않아 전부 null입니다. '
      + '알레르기 정보는 사이트에 플래그(al1~al18)로만 있고 항목명이 명시되지 않아 수집하지 않았습니다.',
  });
}

const totalParsed = allImported.length;
if (totalParsed < 60) {
  // 사이트 구조가 바뀌어 파싱이 깨졌을 가능성이 높아 기존 데이터를 지키기 위해 중단합니다.
  throw new Error(
    `한솥도시락 공식 메뉴가 ${totalParsed}개만 확인되어 병합을 중단했습니다. (카테고리별: ${JSON.stringify(sourceSummaries)})`,
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
    { ok: true, brand, imported: imported.length, totalProducts: database.products.length, sources: sourceSummaries },
    null,
    2,
  ),
);

function extractCookieHeader(response) {
  // Node(undici) fetch는 Set-Cookie를 getSetCookie()로 배열로 준다(Node 18.14+/20+).
  // 혹시 없는 런타임이면 헤더 1개만이라도 폴백으로 쓴다.
  const raw = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  if (!raw || raw.length === 0) return null;
  return raw.map((cookieStr) => cookieStr.split(';')[0]).join('; ');
}

function parseNutrientValue(value) {
  if (value == null) return null;
  const text = String(value).replace(/,/g, '').trim();
  if (!text || text === '-' || text === '–') return null;
  const number = Number.parseFloat(text);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stableId(value) {
  return createHash('sha1').update(value).digest('hex').slice(0, 12);
}
