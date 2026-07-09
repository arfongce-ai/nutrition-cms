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
npm.cmd run db:validate
npm.cmd run build
```
