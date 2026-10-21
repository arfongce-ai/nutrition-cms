import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const productPath = path.join(rootDir, 'data', 'official-products.json');
const brand = '교촌치킨';
const baseUrl = 'https://www.kyochon.com';

// 교촌치킨 공식 사이트(kyochon.com)의 치킨 전체메뉴 페이지.
// Claude in Chrome으로 실제 구조 확인함(2026-10-20):
//   목록: GET {base}/menu/chicken.asp → 상품마다 <a href="view.asp?id=N&cg=2">자세히보기</a>가
//   있고(확인 시점 77개), 서버에서 바로 렌더링돼서 JS 없이 plain fetch로도 전부 보인다.
//   상세: GET {base}/menu/view.asp?id=N&cg=2 → <title>상품명(상세) | 교촌치킨</title>에서
//   상품명을 뽑고, <table>...<caption>영양정보 - 구분, PCS</caption>에 열량(Kcal)·당류(g)·
//   단백질(g)·포화지방(g)·나트륨(mg) 5개 행이 있다.
//   ⚠️ 중요: 이 표의 기준은 헤더에 <span class="gram">100g</span>로 명시되어 있다 —
//   즉 1피스/1인분이 아니라 "100g당" 수치다(1회 제공량으로 착각하면 안 됨). 탄수화물·지방·
//   트랜스지방·카페인 항목은 표에 없어 null이다.
// robots.txt는 Yeti(네이버봇)만 전체 허용 명시, 그 외 제한 없음(2026-10-20 확인).
const listUrl = `${baseUrl}/menu/chicken.asp`;

const listResponse = await fetch(listUrl, {
  headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'MOMGAGYM nutrition DB importer' },
});
if (!listResponse.ok) {
  throw new Error(`교촌치킨 공식 메뉴 목록을 불러오지 못했습니다. HTTP ${listResponse.status}`);
}
const listHtml = await listResponse.text();
const hrefs = [...listHtml.matchAll(/href="(view\.asp\?[^"]+)"/g)].map((m) => m[1]);
const uniqueHrefs = [...new Set(hrefs)];
const ids = uniqueHrefs
  .map((href) => {
    const idMatch = href.match(/id=(\d+)/);
    const cgMatch = href.match(/cg=(\d+)/);
    return idMatch && cgMatch ? { id: idMatch[1], cg: cgMatch[1] } : null;
  })
  .filter(Boolean);

if (ids.length < 50) {
  throw new Error(`교촌치킨 공식 메뉴 목록에서 상품 링크가 ${ids.length}개만 확인되어 중단했습니다. 사이트 구조가 바뀌었을 수 있습니다.`);
}

const NUTRIENT_LABEL_MAP = [
  [/^열량/, 'calories'],
  [/^당류/, 'sugar'],
  [/^단백질/, 'protein'],
  [/^포화지방/, 'saturatedFat'],
  [/^나트륨/, 'sodium'],
];

const allImported = [];

for (const { id, cg } of ids) {
  const detailUrl = `${baseUrl}/menu/view.asp?id=${id}&cg=${cg}`;
  const response = await fetch(detailUrl, {
    headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'MOMGAGYM nutrition DB importer' },
  });
  if (!response.ok) continue; // 개별 상품 조회 실패는 건너뜀(전체 중단하지 않음)

  const html = await response.text();
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const productName = cleanText((titleMatch ? titleMatch[1] : '').replace(/\(상세\)\s*\|\s*교촌치킨/, ''));
  if (!productName) continue;

  const nutrients = {
    calories: null,
    carb: null,
    sugar: null,
    protein: null,
    fat: null,
    saturatedFat: null,
    transFat: null,
    sodium: null,
    caffeine: null,
  };

  const rowMatches = [...html.matchAll(/<td scope="row">([^<]+)<\/td>\s*<td>([^<]+)<\/td>/g)];
  for (const [, rawLabel, rawValue] of rowMatches) {
    const label = cleanText(rawLabel);
    for (const [pattern, field] of NUTRIENT_LABEL_MAP) {
      if (pattern.test(label)) {
        nutrients[field] = parseNutrientValue(rawValue);
        break;
      }
    }
  }

  if (nutrients.calories == null) continue; // 영양정보 표가 없는 페이지(품절/비노출 등)는 건너뜀

  allImported.push({
    id: `kyochon-${stableId(`${id}`)}`,
    brand,
    productName,
    aliases: [...new Set([`교촌치킨 ${productName}`, `교촌 ${productName}`, productName, productName.replace(/\s+/g, '')])],
    category: `${brand}/치킨`,
    servingSize: '100g 기준',
    servingGram: 100,
    sourceType: 'official_nutrition_page',
    sourceLabel: '교촌치킨 공식 홈페이지 상품 상세 페이지 영양정보',
    sourceUrl: detailUrl,
    verifiedAt: new Date().toISOString().slice(0, 10),
    allergens: [],
    additiveWatch: [
      nutrients.saturatedFat != null && nutrients.saturatedFat >= 10 ? '포화지방' : '',
    ].filter(Boolean),
    nutrients,
    reviewNote:
      '교촌치킨 공식 홈페이지 상품 상세 페이지의 영양정보 표를 그대로 저장했습니다. '
      + '⚠️ 공식 표 기준이 "100g당"이라 1피스/1인분 실제 섭취량과 다릅니다 — 실제 중량(조리 전 중량 등 상품 설명에 표기)을 곱해 환산해야 1인분 수치가 나옵니다. '
      + '표에 탄수화물·지방·트랜스지방·카페인 항목이 없어 null입니다.',
  });
}

const totalParsed = allImported.length;
if (totalParsed < 50) {
  throw new Error(`교촌치킨 공식 메뉴가 ${totalParsed}개만 확인되어 병합을 중단했습니다.`);
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
    { ok: true, brand, imported: imported.length, totalProducts: database.products.length, listedLinks: ids.length },
    null,
    2,
  ),
);

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
