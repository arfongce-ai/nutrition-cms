# HANDOFF — Codex ↔ Claude Code 인수인계

규칙은 `AGENTS.md` 참고. 작업을 시작하기 전에 읽고, 끝나면 갱신한다.
공개 저장소이므로 비밀값·개인정보 기록 금지.

## 작업 잠금
같은 파일을 동시에 수정하지 않기 위한 표. 작업이 끝나면 내 줄을 지운다.

| 도구 | 수정 중인 파일/영역 | 시작 일시 |
|------|--------------------|-----------|
| (없음) | | |

## 프로젝트 현황 (2026-09-22 기준, 착수 전 `git status`로 재확인)

### 저장소 (2026-09-22 실측 — 직접 clone해서 확인함)
- 공식 저장소: `arfongce-ai/nutrition-cms` — main 브랜치에 이미 병합·push 완료(커밋 `5612999`). CMS연동 파일(AppGate.jsx, cmsSync.js, nutritionLink.js, sessionGuard.js, nutritionFeedback.js, FeedbackSheet.jsx) 전부 main에 있음
- CMS: `arfongce-ai/momgagym-cms2` (React/Vite, Cloudflare Pages, Firebase) — nutrition-*.js 5개 함수, firestore.rules 잠금 전부 main에 반영 확인됨
- 폐기 대상: `C:\Users\DONG\Documents\GitHub\nutrition-cms` 사본, `nutrition-cms-setup.ps1` (실행하면 히스토리가 다시 갈라짐)

### 영양앱 ↔ CMS 연동
- 방식: nutrition-cms가 HTTPS API로 CMS에 요약을 보내고, 트레이너가 회원상세 "영양 기록" 탭을 열 때 조회
- CMS 쪽: `functions/api/nutrition-link.js`, `nutrition-session.js`, `nutrition-summary.js`, `nutrition-feedback.js`, `teacher-nutrition.js`, `_middleware.js`, `_shared/cors.js`, `firestore.rules`, `MemberDetail.jsx`, `teacherNutritionService.js`
- 영양앱 쪽: `AppGate.jsx`, `FeedbackSheet.jsx`, `cmsSync.js`, `nutritionLink.js`, `sessionGuard.js`, `nutritionFeedback.js`, `main.jsx`, `App.jsx`(삽입 5곳), `.env.example`
- 안전장치: `VITE_REQUIRE_MEMBER_LINK=true`일 때만 연결 화면 활성화 (왕복 테스트 통과 전에는 켜지 않는다)

### 테스트 기준선 (2026-09-22 실측)
- momgagym-cms2: `npm test` 3059/3070 통과. 기존부터 실패 중인 11개는 무관. `.github/test-baseline.json`의 `minPassing`이 이 숫자를 자동으로 지킨다(회귀 게이트, 아래 참고)
- nutrition-cms: `npm test` 33/33, `npm run build` 성공

### 자동 게이트 (신규, 2026-09-22 추가)
- momgagym-cms2: `.github/workflows/regression-gate.yml` — 어느 브랜치든 push/PR마다 실행. 기존 11개 실패는 넘어가고, 통과 개수가 기준선(`minPassing`)보다 줄면(=새 회귀) 워크플로우 실패로 표시. 기존 배포(`cloudflare-pages.yml`)는 건드리지 않음. GitHub 서버에서만 돌고 CMS/Firestore에 접근하지 않아 CMS 속도와 무관
- nutrition-cms: `.github/workflows/ci.yml` — push/PR마다 `npm test`(33/33 기준, 하나라도 실패하면 워크플로우 실패) + `npm run build`
- 기존 실패를 고치면 `.github/test-baseline.json`의 `minPassing`을 올려서 기준을 다시 조인다
- 주의: `dashboard-snapshot.yml`이 30분마다 Firestore를 읽는다. CMS 앱 자체를 느리게 하진 않지만 Firestore 무료 읽기 할당량을 가장 많이 쓰는 항목이라 늘어나면 여기부터 확인

### 미완료 (사용자 액션 포함)
- Cloudflare Pages에 `NUTRITION_LINK_SECRET` 등록 (등록 전까지 연결코드 교환 시 503)
- nutrition-cms `VITE_FIREBASE_PROJECT_ID`가 CMS(`momgagym-cms`)와 같은 프로젝트인지 확인
- 실기기 왕복 테스트: 연결코드 발급 → 교환 → 식사·물 기록 → 요약 전송 → CMS "영양 기록" 탭 → 피드백 → 앱 읽음/답변 → 연결 해제
- nutrition-cms 익명 로그인 / 넓은 Firestore 규칙 → 회원 인증 기반으로 강화 (실서비스 전 필수)
- CMS `serviceStatus`(active/suspended/cancelled) 신설. 기존 `isMemberExpired()`는 유지하고 그 위에 얹는다
- 바벨 궤적 잔상(`LiftingMeasure.jsx`, `recordingOverlay.js`) 라이브 카메라 검증

### 설계 원칙
- 있던 것에 추가 (대체·병행 구현 금지), UI는 단순하게
- 무료 티어 원칙 (Notion, GitHub Actions, Firebase, Cloudflare Pages)
- AI 평가는 확정 판정이 아니라 측정값 + 신뢰도 + 원본 영상 + 트레이너 확인값을 함께 저장
- 진행 순서: 회원 로그인·권한 → 트레이너 대시보드 → 실시간 피드백 → 자세·보행 AI 모듈 → AI 기반 플랜 → Notion 동기화

## 작업 로그
최신 항목이 위. 형식을 그대로 복사해서 쓴다.

### YYYY-MM-DD HH:MM · 도구(Codex/Claude Code) · 한 줄 요약
- 한 일:
- 변경 파일:
- 테스트: (명령어 → 결과)
- 남은 위험:
- 다음에 할 일:
