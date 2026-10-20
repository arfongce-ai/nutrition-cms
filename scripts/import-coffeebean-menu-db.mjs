import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const productPath = path.join(rootDir, 'data', 'official-products.json');
const brand = '커피빈';

// 커피빈코리아 공식 사이트(www.coffeebeankorea.com)의 메뉴 카테고리 (2026-10-20, Claude in Chrome으로
// 실제 DOM 구조 확인함: ul.menu_list > li > dl.txt(이름) + div.info dl.bg1(dt=값, dd="라벨 단위" 반복)).
// 카드/프로모션/홀케익처럼 구조가 다를 수 있는 카테고리는 제외했습니다. 카테고리가 추가/삭제되면 갱신 필요.
const CATEGORY_PAGES = [
  { id: '32', label: '신음료' },
  { id: '13', label: '에스프레소 음료' },
  { id: '14', label: '브루드 커피' },
  { id: '18', label: '티' },
  { id: '17', label: '티 라떼' },
  { id: '12', label: '아이스 블렌디드(COFFEE)' },
  { id: '11', label: '아이스 블렌디드(NON-COFFEE)' },
  { id: '26', label: '커피빈 주스(병음료)' },
  { id: '24', label: '기타 제조 음료' },
  { id: '4', label: '베이커리' },
  { id: '5', label: '케익' },
  { id: '6', label: '샌드위치&샐러드' },
  { id: '7', label: '기타' },
];

const NUTRIENT_FIELD_MAP = {
  열량: 'calories',
  나트륨: 'sodium',
  탄수화물: 'carb',
  당: 'sugar',
  단백질: 'protein',
  카페인: 'caffeine',
  포화지방: 'saturatedFat',
};

const allImported = [];
const sourceSummaries = [];

for (const { id, label } of CATEGORY_PAGES) {
  const sourceUrl = `https://www.coffeebeankorea.com/menu/list.asp?category=${id}`;
  const response = await fetch(sourceUrl, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'MOMGAGYM nutrition DB importer',
    },
  });

  if (!response.ok) {
    throw new Error(`커피빈 공식 메뉴(${label})를 불러오지 못했습니다. HTTP ${response.status}`);
  }

  const html = new TextDecoder('utf-8').decode(await response.arrayBuffer());
  const parsed = parseCategoryPage(html, { category: label, sourceUrl });
  sourceSummaries.push({ label, sourceUrl, count: parsed.length });
  allImported.push(...parsed);
}

const totalParsed = allImported.length;
if (totalParsed < 40) {
  // 사이트 구조가 바뀌어 파싱이 깨졌을 가능성이 높아 기존 데이터를 지키기 위해 중단합니다.
  throw new Error(
    `커피빈 공식 메뉴가 ${totalParsed}개만 확인되어 병합을 중단했습니다. (카테고리별: ${JSON.stringify(sourceSummaries)})`,
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
    {
      ok: true,
      brand,
      imported: imported.length,
      totalProducts: database.products.length,
      sources: sourceSummaries,
    },
    null,
    2,
  ),
);

function parseCategoryPage(htmlText, { category, sourceUrl }) {
  const products = [];

  // ul.menu_list > li 단위로 상품을 자른다. li 경계를 안전하게 잡기 위해, 상품명 요소인
  // <dl class="txt"> 블록의 시작 위치를 기준으로 삼는다(li 여닫는 태그를 직접 괄호 매칭하지 않음).
  const nameBlockPattern = /<dl[^>]*class="[^"]*\btxt\b[^"]*"[^>]*>([\s\S]*?)<\/dl>/gi;
  const marks = [];
  let nameMatch;
  while ((nameMatch = nameBlockPattern.exec(htmlText))) {
    const block = nameMatch[1];
    const eng = block.match(/<span[^>]*class="[^"]*\beng\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const kor = block.match(/<span[^>]*class="[^"]*\bkor\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const productName = cleanText(kor ? kor[1] : eng ? eng[1] : '');
    if (productName) {
      marks.push({ index: nameMatch.index, productName, engName: cleanText(eng ? eng[1] : '') });
    }
  }

  for (let i = 0; i < marks.length; i += 1) {
    const { index, productName, engName } = marks[i];
    const end = i + 1 < marks.length ? marks[i + 1].index : htmlText.length;
    const chunk = htmlText.slice(index, end);

    // div.info 안의 첫 dl.bg1 하나만 사용(모바일/데스크톱 중복 블록이 있을 수 있음).
    const infoMatch = chunk.match(/<div[^>]*class="[^"]*\binfo\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const bgMatch = infoMatch ? infoMatch[1].match(/<dl[^>]*class="[^"]*\bbg1\b[^"]*"[^>]*>([\s\S]*?)<\/dl>/i) : null;

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

    if (bgMatch) {
      const dtValues = [...bgMatch[1].matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>/gi)].map((m) => cleanText(m[1]));
      const ddLabels = [...bgMatch[1].matchAll(/<dd[^>]*>([\s\S]*?)<\/dd>/gi)].map((m) => cleanText(m[1]));
      for (let j = 0; j < Math.min(dtValues.length, ddLabels.length); j += 1) {
        // dd 텍스트는 "열량 Kcal" 형태 — 뒤의 단위 단어(한글 1글자 이상 공백으로 구분)를 떼고 라벨만 취한다.
        const labelName = ddLabels[j].replace(/\s+(Kcal|mg|g)$/i, '').trim();
        const field = NUTRIENT_FIELD_MAP[labelName];
        if (field) {
          nutrients[field] = parseNutrientValue(dtValues[j]);
        }
      }
    }

    const hasAnyNutrient = Object.values(nutrients).some((value) => value !== null);
    if (!hasAnyNutrient) continue; // 영양정보가 없는 블록(카드/기타 비식품 등)은 저장하지 않음

    products.push({
      id: `coffeebean-${stableId(`${category}|${productName}`)}`,
      brand,
      productName,
      aliases: createAliases(productName, engName),
      category: `${brand}/${category}`,
      servingSize: '1잔(1개)',
      servingGram: null,
      sourceType: 'official_nutrition_page',
      sourceLabel: '커피빈코리아 공식 홈페이지 메뉴 영양정보',
      sourceUrl,
      verifiedAt: new Date().toISOString().slice(0, 10),
      allergens: [],
      additiveWatch: [
        nutrients.caffeine && nutrients.caffeine > 0 ? '카페인' : '',
        nutrients.saturatedFat != null && nutrients.saturatedFat >= 10 ? '포화지방' : '',
      ].filter(Boolean),
      nutrients,
      reviewNote:
        '커피빈코리아 공식 홈페이지 메뉴 목록의 영양정보 표를 그대로 저장했습니다. 표에 없는 항목은 null입니다.',
    });
  }

  return products;
}

function createAliases(productName, engName) {
  const compact = productName.replace(/\s+/g, '');
  return [...new Set([`커피빈 ${productName}`, productName, compact, engName].filter(Boolean))];
}

function parseNutrientValue(value) {
  const text = String(value || '').replace(/,/g, '').trim();
  if (!text || text === '-' || text === '–') return null;
  const number = Number.parseFloat(text);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value) {
  return decodeEntities(String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function decodeEntities(value) {
  return value
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
