import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const productPath = path.join(rootDir, 'data', 'official-products.json');
const brand = '옵티멈뉴트리션';
const sourceLabel = '옵티멈뉴트리션 코리아 공식몰(optimumnutrition.com/ko-kr) 상품 상세페이지 "영양 정보" 탭(이미지) — Claude가 화면 캡처로 옮겨 적음, 원본 대조 필요';
// new Date().toISOString()는 UTC 기준이라 한국 시간대와 날짜가 하루 밀릴 수 있어
// 실제 작업한 날짜를 직접 고정함(자담치킨 스크립트와 동일한 이유).
const verifiedAt = '2026-11-14';

// 옵티멈뉴트리션 한국 공식몰 — 보충제(단백질·아미노산·크레아틴 등) 브랜드.
// 전체상품 25개 중 10개는 기존 단일 상품들을 묶은 "어드밴티지/더블/트리플 팩"(번들)이라
// 별도 영양정보가 아니라 이미 아래 15개 안에 포함된 값의 조합임 — 등록 제외함.
// 실제 서로 다른 제품(포뮬러)은 15개뿐:
//   골드스탠다드 100% 웨이, 골드스탠다드 100% 아이솔레이트 웨이, 수페리어 아미노 2222,
//   BCAA 5000, 크레아틴 플러스, 글루타민 파우더, 골드스탠다드 100% 플랜트 프로틴,
//   골드스탠다드 프로 게이너, 마그네슘 글리시네이트, 마이크로나이즈드 크레아틴 캡슐,
//   마이크로나이즈드 크레아틴 파우더, 플래티넘 하이드로웨이, 시리어스 매스,
//   트리뷸러스 캡슐, 아미노 에너지+전해질
//
// ⚠️ 중요 — 자담치킨류 "100g=1인분 착각" 버그와는 다른 종류의 주의가 필요함:
// 이 제품들은 음식이 아니라 보충제라 "100g 기준"이라는 개념 자체가 거의 안 맞음(파우더
// 보충제 1회 제공량은 보통 5~41g, 캡슐형은 아예 중량 표시가 없음). 그래서 아래 값은 전부
// "라벨에 적힌 1회 제공량(scoop/teaspoon/capsule) 그대로"이며, servingGram은 실제로
// 중량이 표시된 제품만 숫자로 넣고 캡슐형(중량 표시 없음)은 null로 둠 — 절대로 100g
// 환산값이 아님. 등록 시 "1인분 기준"이 아니라 "1회 제공량 기준"으로 그대로 써야 함.
//
// ⚠️ 맛(flavor) 변동: 각 제품은 보통 여러 맛이 있고, 이 값은 사이트에서 기본으로 보여준
// 맛(주로 대표 맛) 1개만 확인한 기준값임. 마이프로틴 조사 때와 같은 전제 — 맛에 따라
// 수치가 정확히 같은지는 확인 못 함(보통 거의 비슷하지만 확정 아님).
//
// [제품명, 맛(확인한 기준), 1회 제공량 설명, 1회 제공량 중량(g, 모르면 null), 용기당 회분,
//  calories, carb, sugar, fiber, protein, fat, saturatedFat, transFat, sodium, caffeine,
//  추가정보(미네랄/비타민/아미노산 블렌드 등 reviewNote용), URL 슬러그]
const SUPPLEMENT_ROWS = [
  ['골드스탠다드 100% 웨이', '바나나 크림', '1스쿱 약 31g', 31, 29,
    120, 4, 2, null, 24, 1.5, 1, null, 130, null,
    '콜레스테롤 55mg, 칼슘 140mg, 칼륨 150mg, 첨가당 0g, BCAA 5.5g. 맛마다(초콜릿·바닐라 등) 수치가 조금씩 다를 수 있음 — 이 값은 "바나나 크림" 맛 기준.',
    'gold-standard-100-whey-protein-powder'],
  ['골드스탠다드 100% 아이솔레이트 웨이', '초콜릿 블리스', '1스쿱 약 31g', 31, 44,
    110, 1, null, null, 25, 0.5, null, null, 190, null,
    '콜레스테롤 5mg 미만, 칼슘 150mg, 철분 0.5mg, 칼륨 240mg. 포화지방·당류는 라벨에 별도 표기 없음(거의 0 수준으로 추정, 확정 아님).',
    'gold-standard-100-isolate-whey-protein-powder'],
  ['수페리어 아미노 2222', '무향', '2정(태블릿)', null, 80,
    20, 3, 2, null, 2, null, null, null, 40, null,
    '아미노 2222 블렌드 5.3g(웨이파우더, 웨이프로틴농축물, 대두단백분리물, 류신·아이소류신·발린·글루타민·아르기닌 등 마이크로나이즈드 아미노산 혼합, 가수분해 웨이프로틴, 소화효소 복합체). 1회 제공량은 중량(g) 표시가 없고 "2정" 기준.',
    'amino-superior-2222-tablets'],
  ['BCAA 5000 무향', '무향', '1수북한 티스푼 약 5.75g', 5.75, 60,
    null, null, null, null, null, null, null, null, null, null,
    '순수 아미노산 제품이라 칼로리·탄수화물·단백질 표기 자체가 라벨에 없음(사실상 0kcal로 추정, 확정 아님). 마이크로나이즈드 L-류신 2.5g, L-아이소류신 1.25g, L-발린 1.25g(2:1:1 비율) = 1회 제공량당 BCAA 5g.',
    'bcaa-amino-acids-5000-pills'],
  ['크레아틴 플러스', '오렌지 패션프룻', '2티스푼 약 9g', 9, 40,
    5, 1, null, null, null, null, null, null, 90, null,
    '크레아틴 모노하이드레이트 5g, 전해질 블렌드(나트륨염화물·마그네슘옥사이드·칼륨염화물) 370mg, 비타민C 45mg, 비타민D 10mcg, 비타민B1 1.2mg, 나이아신 16mg, 비타민B6 2mg, 엽산 425mcg DFE, 비타민B12 2.4mcg, 판토텐산 5mg, 마그네슘 40mg, 칼륨 40mg.',
    'creatine-plus-micronized-creatine-monohydrate-powder'],
  ['글루타민 파우더', '무향', '1수북한 티스푼 약 5.15g', 5.15, 58,
    null, null, null, null, null, null, null, null, null, null,
    'L-글루타민 5g 단일 성분, 다른 성분 없음(OTHER INGREDIENTS: None). 칼로리 등 영양정보 표기 자체가 라벨에 없음.',
    'glutamine-amino-acid-powder'],
  ['골드스탠다드 100% 플랜트 프로틴', '크리미 바닐라', '1스쿱 약 37g', 37, 20,
    150, 5, 0, null, 24, 3.5, 1.5, null, 480, null,
    '칼슘 50mg, 철분 7.2mg. 식물성 단백질 블렌드(완두단백, 잠두단백분리물, 현미단백농축물). 설탕 0g, 인공 색소·향료·감미료 무첨가(스테비아 사용).',
    'gold-standard-100-plant-based-protein-powder'],
  ['골드스탠다드 프로 게이너', '더블 초콜릿', '1스쿱 약 165g', 165, 14,
    650, 81, 7, 5, 60, 8, 4, 0, 340, null,
    '콜레스테롤 80mg, 첨가당 4g. 칼슘 600mg, 철분 7.5mg, 칼륨 940mg 등 비타민·미네랄 다량 함유(종합비타민 수준). 고칼로리 벌크업용 제품 — 일반 유청단백질과 수치 차이가 매우 큼, 등록 시 반드시 구분해서 안내.',
    'gold-standard-pro-gainer-protein-powder'],
  ['마그네슘 글리시네이트 200mg 캡슐', '없음(단일 제품)', '2캡슐', null, 45,
    null, null, null, null, null, null, null, null, null, null,
    '마그네슘(마그네슘글리시네이트 유래) 200mg(1일 영양성분 기준치 48%). 칼로리 등 일반 영양정보 표기 없음(미네랄 단일 보충제).',
    'magnesium-glycinate-capsules'],
  ['마이크로나이즈드 크레아틴 캡슐', '무향', '2캡슐', null, 50,
    0, 0, null, null, null, null, null, null, null, null,
    '크레아틴 모노하이드레이트 2.5g(2캡슐 기준). 제품 설명에 "칼로리 zero & 탄수화물 zero" 명시.',
    'creatine-monohydrate-micronized-capsules'],
  ['마이크로나이즈드 크레아틴 파우더', '무향', '1수북한 티스푼 약 5g', 5, 60,
    null, null, null, null, null, null, null, null, null, null,
    '크레아틴 모노하이드레이트 5g 단일 성분, 다른 성분 없음. 칼로리 등 영양정보 표기 자체가 라벨에 없음(순수 크레아틴이라 사실상 0kcal로 추정, 확정 아님).',
    'creatine-monohydrate-micronized-powder'],
  ['플래티넘 하이드로웨이', '터보 초콜릿', '1스쿱 약 41g', 41, 20,
    140, 3, 1, null, 30, 1, 0.5, null, 150, null,
    '콜레스테롤 35mg, 식이섬유 1g 미만(정확한 수치는 라벨에 "<1g"로만 표기되어 구조화 필드에는 넣지 않음), 칼슘 160mg, 철분 0.8mg, 칼륨 270mg. 가수분해 분리유청단백질(HWPI) 100%, 필수아미노산 15.5g, BCAA 8.8g.',
    'platinum-hydrowhey-hydrolyzed-whey-protein-powder'],
  ['시리어스 매스', '초콜릿 피넛버터', '2수북한 스쿱 약 340g', 340, 8,
    1250, 250, 31, 4, 50, 6, 3.5, null, 620, null,
    '콜레스테롤 200mg, 첨가당 10g, 칼륨 1290mg. 크레아틴 모노하이드레이트 5g 포함. 초고칼로리 체중 증량용 제품(벌크업) — 일반 단백질 보충제와 혼동 주의, 1회 제공량이 340g(2스쿱)으로 매우 큼.',
    'serious-mass-weight-gainer-protein-powder'],
  ['트리뷸러스 캡슐 625', '무향', '2캡슐', null, 50,
    null, null, null, null, null, null, null, null, null, null,
    '트리뷸러스 블렌드(트리뷸러스 테레스트리스 추출물 + 분말) 625mg. 허브 추출물 보충제라 일반 영양정보 표기 없음.',
    'tribulus-terrestris-extract-caps'],
  ['아미노 에너지+전해질', '포도맛', '2스쿱 약 9g', 9, 30,
    12, 3, 0.1, null, 0, 0, 0, null, 105, 100,
    '100g당 환산값도 라벨에 함께 표기됨: 132kcal, 탄수화물 33g, 당류 1g, 나트륨 1167mg(100g 기준 — 참고용, 등록값은 1회 제공량 9g 기준). 아미노 블렌드 5g(글루타민·류신·아이소류신·발린·티로신·라이신HCl·히스티딘·트레오닌), 전해질 블렌드 345mg, 에너지 블렌드 225mg(그린커피빈추출물 125mg+그린티잎추출물 100mg — 천연 카페인 공급원, 제품 특징에 "천연 유래 카페인 100mg 함유"로 명시). 설탕 무첨가(No Added Sugar).',
    'aspac-amino-energy-electro-grape'],
];

