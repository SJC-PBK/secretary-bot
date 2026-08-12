# 모듈: server-app

버전: v0.9.0 · 상태: 코드완료(런타임 미검증) · 레이어: server
담당 파일: `app.js`, `lib/auth.js`

## 역할
Slack Bolt(Socket Mode) 진입점. DM(message.im) 이벤트를 받아 접근 통제 → 의도 분기(질문/초안/리마인더 등록/조회/취소) → 해당 서비스 호출 → 응답 DM 발송. 리마인더 스케줄러의 도래 콜백을 받아 DM으로 보낸다.

## 외부 연결 인터페이스 (호출하는 쪽)
- service-claude: `ask(prompt, context)`, `parseReminder(text, nowKST)`
- service-memory: `load(userId)`, `append(userId, role, text)`
- service-reminder: `add(...)`, `list(userId)`, `cancel(userId, id)`, `startScheduler(onDue)`

## 제공 인터페이스
- `onDue(reminder)` 콜백: scheduler가 도래 항목을 넘기면 `client.chat.postMessage`로 DM 발송

## 결정 지점 / 주의
- 의도 분기는 간단한 규칙(키워드) + 애매하면 claude에 위임 가능. v1은 최소 규칙으로.
- 접근 통제(auth): `ALLOWED_SLACK_USER_ID` 외 요청은 조용히 무시.
