import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const productPath = path.join(rootDir, 'data', 'official-products.json');
const brand = '교촌치킨';
const baseUrl = 'https://www.kyochon.com';

// 교촌치킨 공식 사이트(kyochon.com)의 치킨 전체메뉴 페이지.
// Claude in Chrome으로 실제 구조 확인함(2026-10-20, 2026-11-13 재확인):
//   목록: GET {base}/menu/chicken.asp → 상품마다 <a href="view.asp?id=N&cg=2">자세히보기</a>가
//   있고, 서버에서 바로 렌더링돼서 JS 없이 plain fetch로도 전부 보인다.
//   상세: GET {base}/menu/view.asp?id=N&cg=2 → <title>상품명(상세) | 교촌치킨</title>에서
//   상품명을 뽑고, <table>...<caption>영양정보 - 구분, PCS</caption>에 열량(Kcal)·당류(g)·
//   단백질(g)·포화지방(g)·나트륨(mg) 5개 행이 있다.
//   ⚠️ 중요: 이 표의 기준은 헤더에 <span class="gram">100g</span>로 명시되어 있다 —
//   즉 1피스/1인분이 아니라 "100g당" 수치다.
//   탄수화물·지방·트랜스지방·카페인 항목은 표에 없어 null이다.
//
// [2026-11-13 추가] 1인분 환산: 같은 상세 페이지의 상품 설명 문구 안에
//   "조리 전 중량 920g" 처럼 그램 단위로 직접 적혀 있는 경우(일반 콤보/순살/윙콤비 등)와
//   "[10호 닭 (951~1,050g)]" 처럼 범위로 적힌 경우(한마리류)가 있어, 이 텍스트를 함께
//   파싱해서 100g당 수치를 실제 1인분(조리 전 중량) 수치로 환산해 저장한다.
//   ⚠️ 윙박스/싱글윙 계열은 중량이 아니라 "[윙+봉 6조각]" 식 조각 수만 적혀 있어
//   공식 사이트에 그램 환산 근거가 전혀 없다 — 이 상품들은 환산하지 않고 100g 기준을
//   그대로 두되, reviewNote에 "환산 불가" 경고를 강하게 표시한다(아래 참고).
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
let convertedCount = 0;
let unconvertibleCount = 0;

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

  const nutrients100g = {
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
        nutrients100g[field] = parseNutrientValue(rawValue);
        break;
      }
    }
  }

  if (nutrients100g.calories == null) continue; // 영양정보 표가 없는 페이지(품절/비노출 등)는 건너뜀

  // --- 1인분(조리 전 중량) 환산 시도 ---
  const weightInfo = extractWeightInfo(html);
  let nutrients = nutrients100g;
  let servingSize = '100g 기준';
  let servingGram = 100;
  let conversionNote = '';

  if (weightInfo.type === 'point') {
    const gram = weightInfo.gram;
    nutrients = scaleNutrients(nutrients100g, gram / 100);
    servingSize = `1인분 (조리 전 중량 ${gram}g 기준)`;
    servingGram = gram;
    conversionNote = `공식 홈페이지 상품 설명에 적힌 "조리 전 중량 ${gram}g"을 기준으로 100g당 수치를 실제 1인분 수치로 환산했습니다.`;
    convertedCount += 1;
  } else if (weightInfo.type === 'range') {
    const { low, high, mid } = weightInfo;
    nutrients = scaleNutrients(nutrients100g, mid / 100);
    servingSize = `1마리 (조리 전 중량 약 ${mid}g — 공식 범위 ${low}~${high}g의 평균값)`;
    servingGram = mid;
    conversionNote = `⚠️ 공식 홈페이지에 "${low}~${high}g" 범위(10호 닭)로만 적혀 있어, 그 평균값(${mid}g)으로 환산한 추정치입니다. 실제 개체 중량에 따라 달라질 수 있습니다.`;
    convertedCount += 1;
  } else {
    conversionNote = '⚠️ 환산 불가: 공식 홈페이지에 이 상품의 1인분/1팩 중량(g)이 전혀 적혀 있지 않고 "조각 수"만 표시되어 있습니다(예: 윙+봉 6조각/16조각/20조각). 그램 환산 근거가 없어 100g당 수치를 그대로 두었습니다 — 이 수치를 1인분 칼로리로 그대로 보면 실제보다 훨씬 적게 나옵니다. 1인분 환산이 필요하면 조각당 평균 중량을 별도로 확인해야 합니다.';
    unconvertibleCount += 1;
  }

  allImported.push({
    id: `kyochon-${stableId(`${id}`)}`,
    brand,
    productName,
    aliases: [...new Set([`교촌치킨 ${productName}`, `교촌 ${productName}`, productName, productName.replace(/\s+/g, '')])],
    category: `${brand}/치킨`,
    servingSize,
    servingGram,
    sourceType: 'official_nutrition_page',
    sourceLabel: '교촌치킨 공식 홈페이지 상품 상세 페이지 영양정보 + 상품 설명의 조리 전 중량',
    sourceUrl: detailUrl,
    verifiedAt: new Date().toISOString().slice(0, 10),
    allergens: [],
    additiveWatch: [
      nutrients.saturatedFat != null && nutrients.saturatedFat >= 10 ? '포화지방' : '',
    ].filter(Boolean),
    nutrients,
    reviewNote:
      '교촌치킨 공식 홈페이지 상품 상세 페이지의 영양정보 표(100g당)를 가져왔습니다. '
      + conversionNote
      + ' 탄수화물·지방·트랜스지방·카페인 항목은 공식 표에 없어 null입니다.',
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
    {
      ok: true,
      brand,
      imported: imported.length,
      totalProducts: database.products.length,
      listedLinks: ids.length,
      converted: convertedCount,
      unconvertible: unconvertibleCount,
      note: '환산된 상품은 nutrients가 "1인분(조리 전 중량)" 기준, 환산 불가 상품은 여전히 "100g 기준"입니다 — 상품별 servingSize 문구로 구분됩니다.',
    },
    null,
    2,
  ),
);

