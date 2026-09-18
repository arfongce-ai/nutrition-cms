# 몸가짐 영양 앱 → 몸가짐 CMS 인수인계 문서

이 문서는 이 프로젝트를 다른 Claude 세션에서 이어서 작업하기 위한 기준 문서다. 먼저 이 파일을 읽고, `docs/cms-integration-contract.md`의 계약을 CMS의 실제 API와 대조한 다음 구현한다.

## 1. 제품 목표

회원이 음식 사진을 기록하고, 식사 시간·양·영양정보를 확인하며, 캘린더에서 일기와 주간·월간 평가를 본다. 몸가짐 CMS의 선생님은 자신에게 배정된 회원의 영양 요약을 확인하고 피드백을 작성한다. 회원은 앱에서 선생님 피드백을 읽고 확인하거나 답변한다.

운영 서비스:

- 회원 앱: https://momgagym-nutrition.pages.dev/#diary
- 연결할 몸가짐 CMS: https://momgagym-cms2.pages.dev/schedule

CMS 연결은 아직 하지 않았다. 판매사이트 연결도 하지 않았다. API 키, Firebase 자격증명, CMS 비밀번호를 이 저장소나 채팅에 넣지 않는다.

## 2. 현재 구현 상태

### 회원 앱에 이미 있는 기능

- React 18 + Vite + Cloudflare Pages Functions
- 음식 사진 촬영·업로드, OCR, Vision 후보, 음식명·양 확인
- EXIF 촬영시간 읽기 및 사진 여러 장의 날짜·시간 수정
- `내 기록 → 달력·일기`
- 오늘·주간·월간·7일·30일 통계
- 하루 메모, 물 섭취량, 식품군 체크, 하루 기록 완료
- 6대 영양소 안내: 탄수화물·단백질·지방 기록, 비타민·무기질 식품 다양성 안내, 물 기록
- WHO 건강 식사 가이드와 NIH/NLM PubMed 최신 자료 API
- 음식 기록 수정·삭제·복원

### 현재 저장 구조의 한계

- `src/services/reportStore.js`: 기기 로컬 저장소 `nutritionReports.v1`를 기본으로 사용한다.
- Firebase 설정이 있으면 익명 Firebase Auth로 Firestore `meals_history`에 저장한다.
- `src/App.jsx`: 나이·성별·키·몸무게·건강 상태·운동 목적 프로필은 `localStorage`에 저장한다.
- Firebase 기록의 `imageUrl`은 현재 클라우드에 빈 문자열로 저장한다. 원본 사진은 기본적으로 기기에 남는다.
- 현재 회원 앱에는 사람 계정, CMS 회원 ID, 선생님 ID, 담당 회원 배정, 피드백 데이터 모델이 없다.
- 현재 `firestore.rules`의 `meals_history` 읽기는 `request.auth.uid == resource.data.uid`인 본인 기록만 허용한다. 선생님 CMS 권한은 아직 없다.
- 익명 Auth는 같은 회원이 다른 기기에서 로그인하거나 탈퇴·계정 복구하는 데 적합하지 않다. CMS 연동 전 계정 체계가 필요하다.

관련 파일:

- 회원 기록: `src/services/reportStore.js`
- 회원 화면: `src/App.jsx`
- Firebase 초기화: `src/firebase.js`
- Firestore 규칙: `firestore.rules`
- 캘린더 통계·일기: `src/services/diaryInsights.js`, `src/components/DiaryCalendar.jsx`
- 운영 API: `functions/api/*.js`
- 기존 UI 검증: `scripts/verify-meal-ui.mjs`, `scripts/verify-diary-ui.mjs`

## 3. 선생님 CMS에서 구현할 사용자 흐름

### 선생님

1. CMS 로그인
2. 자신의 담당 회원 목록 확인
3. 회원별 오늘 상태 확인
   - 최근 기록 시각
   - 오늘 기록 여부
   - 칼로리 합계
   - 탄수화물·단백질·지방
   - 미확인 영양정보
   - 회원이 남긴 하루 메모
4. 회원의 주간·월간 추이 확인
5. 식사 또는 날짜에 피드백 작성
6. 피드백 상태 확인: 보냄·읽음·답변 대기

### 회원

1. 회원 앱에서 자신의 기록 확인
2. 담당 선생님 피드백 확인
3. 읽음 처리
4. 필요하면 답변 작성
5. 담당 선생님 연결 해제 또는 데이터 공유 철회

기본 권한은 `선생님 → 배정된 회원만 읽기/피드백 작성`으로 한다. 모든 선생님이 모든 회원을 볼 수 있게 만들지 않는다.

