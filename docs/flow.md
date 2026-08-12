# 구동흐름도 — secretary-bot

목적·모듈 구성: → docs/plan.md / docs/module-index.md (링크, 중복 금지)
흐름만 기술. 모듈 내부는 각 modules/*.md에 위임.

## 시나리오 1: 질문답변 / 문서·메일 초안 (F002·F003)
사용자 DM "이번 공문 초안 써줘" → [server-app] message.im 수신
  → [server-app/auth] 허용 Slack ID 확인 (아니면 무시)
  → [service-memory] load(userId): 최근 대화 맥락 불러옴
  → [service-claude] ask(prompt, context): `claude -p` 호출 ⚠️{맥락을 프롬프트 문자열로 직렬화 — 역할·순서 유지}
  → [server-app] 응답을 DM으로 전송
  → [service-memory] append(userId, 'user'/'assistant', text): 맥락 저장
경계 점검: ⚠️ 대화 맥락 직렬화 형식(누가 무슨 말 했는지)이 claude 프롬프트에서 헷갈리지 않게 고정.

## 시나리오 2: 리마인더 등록 (F004)
사용자 DM "내일 오후 2시 회의 알려줘" → [server-app] 수신·auth
  → [service-claude] parseReminder(text): 자연어 → {at: ISO문자열, message} ⚠️{시간대 = Asia/Seoul 고정, 상대표현("내일")을 절대시각으로}
  → 파싱 실패/모호 시 [server-app]가 사용자에게 되물음 (추측 저장 금지)
  → [service-reminder] add({userId, at, message}): data/reminders.json 저장
  → [server-app] "○월 ○일 오후 2시에 알려드릴게요" 확인 DM
경계 점검: ⚠️ "내일"·"오후 2시"의 기준 시각·시간대. 현재시각도 KST로 넘겨 파싱.

## 시나리오 3: 리마인더 발송 (F005)
[service-reminder/scheduler] 주기 검사(예: 30초마다) → at ≤ 현재시각(KST)인 항목 추출 ⚠️{시각 비교는 동일 기준(UTC epoch)으로}
  → 콜백으로 [server-app]에 넘김 → chat DM 발송 → 해당 항목 sent 표시(재발송 방지)
경계 점검: ⚠️ 저장은 ISO(+09:00 포함), 비교는 epoch(ms)로 통일.

## 시나리오 4: 리마인더 조회·취소 (F008)
사용자 DM "내 리마인더" → [server-app] → [service-reminder] list(userId) → 목록 DM(번호 붙임)
사용자 DM "2번 취소" / "그거 취소" → [server-app] → [service-reminder] cancel(userId, id) → 결과 DM
경계 점검: 목록의 번호 ↔ 저장 id 매핑을 사용자에게 보이는 번호로 안정적으로.
