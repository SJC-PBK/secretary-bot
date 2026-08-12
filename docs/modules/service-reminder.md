# 모듈: service-reminder

버전: v0.9.0 · 상태: 코드완료(런타임 미검증) · 레이어: service
담당 파일: `lib/reminders.js`, `lib/scheduler.js`

## 역할
리마인더의 저장(등록·조회·취소)과 도래 시각 발송 스케줄. 저장은 `data/reminders.json` 파일 기반.

## 제공 인터페이스 (reminders.js)
- `add({userId, at, message}) -> reminder`: at은 ISO(+09:00). id 부여, 저장
- `list(userId) -> reminder[]`: 미발송(pending) 항목만, at 오름차순
- `cancel(userId, id) -> boolean`
- 내부: `due(nowMs) -> reminder[]`, `markSent(id)`

## 제공 인터페이스 (scheduler.js)
- `startScheduler(onDue)`: 주기(예: 30초)로 `due()` 검사 → 각 항목 onDue(reminder) 호출 후 markSent

## 결정 지점 / 주의
- 시각 비교는 epoch(ms) 통일 ⚠️(저장 ISO → Date 파싱 → getTime).
- 재발송 방지: 발송 성공 시 sent=true.
- 파일 동시쓰기 단순화: 단일 프로세스라 순차 저장으로 충분(락 불필요).
