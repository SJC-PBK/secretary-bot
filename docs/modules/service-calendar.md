# 모듈: service-calendar

버전: v1.1.0 · 상태: 가동·검증 · 레이어: service
담당 파일: `lib/calendar.js`

## 역할
구글 **Calendar API**로 각 사용자의 캘린더에 일정 등록·조회·수정·삭제(CRUD). 서비스계정(도메인 위임)으로 사용자 이메일을 impersonate 한다. 개인 캘린더(`primary`)와 센터 공유 캘린더(`SECBOT_SHARED_CALENDAR_ID`) 모두 지원.

## 인증
- 서비스계정 키(`SA_KEY`, 기본 `./service-account.json`) + 도메인 전체 위임.
- scope: `https://www.googleapis.com/auth/calendar`, `subject`=대상 사용자 이메일.

## 제공 인터페이스 (lib/calendar.js)
- `configured() -> bool` (서비스계정 키 존재 여부)
- `createEvent({userEmail, title, startISO, endISO?, calendarId?}) -> {ok, event?, error?}`
- `listEvents({userEmail, fromISO, toISO, calendarId?}) -> {ok, events?, error?}`
- `updateEvent({userEmail, eventId, title?, startISO?, endISO?, calendarId?}) -> {ok, error?}`
- `deleteEvent({userEmail, eventId, calendarId?}) -> {ok, error?}`
- `calendarId` 미지정 시 `primary`(개인). 공유 캘린더는 `SECBOT_SHARED_CALENDAR_ID`.

## 주의
- 사용자 이메일은 등록부(users.json) 기준. 위임 대상은 같은 워크스페이스 도메인이어야 함.
- 삭제/수정 대상 특정: 직전 목록(session)의 번호 또는 query(기간) 검색.
- 서비스계정 키·API 활성화·도메인 위임 스코프 설정: `docs/gcp-service-account-setup.md`.