## 4. 권장 데이터 모델

### identities

```json
{
  "memberId": "internal-member-id",
  "appUserId": "firebase-or-cms-user-id",
  "cmsMemberId": "cms-member-id",
  "teacherIds": ["teacher-id"],
  "shareNutritionWithTeacher": true,
  "sharePhotosWithTeacher": false,
  "createdAt": "2026-09-17T00:00:00Z",
  "updatedAt": "2026-09-17T00:00:00Z"
}
```

회원 이메일·전화번호를 식사 데이터의 연결 키로 사용하지 않는다. 내부 `memberId`를 사용하고, 매핑 테이블에서만 계정 간 관계를 관리한다.

### meal_summaries

CMS 기본 화면에는 요약만 전달한다.

```json
{
  "mealId": "meal-id",
  "memberId": "internal-member-id",
  "eatenAt": "2026-09-17T08:30:00+09:00",
  "mealType": "아침",
  "calories": 520,
  "carbG": 64,
  "proteinG": 28,
  "fatG": 16,
  "sugarG": 8,
  "sodiumMg": 640,
  "nutritionStatus": "COMPLETED",
  "missingNutrients": [],
  "summary": "현미밥, 계란, 샐러드",
  "source": "member_app",
  "updatedAt": "2026-09-17T08:35:00+09:00"
}
```

원본 사진, 상세 건강 상태, 질환 정보는 기본 `meal_summaries`에 넣지 않는다. 사진을 교사에게 보여주는 기능이 필요할 때 별도 동의, 보관기간, 삭제 정책을 먼저 정한다.

### daily_summaries

```json
{
  "memberId": "internal-member-id",
  "date": "2026-09-17",
  "recordedMealCount": 3,
  "dayCompleted": true,
  "calories": 1820,
  "carbG": 220,
  "proteinG": 102,
  "fatG": 58,
  "waterMl": 1500,
  "missingNutrition": false,
  "note": "운동 후 저녁 식사가 늦었어요.",
  "updatedAt": "2026-09-17T21:00:00+09:00"
}
```

하루 메모는 회원이 선생님과 공유하는 항목으로 별도 동의를 받는다. 비공개 개인 메모를 추가할 경우 `visibility: member_only`를 사용한다.

### feedback

```json
{
  "feedbackId": "feedback-id",
  "memberId": "internal-member-id",
  "teacherId": "teacher-id",
  "mealId": "meal-id-or-null",
  "date": "2026-09-17",
  "type": "NUTRITION_GUIDANCE",
  "message": "단백질 섭취는 좋아요. 다음에는 채소 한 가지를 더 추가해 보세요.",
  "visibility": "member_and_teacher",
  "status": "SENT",
  "createdAt": "2026-09-17T22:00:00+09:00",
  "readAt": null,
  "reply": null,
  "repliedAt": null
}
```

피드백 유형 예시:

- `NUTRITION_GUIDANCE`: 영양 습관 안내
- `MEAL_CHECK`: 특정 식사 확인
- `FOLLOW_UP`: 다음 상담 때 확인할 항목
- `ENCOURAGEMENT`: 격려
- `PRIVATE_NOTE`: 선생님 내부 메모. 회원에게 전송하지 않음

## 5. 권장 API 계약

CMS의 실제 API 문서를 받은 뒤 경로와 인증 방식만 맞춘다. 회원 앱에서 CMS DB를 직접 호출하지 않는다.

```text
GET  /api/member-link/me
GET  /api/teacher/members
GET  /api/teacher/members/:memberId/daily-summary?from=YYYY-MM-DD&to=YYYY-MM-DD
GET  /api/teacher/members/:memberId/meals?from=...&to=...
POST /api/teacher/members/:memberId/feedback
GET  /api/member/feedback?status=unread
POST /api/member/feedback/:feedbackId/read
POST /api/member/feedback/:feedbackId/reply
```

필수 요청 보안:

- CMS와 회원 앱 모두 HTTPS
- 선생님 API는 로그인 세션 또는 짧은 만료 토큰
- 서비스 간 동기화는 서버 환경변수의 비밀키로 처리
- 브라우저 번들에 CMS 비밀키를 넣지 않음
- `memberId`와 `teacherId`의 권한을 서버에서 매번 검증
- 모든 조회·피드백 작성에 감사 로그
- 중복 전송 방지를 위한 `idempotencyKey`

## 6. 인증·권한 구현 순서

