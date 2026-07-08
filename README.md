# 몸가짐 영양 CMS

Firebase + Cloudflare Pages 배포를 전제로 만든 카메라 우선 영양 관리 앱입니다. 로그인 화면과 대시보드 없이 앱을 열면 바로 식단 촬영 카메라로 진입합니다.

## 실행

```powershell
npm.cmd install
npm.cmd run dev -- --host 0.0.0.0 --port 5173
```

PC 브라우저에서는 `http://127.0.0.1:5173`으로 접속합니다. 같은 와이파이에 연결된 휴대폰에서는 PC의 IPv4 주소를 사용합니다. 예: `http://192.168.219.119:5173`

## 화면 흐름

1. 앱 실행 즉시 전체 화면 카메라
2. 우측 상단 설정 버튼에서 사용자 모드, 기저질환, 운동 목적, 분석 샘플 변경
3. 하단 촬영 버튼으로 A4 리포트 카드 생성
4. 저장 버튼으로 리포트 저장

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
