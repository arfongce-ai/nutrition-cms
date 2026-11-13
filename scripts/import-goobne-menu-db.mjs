import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const productPath = path.join(rootDir, 'data', 'official-products.json');
const brand = '굽네치킨';

// 굽네치킨은 "영양성분 및 알레르기 유발물질" 표가 사이트에 텍스트가 아니라 이미지 한 장으로만 제공됨
// (Claude in Chrome으로 직접 확인, 2026-11-13 — cdn.goob-ne.com 이미지, 표 자체에 "(26.09)" 버전 표기 있음).
// 이 이미지는 일반적인 <img> 태그/네트워크 요청으로 잡히지 않는 방식으로 렌더링되어(커스텀 뷰어),
// 클라우드 샌드박스에서도 해당 도메인에 직접 접속이 막혀 있어 자동 스크래핑이 불가능함.
// → 정상 스크래퍼가 아니라, Claude가 실제 사이트에서 화면을 캡처해 "눈으로 읽어 옮겨 적은" 고정값입니다.
// 공식 사이트가 표 디자인을 바꾸거나 수치를 바꾸면 이 파일이 자동으로 따라가지 않으니, 주기적으로
// https://www.goobne.co.kr/menu/menu_view_p?itemId=30001 → "영양성분 및 알레르기" 탭에서
// 사람이 눈으로 재대조해야 합니다(아래 reviewNote에도 동일 안내 있음).
// 기준은 전부 "100g당"입니다(1인분/1조각 환산 아님) — 교촌치킨과 동일한 주의사항.
const sourceUrl = 'https://www.goobne.co.kr/menu/menu_view_p?itemId=30001';
const sourceLabel = '굽네치킨 공식 홈페이지 "영양성분 및 알레르기 유발물질" 표(이미지, 2026.09판) — Claude가 화면 캡처로 옮겨 적음, 원본 대조 필요';
const verifiedAt = new Date().toISOString().slice(0, 10);

// [제품명, 열량kcal, 탄수화물g, 당류g, 단백질g, 지방g, 포화지방g, 트랜스지방g, 나트륨mg] — 전부 100g당
const CHICKEN_ROWS = [
  ['서울엄마 파기름떡볶이 치킨', 215.54, 14.93, 4.98, 21.54, 7.74, 2.72, 0.16, 423.87],
  ['추추 치킨 스테이크', 174.35, 16.21, 5.32, 13.72, 6.07, 2.06, 0.11, 326.84],
  ['굽네 장각구이', 209.54, 7.73, 2.52, 22.02, 10.06, 3.09, 0.11, 436.97],
  ['New 오리지널', 190.14, 2.44, 0.88, 31.28, 6.14, 1.78, 0.33, 328.91],
  ['볼케이노', 221.7, 6.5, 4.8, 27.4, 9.54, 2.7, 0.06, 519.3],
  ['갈비천왕', 194, 4.19, 2.5, 26.8, 7.73, 2.46, 0.043, 361],
  ['고추 바사삭', 233.54, 8.35, 1.78, 23.71, 11.7, 3.06, 0.05, 449],
  ['오븐 바사삭', 229.93, 7.14, 2.08, 26.29, 10.69, 3.12, 0.04, 673.5],
  ['남해마늘 바사삭', 201.47, 10.81, 1.23, 21.4, 8.07, 2.28, 0.04, 444.7],
  ['양념 히어로', 221.49, 13.9, 7.71, 21.56, 8.85, 2.58, 0.05, 447.9],
];

// 폭립은 "치킨 & 폭립" 표 안에 같이 있지만 실제로는 돼지고기(등갈비) 제품이라, 치킨 카테고리와
// 섞여서 "치킨 유사 대체" 평균에 잘못 들어가지 않도록 카테고리를 따로 둡니다.
const PORK_ROWS = [
  ['폭립(돼지 등갈비)', 297.3, 8.49, 8.43, 25.29, 18.02, 6.02, 0.04, 476.9],
];

function buildProduct([productName, calories, carb, sugar, protein, fat, saturatedFat, transFat, sodium], categoryLabel) {
  return {
    id: `goobne-${stableId(`${categoryLabel}|${productName}`)}`,
    brand,
    productName,
    aliases: [...new Set([`굽네치킨 ${productName}`, `굽네 ${productName}`, productName, productName.replace(/\s+/g, '')])],
    category: `${brand}/${categoryLabel}`,
    servingSize: '100g 기준',
    servingGram: 100,
    sourceType: 'ai_image_transcription',
    sourceLabel,
    sourceUrl,
    verifiedAt,
    allergens: [],
    additiveWatch: [saturatedFat >= 10 ? '포화지방' : ''].filter(Boolean),
    nutrients: { calories, carb, sugar, protein, fat, saturatedFat, transFat, sodium, caffeine: null },
    reviewNote:
      '⚠️ 이 상품은 공식 사이트에 텍스트 영양정보가 없고 이미지 표로만 제공되어, Claude가 2026-11-13에 '
      + '화면을 캡처해서 수치를 옮겨 적었습니다(AI가 이미지에서 읽음 — 원본 대조 필요). '
      + '다른 임포터처럼 자동으로 재확인되지 않으니, 사이트에서 표가 바뀌면(버전 "(26.09)" 등) 수동으로 다시 옮겨 적어야 합니다. '
      + '⚠️ 공식 표 기준이 "100g당"이라 1인분/1조각 실제 섭취량과 다릅니다. '
      + '알레르기 유발물질은 표에 있으나 이미지가 작아 정확히 옮겨 적지 못해 비워뒀습니다(원본 이미지에서 직접 확인 필요).',
  };
}

const allImported = [
  ...CHICKEN_ROWS.map((row) => buildProduct(row, '치킨')),
  ...PORK_ROWS.map((row) => buildProduct(row, '립(돼지)')),
];

const database = JSON.parse(await fs.readFile(productPath, 'utf8'));
const currentProducts = Array.isArray(database.products) ? database.products : [];
const preserved = currentProducts.filter((product) => product.brand !== brand);

database.updatedAt = new Date().toISOString().slice(0, 10);
database.products = [...preserved, ...allImported];

await fs.writeFile(productPath, `${JSON.stringify(database, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify(
    {
      ok: true,
      brand,
      imported: allImported.length,
      totalProducts: database.products.length,
      note: 'AI 이미지 전사(轉寫) 데이터 — 원본 대조 필요, 자동 스크래퍼 아님',
    },
    null,
    2,
  ),
);

function stableId(value) {
  return createHash('sha1').update(value).digest('hex').slice(0, 12);
}