function extractWeightInfo(html) {
  const bracketMatches = [...html.matchAll(/\[([^\]]{0,200})\]/g)].map((m) => m[1]);
  const weightBracket = bracketMatches.find((b) => b.includes('조리') || b.includes('중량')) || '';

  const ddMatches = [...html.matchAll(/<dd[^>]*>([\s\S]{0,500}?)<\/dd>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  const descFull = ddMatches.join(' | ');

  const hay = weightBracket || descFull;
  const rangeMatch = hay.match(/(\d[\d,]*)\s*~\s*(\d[\d,]*)\s*g/);
  const pointMatch = hay.match(/조리\s*전\s*중량\s*[:]?\s*(\d[\d,]*)\s*g/) || hay.match(/중량\s*[:]?\s*(\d[\d,]*)\s*g/);

  if (rangeMatch) {
    const low = Number.parseInt(rangeMatch[1].replace(/,/g, ''), 10);
    const high = Number.parseInt(rangeMatch[2].replace(/,/g, ''), 10);
    if (Number.isFinite(low) && Number.isFinite(high) && high > low) {
      return { type: 'range', low, high, mid: Math.round((low + high) / 2) };
    }
  }
  if (pointMatch) {
    const gram = Number.parseInt(pointMatch[1].replace(/,/g, ''), 10);
    if (Number.isFinite(gram) && gram > 0) {
      return { type: 'point', gram };
    }
  }
  return { type: 'none' };
}

function scaleNutrients(nutrients100g, multiplier) {
  const scaled = {};
  for (const [key, value] of Object.entries(nutrients100g)) {
    scaled[key] = value == null ? null : roundTo(value * multiplier, 1);
  }
  return scaled;
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
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
