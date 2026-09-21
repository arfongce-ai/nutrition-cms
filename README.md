# 몸가짐 실시간 칼로리 측정

Firebase + Cloudflare Pages 배포를 전제로 만든 카메라 우선 영양 관리 앱입니다. 로그인 화면과 대시보드 없이 앱을 열면 바로 식단 촬영 카메라로 진입합니다.

## 캘린더·식사 일기 기능

몸가짐 CMS 선생님 연동 계획과 Claude 인수인계 내용은 [CMS 연동 인수인계 문서](docs/CLAUDE_HANDOFF.md)와 [CMS 계약 초안](docs/cms-integration-contract.md)에 정리되어 있습니다. 현재 CMS는 아직 연결하지 않았습니다.

- `내 기록 → 달력·일기`: 월 달력에 날짜별 kcal를 표시합니다. 날짜를 선택해 식사와 하루 메모, 물 섭취량, 식품군 체크를 저장합니다. `하루 기록 완료`는 그날 먹은 식사·간식을 모두 기록했는지 사용자가 확인하는 항목입니다.
- `주간`은 선택한 날짜가 속한 월~일, `월간`은 해당 월입니다. 기존 `7일`·`30일`은 선택한 날짜까지의 이동 기간입니다. 평균은 식사를 기록한 날만 포함하며 미기록일과 미래 날짜를 0 kcal 섭취로 간주하지 않습니다. 부분 기록과 미확인 영양정보를 표시합니다.
- `사진 고르기` 또는 `하루 사진 한 번에 올리기`에서 최대 20장(각 30 MB 이하)을 선택합니다. EXIF 촬영 시간을 먼저 읽고, 없는 사진은 사용자가 실제 시간을 확인합니다. 사진별 날짜·시간·식사 구분을 바꾼 뒤 시간순으로 음식과 양을 확인하며 저장합니다. 사진 한 장은 식사 한 건이며 중복 촬영은 목록에서 제외합니다.
- 기록의 `이름·양 고치기 → 날짜·시간`에서 식사 시간을 바꾸면 달력과 집계가 즉시 변경됩니다. `createdAt`은 섭취 시각, `recordedAt`은 최초 저장 시각입니다. Firestore에도 두 시각을 구분해 저장합니다.
- `6대 영양소`: 탄수화물·단백질·지방 기록, 비타민·무기질을 위한 식품 다양성 가이드, 직접 입력한 물 기록을 제공합니다. 개별 비타민·무기질 데이터가 없으면 충족률을 생성하지 않습니다.
- `최신 자료`: `/api/nutrition-updates`가 WHO 공식 건강한 식사 가이드와 NIH·NLM PubMed의 식사·단백질·수분·스포츠 영양 관련 체계적 문헌고찰/메타분석을 조회합니다. 화면을 보는 동안 15분마다 확인하고 다시 화면으로 돌아올 때와 `지금 확인` 버튼으로도 조회합니다. 출처 발행·색인 지연이 있으며 서버 캐시는 최대 15분입니다. 연결 실패 시 마지막 성공 시각과 저장 자료 여부를 명시합니다. 새 연구가 영양 판정 규칙이나 제품 DB 수치를 자동으로 바꾸지는 않습니다.

식사 기록의 기존 120건 자동 삭제 제한을 제거했습니다. 하루 메모·물·식품군과 사진은 기기 로컬 저장입니다. 저장 용량이 부족하면 기존 동작처럼 오래된 사진부터 제외될 수 있으며, 브라우저 데이터를 지우면 로컬 기록이 사라질 수 있습니다. 식사 수치만 Firebase 설정 시 기존 익명 인증 저장을 이용합니다.

