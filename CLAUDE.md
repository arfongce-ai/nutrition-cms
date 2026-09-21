# Claude 작업 안내

몸가짐 회원용 영양 기록 앱 프로젝트다. CMS 연동을 이어서 작업할 때 먼저 다음 문서를 읽는다.

1. `docs/CLAUDE_HANDOFF.md`
2. `docs/cms-integration-contract.md`
3. claude.ai 프로젝트 "세컨드 브레인 프로잭트"의 `claude/2026-09-17_영양앱-CMS연동_1단계조사_설계문서.md` (섹션 10~15가 최신 진행상황)

운영 서비스는 `https://momgagym-nutrition.pages.dev/#diary`, 연결 대상 CMS는 `https://momgagym-cms2.pages.dev/schedule`이다.

**공식 저장소(2026-09-21 확인)**: 이 폴더가 실제로 GitHub(`arfongce-ai/nutrition-cms`)에 연결된 원본이며, CODEX가 계속 작업해 온 브랜치(`codex/calorie-app-20260918-1230`, 칼로리 인식 정확도 개선)가 여기 있다. **한때 다른 컴퓨터의 `C:\Users\DONG\Documents\GitHub\nutrition-cms` 폴더에 CMS 연동 코드를 옮겨둔 적이 있는데, 그 폴더는 git 연결이 안 된 별도 사본이었다 — 이제 이 저장소에 CMS 연동 코드를 합쳤으니 그 폴더와 거기 있던 `nutrition-cms-setup.ps1` 스크립트는 더 이상 쓰지 않는다.** 앞으로는 하나의 작업 폴더(이 저장소)만 쓴다(`CODEX_CLAUDE_SYNC_GUIDE_KR.md` 참고 — momgagym-cms2 얘기지만 원칙은 동일).

**CMS 연동 진행 상황(2026-09-21 기준, 미구현 아님)**: CMS(momgagym-cms2) 쪽 API(`nutrition-link.js`, `nutrition-session.js`, `nutrition-summary.js`, `nutrition-feedback.js`, `teacher-nutrition.js`)와 CMS 화면(회원상세 "영양 기록" 탭)은 구현·검증 완료. nutrition-cms 쪽도 `AppGate.jsx`(연결코드 입력/잠금), `FeedbackSheet.jsx`(피드백 확인/답변), `cmsSync.js`(하루 요약 전송), `nutritionLink.js`/`sessionGuard.js`/`nutritionFeedback.js`를 이 저장소(CODEX의 칼로리 인식 개선 작업 위)에 합쳤고, `npm test` 33/33 통과·`npm run build` 성공 확인됨. **다만 실제로 작동하려면 아래가 필요**:
- Cloudflare Pages(momgagym-cms2 프로젝트) 환경변수에 `NUTRITION_LINK_SECRET` 등록 — 안 하면 연결코드 교환이 503으로 실패한다(설계상 의도된 안전장치).
- 이 저장소를 git commit/push(사용자가 직접 — 아래 "운영 배포" 원칙 참고). 커밋 전에 CODEX가 손대던 8개 파일(`functions/api/vision-analyze.js`, `scripts/verify-meal-ui.mjs`, `src/App.jsx`, `src/components/MealPresentation.jsx`, `src/services/nutritionEngine.js`, `src/services/officialNutritionSources.js`, `src/services/officialProductDatabase.js`, `src/services/reportStore.js`)와 이번에 합친 CMS 연동 변경이 같이 들어간다는 점을 알고 있을 것.
- 연결코드 발급→교환→기록→CMS 확인까지 실제 기기로 왕복 테스트 아직 안 함.

현재 회원 앱의 식사 기록 기능은 운영 중이다. CMS의 실제 API·인증·회원 ID·담당 배정 스키마를 확인하기 전에는 endpoint, 토큰, 권한을 추측해 구현하지 않는다. 회원 개인정보와 비밀키는 저장소나 채팅에 넣지 않고, 테스트용 가짜 계정으로 먼저 검증한다.

작업 목표는 다음과 같다.

- 회원 앱의 식사·하루 요약을 담당 선생님이 CMS에서 확인
- 선생님은 자신에게 배정된 회원만 조회
- 선생님이 식사 또는 날짜별 피드백 작성
- 회원이 앱에서 피드백을 읽고 답변
- 원본 사진과 건강 상세정보는 별도 동의 없이 CMS로 전송하지 않음

구현 전 API 매핑표와 권한 흐름을 먼저 제시하고, 구현 후 `npm test`와 `npm run build`를 실행한다. 운영 배포(git commit/push, Cloudflare 환경변수 등록 포함)는 사용자가 명시적으로 요청한 경우에만 한다.
