# CMS 연동 계약 초안

이 문서는 몸가짐 회원용 영양 앱과 몸가짐 CMS 사이의 최소 데이터 계약이다. 실제 CMS API 문서가 도착하면 이 초안을 기준으로 경로, 인증 헤더, ID 필드 이름을 확정한다.

## 서비스 경계

회원 앱은 식사 입력과 회원용 기록을 담당한다. CMS는 담당 회원 관리, 선생님 조회, 피드백 작성을 담당한다. 회원 앱의 브라우저가 CMS 데이터베이스에 직접 접근하지 않는다.

## 데이터 방향

```text
회원 앱 → 운영 API → CMS: 식사·하루 요약 업서트
CMS → 운영 API → 회원 앱: 선생님 피드백 조회
회원 앱 → 운영 API → CMS: 피드백 읽음·답변
```

## 요약 업서트

`PUT /api/integrations/momgagym-cms/members/{memberId}/daily-summaries/{date}`

```json
{
  "memberId": "member_123",
  "date": "2026-09-17",
  "recordedMealCount": 3,
  "dayCompleted": true,
  "totals": {
    "calories": 1820,
    "carbG": 220,
    "proteinG": 102,
    "fatG": 58,
    "sugarG": 32,
    "sodiumMg": 2100,
    "waterMl": 1500
  },
  "missingNutrition": false,
  "memberNote": "운동 후 저녁이 늦었어요.",
  "memberNoteShared": true,
  "sourceUpdatedAt": "2026-09-17T21:00:00+09:00"
}
```

헤더:

```text
Authorization: Bearer <server-only-secret>
Idempotency-Key: daily-summary-member_123-2026-09-17-v1
```

## 피드백 생성

`POST /api/integrations/momgagym-cms/feedback`

```json
{
  "feedbackId": "feedback_123",
  "memberId": "member_123",
  "teacherId": "teacher_456",
  "date": "2026-09-17",
  "mealId": null,
  "type": "NUTRITION_GUIDANCE",
  "message": "다음 식사에 채소 한 가지를 더 추가해 보세요.",
  "visibility": "member_and_teacher",
  "createdAt": "2026-09-17T22:00:00+09:00"
}
```

## 회원 앱 피드백 조회

`GET /api/member/feedback?status=unread&cursor=...`

반환 필드는 `feedbackId`, `date`, `mealId`, `teacherDisplayName`, `type`, `message`, `status`, `createdAt`, `readAt`, `reply`, `repliedAt`로 제한한다. 선생님의 내부 메모는 반환하지 않는다.

## 권한 규칙

- `memberId`는 로그인한 회원의 계정과 서버에서 대조한다.
- `teacherId`는 CMS 세션의 담당자와 서버에서 대조한다.
- 선생님은 배정 테이블에 있는 회원만 조회한다.
- 회원은 자기 피드백만 읽고 답한다.
- 관리자만 담당 배정, 동의 상태, 삭제 요청을 바꾼다.
- 요약 업서트는 멱등적으로 처리한다.
- 모든 읽기·쓰기 요청은 감사 로그를 남긴다.

## 오류 규격

```json
{
  "code": "MEMBER_NOT_ASSIGNED",
  "message": "이 회원은 현재 선생님에게 배정되어 있지 않습니다.",
  "requestId": "req_123"
}
```

권장 코드: `UNAUTHENTICATED`, `FORBIDDEN`, `MEMBER_NOT_FOUND`, `MEMBER_NOT_ASSIGNED`, `CONSENT_REQUIRED`, `DUPLICATE_REQUEST`, `VALIDATION_ERROR`, `UPSTREAM_UNAVAILABLE`.

## 실제 연동 전 결정할 항목

1. CMS가 API를 제공하는가, 아니면 CMS 자체 데이터베이스에 직접 연결해야 하는가
2. CMS 로그인과 회원 앱 로그인은 같은 계정 시스템인가
3. CMS의 회원 ID와 앱의 내부 ID를 어느 쪽에서 매핑하는가
4. 담당 선생님 배정의 기준 테이블은 무엇인가
5. 피드백 알림을 CMS 알림, 앱 알림, 이메일 중 어디로 보낼 것인가
6. 원본 사진을 선생님에게 보여줄 것인가
7. 데이터 보존기간과 회원 탈퇴 시 삭제 범위