function buildSupplement([
  productName, flavor, servingDesc, servingGram, servingsPerContainer,
  calories, carb, sugar, fiber, protein, fat, saturatedFat, transFat, sodium, caffeine,
  extraDetail, urlSlug,
]) {
  const sourceUrl = `https://www.optimumnutrition.com/ko-kr/products/${urlSlug}`;
  const servingSize = servingGram
    ? `${servingDesc} 기준, 용기당 ${servingsPerContainer}회분 — 1인분/100g 기준 아님, 라벨에 적힌 1회 제공량`
    : `${servingDesc} 기준(중량 표시 없음), 용기당 ${servingsPerContainer}회분 — 1인분/100g 기준 아님, 라벨에 적힌 1회 제공량`;

  const singleFlavor = flavor === '무향' || flavor.startsWith('없음');
  const reviewNoteParts = [
    `옵티멈뉴트리션 코리아 공식몰 상품 상세페이지 "영양 정보" 탭의 이미지(Supplement Facts / Nutrition Facts 라벨)를 Claude가 화면 캡처로 옮겨 적었습니다(AI가 이미지에서 읽음 — 원본 대조 필요).`,
    singleFlavor
      ? `맛 구분 없는(또는 무향) 단일 제품.`
      : `확인한 맛: ${flavor}. 다른 맛은 수치가 조금 다를 수 있어 확인 못 함.`,
    extraDetail,
  ];

  return {
    id: `optimumnutrition-${stableId(urlSlug)}`,
    brand,
    productName,
    aliases: [...new Set([
      `옵티멈뉴트리션 ${productName}`,
      `옵티멈 ${productName}`,
      `ON ${productName}`,
      productName,
      productName.replace(/\s+/g, ''),
    ])],
    category: `${brand}/보충제`,
    servingSize,
    servingGram: servingGram || null,
    sourceType: 'ai_image_transcription',
    sourceLabel,
    sourceUrl,
    verifiedAt,
    allergens: [],
    additiveWatch: [],
    nutrients: {
      calories,
      carb,
      sugar,
      fiber,
      protein,
      fat,
      saturatedFat,
      transFat,
      sodium,
      caffeine,
    },
    reviewNote: reviewNoteParts.join(' '),
  };
}

const allImported = SUPPLEMENT_ROWS.map(buildSupplement);

const database = JSON.parse(await fs.readFile(productPath, 'utf8'));
const currentProducts = Array.isArray(database.products) ? database.products : [];
const preserved = currentProducts.filter((product) => product.brand !== brand);

database.updatedAt = verifiedAt;
database.products = [...preserved, ...allImported];

await fs.writeFile(productPath, `${JSON.stringify(database, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify(
    {
      ok: true,
      brand,
      imported: allImported.length,
      totalProducts: database.products.length,
      note: 'AI 이미지 전사(轉寫) 데이터 — 원본 대조 필요, 자동 스크래퍼 아님. 보충제라 1회 제공량(scoop/캡슐) 기준이며 100g 환산값이 아님. 번들(어드밴티지팩 등) 10종은 중복이라 제외함.',
    },
    null,
    2,
  ),
);

function stableId(value) {
  return createHash('sha1').update(value).digest('hex').slice(0, 12);
}
