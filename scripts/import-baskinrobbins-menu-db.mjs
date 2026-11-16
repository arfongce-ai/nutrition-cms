import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const productPath = path.join(rootDir, 'data', 'official-products.json');
const brand = '배스킨라빈스';
const baseUrl = 'https://www.baskinrobbins.co.kr/menu/';

// 배스킨라빈스 공식 사이트(baskinrobbins.co.kr) 구조. Claude in Chrome으로 실제 페이지 확인함(2026-10-20):
// 두 종류의 목록/상세 URL 쌍이 있다.
//   - 아이스크림/아이스크림케이크/디저트/프리팩: list.php?category=A|B|E|F → view.php?seq=N
//     (상품당 영양 컨테이너 1개, 카페인 없음). 상품명은 목록 페이지 <img alt="한글상품명">를 쓴다
//     (상세 페이지 제목은 "영문명 한글명"이 공백으로 붙어있어 분리가 애매함 — 1997처럼 숫자가
//     양쪽에 다 나오는 경우가 있어 목록 페이지 alt를 신뢰한다).
//   - 음료/커피: list_subcategory.php?category=C|D → view_subcategory.php?seq=N
//     (한 페이지에 "subcategory-view__product" 블록이 1개 이상 들어있다. 블록은 "같은 상품의
//     사이즈 R/L"일 때도 있고(예: 믹솔로지 티 프로스티 R/L), "이름이 전혀 다른 여러 상품"을
//     한 페이지에 묶어둔 경우도 있다(예: seq=82 하나에 "D몬치치(보이)아메리카노"/
//     "D몬치치(걸)아메리카노"/"몬치치(걸)아메리카노"/"몬치치(보이)아메리카노" 4개 블록 —
//     목록 페이지 alt는 이 경우 "몬치치 아메리카노"라는 뭉뚱그린 이름이라 못 믿는다).
//     그래서 C/D는 각 블록 자체의 제목(<h4>H_L)아메리카노</h4> 형태, ")" 앞은 사이트 내부 코드,
//     뒤가 상품명)에서 ")" 뒤쪽을 상품명으로 쓴다.
//     주의(seq=24 "아메리카노"에서 확인): 같은 페이지에 핫/아이스/사이즈가 다른데도 ")" 뒤
//     상품명이 완전히 똑같은 블록이 여러 개 있을 수 있다(예: "H_L)아메리카노", "I_L)아메리카노",
//     "H_LD)아메리카노" 등 — H=핫, I=아이스, L=라지, K=킹, D=디카페인으로 추정되나 공식 사이트에
//     명시된 범례가 없어 100% 확정은 못 함). 이런 경우 ")" 앞 코드를 괄호로 붙여
//     "아메리카노 (H_L)"처럼 구분한다 — 코드의 정확한 의미는 공식 사이트 상품 상세에서 직접
//     확인 필요(reviewNote에 남김). 카페인 항목이 있고, 일부 값이 "38~39" 같은 범위로 표기됨
//     → 상한값 사용.
// 주의: 실제 확인해보니(2026-10-20) 아이스크림케이크(B, 17개)·디저트(E, 28개)·프리팩(F, 24개)은
// 전부 1인분 기준 영양정보 자체가 없다(컨테이너 0개 — 통 케이크/조각 디저트/포장 판매라 "1회
// 제공량" 개념이 없는 듯). 그래도 사이트가 나중에 채워 넣을 수 있으니 목록은 그대로 두고,
// 실제로는 아이스크림(A, 30개)과 음료/커피(C+D, 약 97개)에서만 데이터가 나온다.
const LIST_CATEGORIES = [
  { category: 'A', label: '아이스크림', listPath: 'list.php?category=A', detailPath: 'view.php?seq=', multi: false },
  { category: 'B', label: '아이스크림케이크', listPath: 'list.php?category=B', detailPath: 'view.php?seq=', multi: false },
  { category: 'E', label: '디저트', listPath: 'list.php?category=E', detailPath: 'view.php?seq=', multi: false },
  { category: 'F', label: '프리팩', listPath: 'list.php?category=F', detailPath: 'view.php?seq=', multi: false },
  { category: 'C', label: '음료', listPath: 'list_subcategory.php?category=C', detailPath: 'view_subcategory.php?seq=', multi: true },
  { category: 'D', label: '커피', listPath: 'list_subcategory.php?category=D', detailPath: 'view_subcategory.php?seq=', multi: true },
];

const NUTRIENT_FIELD_MAP = [
  [/^열량/, 'calories'],
  [/^당류/, 'sugar'],
  [/^단백질/, 'protein'],
  [/^포화지방/, 'saturatedFat'],
  [/^나트륨/, 'sodium'],
  [/^카페인/, 'caffeine'],
];

const allImported = [];
const sourceSummaries = [];
let hadRangeValue = false;

