# 몸가짐 실시간 칼로리 측정

Firebase + Cloudflare Pages 배포를 전제로 만든 카메라 우선 영양 관리 앱입니다. 로그인 화면과 대시보드 없이 앱을 열면 바로 식단 촬영 카메라로 진입합니다.

## 실행

```powershell
npm.cmd install
npm.cmd run dev -- --host 0.0.0.0 --port 5173
```

PC 브라우저에서는 `http://127.0.0.1:5173`으로 접속합니다. 같은 와이파이에 연결된 휴대폰에서는 PC의 IPv4 주소를 사용합니다. 예: `http://192.168.219.119:5173`

## 화면 흐름

1. 앱 실행 즉시 전체 화면 카메라
2. 먹을 음식 또는 식단을 촬영
3. 카메라 화면에서 영양표 글자가 보이면 브라우저 기본 OCR로 열량, 탄수화물, 단백질, 지방, 당류, 나트륨을 가능한 만큼 실시간 자동 인식
4. 촬영 전 카메라 화면의 실시간 자동 분석 카드에서 열량, 당류, 나트륨 위험 신호 확인
5. 촬영 즉시 사진 색상/구도 기반으로 음식 후보를 자동 선택하고 음식 분석을 먼저 계산
6. 후보가 다르면 버튼 한 번으로 `밥/반찬`, `닭가슴살 샐러드`, `바나나/과일` 등으로 보정
7. 포장식품이면 식품 영양표의 열량, 탄수화물, 단백질, 지방, 당류, 나트륨도 함께 입력
8. 음식 분석값과 식품 영양표 입력값이 함께 합산되어 KDRI/질환/운동 목적 기준 결과리포트 즉시 갱신
9. 저장 버튼으로 리포트 저장

현재 단계에서는 촬영 직후 사진의 중심 색상과 구도를 이용해 음식 후보를 자동 추정하고 결과리포트를 바로 생성합니다. 실제 AI 음식 자동 인식 전 단계이므로 정확도를 높이려면 후보 버튼이나 음식명/양 수정으로 보정할 수 있습니다. 식품 영양표는 보조 입력이며, 포장식품 분석 정확도를 높일 때 함께 사용합니다. 영양표 자동 인식은 브라우저의 `TextDetector` 지원 기기에서 동작하며, 미지원 기기에서는 촬영 후 열량과 주요 영양소 칸에 직접 입력할 수 있습니다.

Firebase 설정이 있으면 저장 버튼을 누를 때만 Firebase SDK를 불러와 Firestore `nutritionReports` 컬렉션에 저장합니다. 설정이 없거나 저장에 실패하면 기기 로컬 저장소에 저장합니다.

## Firebase 콘솔 설정

Firebase 콘솔에서 웹앱을 만든 뒤 `.env` 파일에 아래 값을 채웁니다.

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

로그인 화면은 없지만 Firestore 저장 보안을 위해 Firebase Authentication의 익명 로그인을 켜는 구성을 사용합니다. `firestore.rules`는 익명 인증 사용자의 리포트 생성만 허용하도록 준비되어 있습니다.

```powershell
firebase deploy --only firestore:rules
```

## Cloudflare Pages 설정

- GitHub 계정: `arfongce-ai`
- Framework preset: `Vite`
- Build command: `npm run build`
- Build output directory: `dist`
- Environment variables: `.env`의 `VITE_FIREBASE_*` 값을 Cloudflare Pages 변수로 등록

`public/_redirects`가 포함되어 있어 새로고침 시에도 앱이 유지됩니다.
`wrangler.toml`에 Pages 출력 디렉터리가 들어 있어 Wrangler 배포에서도 같은 설정을 사용합니다.

## 오픈소스 및 외부 데이터 연동

- **바코드 스캔**: 브라우저 내장 `BarcodeDetector`(Chrome/Android 계열)와 `@zxing/browser`(MIT 라이선스, Safari/iOS 포함 전 브라우저 폴백)를 함께 사용합니다. OCR과 동일하게 "내장 API 우선, 오픈소스 폴백" 구조입니다.
- **Open Food Facts 연동** (`functions/api/barcode-lookup.js`): 인식된 바코드를 [Open Food Facts](https://openfoodfacts.org)(ODbL 라이선스, API 키 불필요)에서 조회해 제품명·영양정보를 가져옵니다. 전 세계 크라우드소싱 데이터라 한국 제품 커버리지는 식약처 공식 DB보다 낮으므로, 항상 **보조 출처**로만 취급합니다. 이 출처로 채워진 항목은 `official: false`로 표시되어 리포트에서 "외부 출처 확인 (공식 아님)"으로 구분 표시되고, 검색/OCR로 채워진 식약처 공식값과 절대 같은 취급을 받지 않습니다.
- **추천 후속 작업 — 식약처 공식 바코드 API**: [공공데이터포털의 "식품의약품안전처_바코드연계제품정보"](https://www.data.go.kr/data/15060549/openapi.do)는 국내 제품에 한해 Open Food Facts보다 훨씬 신뢰도 높은 1차 출처가 될 수 있습니다. `data.go.kr`에서 개인 인증키를 발급받아 `MFDS_BARCODE_API_KEY` 같은 이름으로 Cloudflare Pages 환경 변수에 등록하고, `barcode-lookup.js`에 이 API를 Open Food Facts보다 우선 조회하도록 추가하면 바코드 인식의 신뢰도를 한 단계 높일 수 있습니다. (현재는 API 응답 스키마를 실제 키로 검증하지 못해 연동 코드를 작성하지 않았습니다.)
- 두 의존성 모두 `npm audit` 기준 신규 취약점이 없습니다. (기존 `firebase`/`uuid` 관련 경고는 이번 작업과 무관한 사전 존재 항목입니다.)

## 검증

```powershell
npm run check
```

## 근거 메모

현재 판정 로직은 사용자가 제공한 기획문과 참고 PDF 목록을 기반으로 한 데모 규칙입니다.

- 2025 KDRI: AMDR, CDRR, 생애주기별 영양 기준 확장 예정
- 대한비만학회: 체중 감량 시 일일 필요량 대비 500~1000 kcal 제한 원칙 반영
- 한국운동영양학회/ISSN: 종목별 단백질, 탄수화물, 수분·전해질 타이밍 반영
- KADA/WADA: 마황/에페드린, 해외 직구 부스터, 성분 불명 보충제 위험 우선 경고

의학적 판단, 질환별 제한량, 도핑 위험 판정은 실제 서비스 단계에서 최신 공식 데이터베이스와 전문가 검수를 통해 업데이트해야 합니다.
