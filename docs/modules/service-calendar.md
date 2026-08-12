# 모듈: service-calendar (v2)

버전: v0.9.0 · 상태: 코드완료(런타임 미검증) · 레이어: service
담당 파일: `lib/calendar.js` (봇측) + `gas/Code.gs` (사장님 배포분, GAS)

## 역할
봇이 GAS 웹앱을 POST 호출해 **내 기본 구글 캘린더**에 일정 등록·조회·수정·삭제(F). 봇은 구글 자격증명 미보유 — `GAS_WEBHOOK_URL` + `GAS_SHARED_SECRET`(비밀토큰)만 사용.

## 제공 인터페이스 (lib/calendar.js)
- `configured() -> bool` (GAS_WEBHOOK_URL 유무)
- `createEvent({title, startISO, endISO}) -> {ok, event?, error?}`
- `listEvents({fromISO, toISO}) -> {ok, events?, error?}`
- `updateEvent({eventId, title, startISO, endISO}) -> {ok, error?}`
- `deleteEvent({eventId}) -> {ok, error?}`
- 내부 post(): 미설정 시 `{ok:false,error:'not_configured'}`, 20초 타임아웃, 네트워크/파싱 오류 캐치.

## GAS 응답 계약 (Code.gs ↔ app.js 정렬)
- create/update: `{ok:true, event:{id,title,start(ISO),end(ISO)}}`
- list: `{ok:true, events:[{id,title,start,end}]}`
- delete: `{ok:true}` / 실패 공통 `{ok:false, error}`

## 주의
- 배포·설정: docs/gas-calendar-setup.md
- ⚠️ GAS 웹앱 배포·`.env`의 두 값 설정 전에는 캘린더 기능 비활성(봇이 안내). 나머지 기능은 정상.
- 삭제/수정 대상 특정: 직전 목록(session)의 번호 또는 query(이번 주 범위) 검색.