for (const cat of LIST_CATEGORIES) {
  const listUrl = baseUrl + cat.listPath;
  const listHtml = await fetchText(listUrl);
  const seqNamePairs = parseListPage(listHtml, cat.detailPath);

  let count = 0;
  for (const { seq, koreanName } of seqNamePairs) {
    const detailUrl = `${baseUrl}${cat.detailPath}${seq}`;
    const detailHtml = await fetchText(detailUrl);
    const entries = cat.multi ? parseMultiSizeDetail(detailHtml, koreanName) : parseSingleDetail(detailHtml, koreanName);

    // 같은 페이지에서 상품명이 겹치면(=사이즈/핫·아이스 변형) 사이트 내부 코드(예: "H_L")를 붙여 구분한다.
    const nameCounts = new Map();
    entries.forEach((e) => nameCounts.set(e.productName, (nameCounts.get(e.productName) ?? 0) + 1));

    for (const entry of entries) {
      const isDisambiguated = nameCounts.get(entry.productName) > 1 && entry.variantCode;
      const productName = isDisambiguated ? `${entry.productName} (${entry.variantCode})` : entry.productName;

      allImported.push({
        id: `baskinrobbins-${stableId(`${cat.label}|${seq}|${productName}`)}`,
        brand,
        productName,
        aliases: [...new Set([`배스킨라빈스 ${entry.productName}`, entry.productName, entry.productName.replace(/\s+/g, '')])],
        category: `${brand}/${cat.label}`,
        servingSize: entry.servingGram != null ? `1회 제공량 (${entry.servingGram}g)` : '1회 제공량',
        servingGram: entry.servingGram,
        sourceType: 'official_nutrition_page',
        sourceLabel: '배스킨라빈스 공식 홈페이지 메뉴 영양정보',
        sourceUrl: detailUrl,
        verifiedAt: new Date().toISOString().slice(0, 10),
        allergens: entry.allergens,
        additiveWatch: [
          entry.nutrients.caffeine != null && entry.nutrients.caffeine > 0 ? '카페인' : '',
          entry.nutrients.saturatedFat != null && entry.nutrients.saturatedFat >= 10 ? '포화지방' : '',
        ].filter(Boolean),
        nutrients: entry.nutrients,
        reviewNote:
          '배스킨라빈스 공식 홈페이지 상품 상세 페이지의 영양정보를 그대로 저장했습니다. 표에 없는 탄수화물·지방·트랜스지방 항목은 null입니다.'
          + (entry.hasRange ? ' 공식 값이 범위(예: "38~39")로 표기된 항목은 상한값을 저장했습니다.' : '')
          + (isDisambiguated ? ` 상품명 뒤 괄호(${entry.variantCode})는 같은 페이지에 이름이 겹치는 핫/아이스·사이즈 변형을 구분하기 위해 사이트 내부 코드를 그대로 붙인 것입니다(정확한 의미는 공식 사이트 상품 상세에서 직접 확인 필요).` : ''),
      });
      count += 1;
      if (entry.hasRange) hadRangeValue = true;
    }
  }
  sourceSummaries.push({ label: cat.label, listed: seqNamePairs.length, count });
}

const totalParsed = allImported.length;
if (totalParsed < 100) {
  // 사이트 구조가 바뀌어 파싱이 깨졌을 가능성이 높아 기존 데이터를 지키기 위해 중단합니다.
  throw new Error(
    `배스킨라빈스 공식 메뉴가 ${totalParsed}개만 확인되어 병합을 중단했습니다. (카테고리별: ${JSON.stringify(sourceSummaries)})`,
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
    { ok: true, brand, imported: imported.length, totalProducts: database.products.length, sources: sourceSummaries, hadRangeValue },
    null,
    2,
  ),
);

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'MOMGAGYM nutrition DB importer' },
  });
  if (!response.ok) {
    throw new Error(`배스킨라빈스 공식 페이지를 불러오지 못했습니다(${url}). HTTP ${response.status}`);
  }
  // 이 사이트는 UTF-8로 서비스됨(도미노피자처럼 EUC-KR이 아님 — Claude in Chrome으로 확인, 2026-10-20).
  return new TextDecoder('utf-8').decode(await response.arrayBuffer());
}

// 목록 페이지(list.php / list_subcategory.php)에서 <a class="menu-list__link" href="…seq=N">
// 안의 <img alt="한글상품명">을 뽑는다. 두 목록 페이지 타입 모두 같은 카드 마크업을 쓴다.
function parseListPage(html, detailPathPrefix) {
  const escapedPrefix = detailPathPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<a href="${escapedPrefix}(\\d+)"[^>]*class="menu-list__link"[\\s\\S]{0,400}?alt="([^"]*)"`, 'g');
  const pairs = [];
  const seen = new Set();
  for (const match of html.matchAll(re)) {
    const seq = match[1];
    if (seen.has(seq)) continue;
    seen.add(seq);
    pairs.push({ seq, koreanName: cleanText(decodeEntities(match[2])) });
  }
  return pairs;
}

// view.php (아이스크림/케이크/디저트/프리팩): 상품당 영양 컨테이너 1개(없으면 빈 배열 반환 — 통 케이크 등).
// 상품명은 목록 페이지 alt(koreanName)를 그대로 쓴다(1:1 대응).
function parseSingleDetail(html, koreanName) {
  const items = extractNutritionItems(html);
  if (items.length === 0) return [];
  return [{ productName: koreanName, ...buildEntry(items) }];
}

