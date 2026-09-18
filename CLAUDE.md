# Claude 작업 안내

몸가짐 회원용 영양 기록 앱 프로젝트다. CMS 연동을 이어서 작업할 때 먼저 다음 문서를 읽는다.

1. `docs/CLAUDE_HANDOFF.md`
2. `docs/cms-integration-contract.md`

운영 서비스는 `https://momgagym-nutrition.pages.dev/#diary`, 연결 대상 CMS는 `https://momgagym-cms2.pages.dev/schedule`이다.

현재 회원 앱의 식사 기록 기능은 운영 중이지만 CMS 연결은 미구현이다. CMS의 실제 API·인증·회원 ID·담당 배정 스키마를 확인하기 전에는 endpoint, 토큰, 권한을 추측해 구현하지 않는다. 회원 개인정보와 비밀키는 저장소나 채팅에 넣지 않고, 테스트용 가짜 계정으로 먼저 검증한다.

작업 목표는 다음과 같다.

- 회원 앱의 식사·하루 요약을 담당 선생님이 CMS에서 확인
- 선생님은 자신에게 배정된 회원만 조회
- 선생님이 식사 또는 날짜별 피드백 작성
- 회원이 앱에서 피드백을 읽고 답변
- 원본 사진과 건강 상세정보는 별도 동의 없이 CMS로 전송하지 않음

구현 전 API 매핑표와 권한 흐름을 먼저 제시하고, 구현 후 `npm test`와 `npm run build`를 실행한다. 운영 배포는 사용자가 명시적으로 요청한 경우에만 한다.
