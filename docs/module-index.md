# 모듈 인덱스 — secretary-bot

버전 기준: 각 모듈 .md가 진실, 이 인덱스는 거울. 어긋나면 .md 기준 보정.
목적·기능 구성: → docs/plan.md (링크, 중복 금지)

## 모듈 목록

| 모듈 | 레이어 | 담당 파일 | 버전 | 상태 | 역할 |
|------|--------|----------|------|------|------|
| server-app | server | app.js, lib/auth.js | v1.0.0 | 가동·검증(2026-08-13) | Bolt Socket Mode 진입, DM 이벤트 라우팅, 접근 통제, 응답 발송 |
| service-claude | service | lib/claude.js | v1.0.0 | 가동·검증(2026-08-13) | 헤드리스 Claude(`claude -p`) 호출 래퍼 — 질문답변·초안·리마인더 파싱 (도구 미부여) |
| service-reminder | service | lib/reminders.js, lib/scheduler.js | v1.0.0 | 가동·검증(2026-08-13) | 리마인더 등록·조회·취소(저장) + 도래 시각 발송 스케줄 |
| service-memory | service | lib/memory.js | v1.0.0 | 가동·검증(2026-08-13) | 사용자별 대화 맥락 저장·로드 |
| service-calendar | service | lib/calendar.js | v1.1.0 | 가동·검증 | Calendar API(서비스계정 위임)로 개인·공유 캘린더 등록·조회·수정·삭제 |
| service-profile (v2) | service | lib/profile.js + lib/session.js | v1.0.0 | 가동·검증(2026-08-13) | 장기기억(지속 프로필·자동축적·명시기억·통제) |

> v1.0.0 확정 조건: T014 서버 실동작 테스트(Slack 왕복·리마인더 1건 도착) 통과.
> v2 모듈 v1.0.0 확정 조건: GAS 웹앱 배포 + 서버 반영 후 캘린더 CRUD·장기기억 실동작 확인.
> v2 의도 라우팅은 `lib/claude.js`의 `interpret()`(claude 1회 분류+추출)가 담당 — app.js가 그 결과로 분기.

## 레이어 간 연결점 (인터페이스로만 — 직접 의존 금지)

- server-app → service-claude: `ask(prompt, context)` / `parseReminder(text)` 호출, 문자열·객체 반환
- server-app → service-memory: `load(userId)` / `append(userId, role, text)`
- server-app → service-reminder: `add({userId,at,message})` / `list(userId)` / `cancel(userId,id)`
- service-reminder(scheduler) → server-app: 도래 리마인더를 콜백으로 넘겨 DM 발송 (app이 slack client 소유)

## 데이터 흐름·경계 변환

→ docs/flow.md (⚠️ 경계 변환 지점 포함)