// view_subcategory.php (음료/커피): "subcategory-view__product" 블록마다 영양 컨테이너 1개.
// 상품명은 블록 자체의 <h4>I_R)상품명</h4> 제목에서 가져온다 — 목록 페이지 alt는 한 페이지에
// 여러 다른 상품이 묶여있을 때 뭉뚱그린 이름이라 못 믿는다(위 주석 참고). 혹시 제목을 못 찾으면
// (사이트 구조가 더 바뀐 경우) 목록 페이지 이름으로 대체한다.
function parseMultiSizeDetail(html, koreanName) {
  const blocks = html.split('subcategory-view__product').slice(1);
  const entries = [];
  for (const block of blocks) {
    const items = extractNutritionItems(block);
    if (items.length === 0) continue;
    const title = extractBlockTitle(block);
    entries.push({ productName: title?.name ?? koreanName, variantCode: title?.code ?? null, ...buildEntry(items) });
  }
  return entries;
}

// 제목 형식이 두 가지다(둘 다 실제 확인함, 2026-10-20):
//   1) "H_L)아메리카노" — 여는 괄호 없이 ")"만 있고 그 앞이 사이트 내부 코드, 뒤가 실제 상품명.
//   2) "자몽 히비스커스 티(ICED)" — 상품명 뒤에 "(HOT)"/"(ICED)" 같은 괄호 설명이 그대로 붙어있다
//      (과일 허브 티 2종 계열). 이 경우 괄호가 이미 완전한 설명이라 쪼개면 안 된다.
// 구분법: 첫 ")" 앞에 "("가 있으면 2번(통째로 이름), 없으면 1번(")" 앞뒤로 코드/이름 분리).
function extractBlockTitle(block) {
  const match = block.match(/<h4>([^<]*)<\/h4>/);
  if (!match) return null;
  const decoded = decodeEntities(match[1]);
  const closeParenIdx = decoded.indexOf(')');
  if (closeParenIdx === -1) {
    const cleaned = cleanText(decoded);
    return cleaned ? { code: null, name: cleaned } : null;
  }
  const beforeClose = decoded.slice(0, closeParenIdx);
  if (beforeClose.includes('(')) {
    // "자몽 히비스커스 티(ICED)" 형태 — 통째로 상품명(이미 구분 정보 포함).
    const cleaned = cleanText(decoded);
    return cleaned ? { code: null, name: cleaned } : null;
  }
  const code = cleanText(beforeClose);
  const name = cleanText(decoded.slice(closeParenIdx + 1));
  return name ? { code: code || null, name } : null;
}

// 주의: 영양정보 항목 하나를 감싸는 태그가 페이지 종류에 따라 다르다 — view.php(단일 컨테이너,
// 아이스크림 등)는 <div class="menu-view-nutrition__item">, view_subcategory.php(음료/커피)는
// <dl class="menu-view-nutrition__item">를 쓴다(Claude in Chrome으로 실제 두 페이지 모두 raw fetch해
// 직접 확인함, 2026-10-20). 태그 이름과 무관하게 매칭하도록 (?:div|dl)로 둘 다 받는다.
function extractNutritionItems(html) {
  const re = /<(?:div|dl) class="menu-view-nutrition__item">\s*<dt class="menu-view-nutrition__name">([^<]*)<\/dt>\s*<dd class="menu-view-nutrition__text">([^<]*)<\/dd>/g;
  return [...html.matchAll(re)].map((m) => ({ label: cleanText(m[1]), value: cleanText(m[2]) }));
}

function buildEntry(items) {
  const nutrients = { calories: null, carb: null, sugar: null, protein: null, fat: null, saturatedFat: null, transFat: null, sodium: null, caffeine: null };
  let servingGram = null;
  let allergens = [];
  let hasRange = false;

  for (const { label, value } of items) {
    if (/^1회\s*제공량/.test(label)) {
      servingGram = parseNutrientValue(value, () => { hasRange = true; });
      continue;
    }
    if (label.includes('알레르기')) {
      allergens = value === '없음' || !value ? [] : value.split(/[,·\s]+/).filter(Boolean);
      continue;
    }
    const field = NUTRIENT_FIELD_MAP.find(([re]) => re.test(label));
    if (!field) continue;
    nutrients[field[1]] = parseNutrientValue(value, () => { hasRange = true; });
  }

  return { nutrients, servingGram, allergens, hasRange };
}

// "38~39" 같은 범위 표기는 상한값(39)을 쓴다. 단일 값은 그대로 파싱.
function parseNutrientValue(value, onRange) {
  const text = String(value || '').replace(/,/g, '').trim();
  if (!text || text === '-' || text === '–') return null;
  if (text.includes('~')) {
    onRange?.();
    const parts = text.split('~').map((p) => Number.parseFloat(p.trim()));
    const upper = Math.max(...parts.filter((n) => Number.isFinite(n)));
    return Number.isFinite(upper) ? upper : null;
  }
  const number = Number.parseFloat(text);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');
}

function stableId(value) {
  return createHash('sha1').update(value).digest('hex').slice(0, 12);
}