1. CMS에서 회원·선생님 계정의 실제 ID 형식 확인
2. 회원 앱에 익명 로그인 대신 회원 계정 연결 추가
3. `memberId` 매핑 테이블 생성
4. CMS의 담당 선생님-회원 배정 데이터를 단일 권한 기준으로 사용
5. 회원 앱에는 자신의 데이터와 피드백만 반환
6. 선생님 CMS에는 배정된 회원만 반환
7. 관리자는 배정·동의·삭제 요청만 관리
8. 데이터 삭제와 공유 철회 API 구현

## 7. 개인정보와 운영 원칙

건강·질환 정보는 민감정보가 될 수 있으므로 수집 목적, 공유 대상, 보관기간, 철회 방법을 회원에게 명확히 표시한다. CMS가 외부 업체의 서비스라면 처리위탁 범위와 보호조치를 계약·처리방침에 반영한다.

초기 CMS에는 다음만 공유하는 것을 권장한다.

- 식사 시각과 식사 구분
- 칼로리 및 탄단지
- 누락·확인 필요 상태
- 회원이 공유에 동의한 하루 메모
- 선생님 피드백

처음부터 공유하지 않는 항목:

- 주민등록번호
- 결제정보
- 배송지
- 비밀번호
- 건강 상태 상세값과 진단명
- 원본 음식 사진

## 8. 구현하지 않은 부분과 작업 전 확인사항

현재 공개 CMS 주소만으로는 API, 인증, 데이터베이스 스키마, 담당 회원 권한을 알 수 없다. 다음 자료가 있어야 실제 연결 코드를 작성할 수 있다.

- CMS 소스 저장소 또는 API 문서
- 개발/스테이징 API 주소
- 인증 방식과 테스트 계정
- 회원·선생님·담당 배정 ID 필드
- `/schedule`에 영양 데이터 메뉴를 추가할 위치
- CMS가 피드백을 저장하는 방식
- 파일/사진 저장소 사용 여부
- 테스트 회원과 테스트 선생님

비밀키와 실제 회원 개인정보는 전달하지 않는다. 테스트용 가짜 계정과 가짜 기록으로 먼저 검증한다.

## 9. 인수인계용 Claude 작업 프롬프트

아래 내용을 새 Claude 세션에 붙여 넣고 이 파일을 함께 제공한다.

```text
이 저장소는 몸가짐 회원용 영양 기록 앱이다. 운영 URL은 https://momgagym-nutrition.pages.dev/#diary 이고, 연결 대상 CMS는 https://momgagym-cms2.pages.dev/schedule 이다.

먼저 docs/CLAUDE_HANDOFF.md와 docs/cms-integration-contract.md를 읽어라. CMS API 문서가 없으면 임의로 endpoint나 인증을 만들지 말고, 필요한 API 정보를 목록으로 정리한 뒤 멈춰라. 회원 개인정보나 비밀키를 요구하지 말고 테스트 계정만 사용하라.

목표는 다음과 같다.
1. 회원 앱의 meal_summaries와 daily_summaries를 CMS에서 담당 회원별로 조회한다.
2. 선생님은 배정된 회원만 본다.
3. 선생님이 특정 식사/날짜에 feedback을 작성한다.
4. 회원 앱이 feedback을 읽고 확인하고 답변한다.
5. 사진과 건강 상세정보는 별도 동의 없이 CMS로 보내지 않는다.

현재 앱은 React/Vite/Cloudflare Pages Functions이며, 식사 기록은 localStorage와 선택적 Firebase 익명 Auth/Firestore meals_history를 사용한다. 현재는 사람 계정, memberId 매핑, teacher 권한, 피드백 저장이 없다. 먼저 인증·회원 매핑·담당 권한을 설계하고, 실제 CMS API 계약을 확인한 뒤 최소 데이터 요약 연동을 구현하라. CMS DB에 브라우저가 직접 접근하지 않게 하라.

작업 전 계획과 API 매핑표를 먼저 출력하고, 구현 후 npm test와 npm run build를 실행하라. 운영 배포는 사용자가 명시적으로 요청하기 전까지 하지 마라.
```

## 10. 현재 검증 상태

- 이전 운영 검증에서 `npm test` 33개, `npm run build`, `npm run test:ui`, `npm run test:diary`가 통과했다.
- 운영 회원 앱의 모바일 달력·일기 화면 확인 완료
- 운영 `/api/nutrition-updates`: WHO/PubMed 응답 확인 완료
- 문서 추가 후 이 환경에서 재실행한 로컬 테스트·빌드는 esbuild의 상위 디렉터리 접근 오류로 중단되었다. 문서만 변경했으며 앱 코드는 변경하지 않았다.
- 몸가짐 CMS 연결: 미구현