`npm run test:diary`는 여러 사진 시간 지정·연속 저장, 날짜 이동, 일기/물 기록 새로고침, 주간·월간 피드백, 6대 영양소, 자료 연결 실패 및 320/390/1280px 화면을 검증합니다. `npm run test:ui`와 같은 Playwright 실행 환경 및 로컬 서버를 사용합니다. 먼저 `npm run build`, `node scripts/qa-serve.mjs`, `npm run test:ui`를 실행하면 테스트용 사진이 준비됩니다. UI 테스트는 외부 인식/자료 API 응답을 대체하므로 실제 서비스 연결 검증과 구분합니다.

### 개발 서버 실행

```powershell
npm.cmd install
npm.cmd run dev -- --host 0.0.0.0 --port 5173
```

PC 브라우저에서는 `http://127.0.0.1:5173`으로 접속합니다. 같은 와이파이에 연결된 휴대폰에서는 PC의 IPv4 주소를 사용합니다. 예: `http://192.168.219.119:5173`

## 화면 흐름

1. 앱 실행 즉시 전체 화면 카메라
2. 먹을 음식 또는 식단을 촬영
3. 포장식품은 EAN/UPC 바코드를 먼저 확인하고, 일치 제품이 있으면 사진 외형 추정보다 우선 적용
4. 카메라 화면에서 영양표 글자가 보이면 OCR로 열량, 탄수화물, 단백질, 지방, 당류, 나트륨을 가능한 만큼 실시간 자동 인식
5. 촬영 전 카메라 화면의 실시간 자동 분석 카드에서 열량, 당류, 나트륨 위험 신호 확인
6. 촬영 사진에서 음식 후보를 인식한 뒤 공개 라이선스 유사 사진과 영양 DB 후보를 함께 표시
7. 사용자가 가장 가까운 DB 항목을 선택해 적용
8. KDRI/질환/운동 목적 기준 결과리포트와 공식 데이터·DB 일치·사진 추정·확인 필요 신뢰도 표시
9. 필요하면 음식명·양 또는 영양표 값을 보정한 뒤 저장

음식 사진은 AI 인식 결과를 바로 확정하지 않고 유사 사진과 영양 DB 후보 확인 단계를 거칩니다. 포장식품 바코드는 Open Food Facts를 보조 출처로 사용하며 공식 데이터로 표시하지 않습니다. 영양표 자동 인식은 지원 기기에서 동작하고, 미지원 기기에서는 촬영 후 주요 영양소 값을 직접 보완할 수 있습니다.

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
npm test
```

`npm run test:ui`는 Playwright와 Chrome을 사용해 320/390/1280px 화면, 양 선택, 저울 입력 수정, 포장지 회분 계산, 저장·수정·복원 흐름을 검사합니다. 필요하면 `MEAL_PLAYWRIGHT_MODULE`(Windows에서는 file URL)과 `MEAL_CHROME_PATH`로 실행 경로를 지정합니다. API는 테스트용 응답으로 대체합니다.

실제 음식 정확도 평가는 `npm run accuracy:evaluate -- .qa/measured-meals.json`으로 실행합니다. 자료 수집 방법과 지표의 의미는 [실측 검증 안내](docs/recognition-validation.md)에 있습니다. 자동 테스트 통과는 실제 음식 인식률 검증을 의미하지 않습니다.

## 근거 메모

현재 판정 로직은 사용자가 제공한 기획문과 참고 PDF 목록을 기반으로 한 데모 규칙입니다.

- 2025 KDRI: AMDR, CDRR, 생애주기별 영양 기준 확장 예정
- 대한비만학회: 체중 감량 시 일일 필요량 대비 500~1000 kcal 제한 원칙 반영
- 한국운동영양학회/ISSN: 종목별 단백질, 탄수화물, 수분·전해질 타이밍 반영
- KADA/WADA: 마황/에페드린, 해외 직구 부스터, 성분 불명 보충제 위험 우선 경고

의학적 판단, 질환별 제한량, 도핑 위험 판정은 실제 서비스 단계에서 최신 공식 데이터베이스와 전문가 검수를 통해 업데이트해야 합니다.
