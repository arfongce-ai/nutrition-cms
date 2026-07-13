# Official Nutrition DB 운영 방식

이 앱은 음식 사진 분석을 먼저 수행하고, 제품명·브랜드명·성분표 OCR 문자가 보이면 공식 제품 DB를 우선 조회합니다.

## 적용 순서

1. 촬영 이미지에서 음식 후보와 성분표 문자를 읽습니다.
2. `data/official-products.json`에서 제품명, 별칭, 브랜드명이 일치하는 제품을 찾습니다.
3. 제품이 있으면 해당 공식값을 A4 리포트 계산에 우선 적용합니다.
4. 제품값이 없으면 OCR로 읽은 성분표 숫자를 적용합니다.
5. 제품값과 OCR 숫자가 모두 부족하면 `data/official-product-sources.json`의 공식 홈페이지를 출처로 안내하고 일반 음식 추정값을 임시 적용합니다.

## 파일 역할

- `data/official-products.json`: 실제 계산에 쓰는 제품별 영양성분 DB입니다.
- `data/official-product-sources.json`: 브랜드별 공식 홈페이지, 메뉴, 영양성분표 확인처입니다.
- `scripts/update-official-product-db.mjs`: DB 검증, 출처 목록 병합, 분기 리뷰 날짜 갱신 스크립트입니다.
- `scripts/import-official-menu-db.mjs`: 스타벅스처럼 공식 메뉴 JSON을 제공하는 브랜드의 메뉴/영양값을 앱 DB 형식으로 변환합니다.
- `scripts/export-official-products-d1-seed.mjs`: 현재 공식 제품 DB를 Cloudflare D1 seed SQL로 변환합니다.
- `schema/official-menu-db.d1.sql`: 실시간 공식 메뉴 검색용 Cloudflare D1 스키마입니다.
- `functions/api/nutrition-search.js`: D1에서 공식 메뉴 후보를 검색하는 Pages Function API입니다.
- `.github/workflows/quarterly-official-nutrition-db.yml`: 매년 1월, 4월, 7월, 10월 1일에 자동 리뷰 PR을 만드는 워크플로우입니다.

## 제품 추가 기준

제품값은 다음 출처 중 하나로 확인된 경우에만 `official-products.json`에 넣습니다.

- 공식 제품 상세 페이지
- 공식 영양성분 PDF
- 공식 메뉴 상세 페이지
- 제품 포장 성분표 사진
- 운영자 수동 검수

## 제품 하나 추가 예시

```json
{
  "id": "brand-product-size",
  "brand": "브랜드명",
  "productName": "제품명",
  "aliases": ["OCR로 잡힐 수 있는 이름", "영문명"],
  "category": "가공식품/스낵",
  "servingSize": "총 내용량 92 g",
  "sourceType": "official_product_page",
  "sourceLabel": "브랜드 공식 제품 영양정보",
  "sourceUrl": "https://example.com/product",
  "verifiedAt": "2026-07-09",
  "allergens": ["밀", "대두"],
  "additiveWatch": ["향료", "산도조절제"],
  "nutrients": {
    "calories": 477,
    "carb": 57,
    "sugar": 5,
    "protein": 6,
    "fat": 25,
    "saturatedFat": 10,
    "transFat": 0,
    "sodium": 460,
    "fiber": 4,
    "leucine": 390
  }
}
```

## 검증 명령

```powershell
npm.cmd run db:import:starbucks
npm.cmd run db:export:d1
npm.cmd run db:validate
npm.cmd run build
```

## 공식 홈페이지 데이터화 원칙

- 브랜드별 페이지 구조가 다르므로 자동 수집기는 브랜드별 어댑터로 관리합니다.
- 공식 페이지에 영양값이 없는 항목은 값을 추정해서 넣지 않고, 앱에서 `분석이 안됩니다` 또는 성분 확인 필요 상태로 남깁니다.
- 스타벅스는 공식 메뉴 페이지가 `/upload/json/menu/{카테고리코드}.js` JSON을 사용하므로 음료와 푸드를 자동 병합할 수 있습니다.
- 수입된 값은 `verifiedAt`, `sourceUrl`, `sourceProductCode`를 함께 저장해 추후 재검수와 출처 확인이 가능하게 합니다.

## 바로 검색해서 불러오기

앱의 `웹에서 찾기` 버튼은 `/api/nutrition-search`를 호출합니다. 배포 환경에서 Cloudflare D1 바인딩 `NUTRITION_DB`가 연결되어 있으면 다음 순서로 작동합니다.

1. 앱 내장 공식 DB에서 먼저 검색합니다.
2. 결과가 부족하면 D1 공식 메뉴 DB를 검색합니다.
3. 후보를 카드로 표시하고, 사용자가 누른 항목만 음식 기록 또는 성분표에 반영합니다.
4. 공식 DB에 없는 값은 자동으로 만들지 않고 `분석이 안됩니다` 또는 성분 확인 필요 상태로 둡니다.

D1 초기화 예시:

```powershell
wrangler d1 execute nutrition-cms-db --file schema/official-menu-db.d1.sql
npm.cmd run db:export:d1
wrangler d1 execute nutrition-cms-db --file data/imported/d1-official-products-seed.sql
```

## 공공 식품영양 DB 적재

첨부받은 공공 DB XLSX는 프론트 번들에 직접 넣지 않고 Cloudflare D1 검색 테이블 `public_foods`로 넣습니다. 카메라 측정 후 `웹에서 찾기`를 누르면 공식 메뉴 DB와 공공 식품 DB를 함께 검색하고, 사용자가 후보를 비교한 뒤 `음식 기록 적용` 또는 `성분표 적용`으로 확정합니다.

현재 변환 대상:

- `20260604_가공식품_293506건.xlsx`
- `20260626_가공식품DB_298288건.xlsx`
- `20260623_건강기능식품DB_5556건 (3).xlsx`
- `20251229_음식DB 19495건.xlsx`

변환 명령:

```powershell
npm.cmd run db:import:public-foods
```

생성 결과:

- 출력 폴더: `data/imported/public-foods-d1`
- manifest: `data/imported/public-foods-d1/manifest.json`
- seed 조각: `public-foods-seed-0001.sql`부터 순차 생성

D1 반영 순서:

```powershell
$env:CLOUDFLARE_API_TOKEN="Cloudflare API 토큰"
npm.cmd run db:apply:d1
```

`wrangler.toml`의 `NUTRITION_DB` D1 binding에 실제 `database_id`가 들어가 있어야 배포 환경에서 `/api/nutrition-search`가 공공 DB까지 검색합니다.
