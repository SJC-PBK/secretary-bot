# 모듈: service-profile (v2 — 장기기억/성장)

버전: v1.0.0 · 상태: 가동·검증 · 레이어: service
담당 파일: `lib/profile.js` (+ 보조 `lib/session.js`)

## 역할
사용자에 대한 사실·취향을 **지속 저장**하고 매 응답에 반영해, 쓸수록 잘 보좌하게 함(F: 지속프로필·자동축적·명시기억·투명통제). 저장: `${DATA_DIR}/profile-${userId}.json` = `[{id,text,source,at}]`.

## 제공 인터페이스 (lib/profile.js)
- `load(userId) -> [{id,text,source,at}]`
- `facts(userId) -> [text,...]` (claude 프롬프트 주입용)
- `add(userId, text, source) -> fact|null` (완전 동일 중복이면 null, 200개 초과 시 오래된 것부터 제거)
- `list(userId) -> [...]` · `forget(userId, id) -> bool`

## 연결 (claude.js·app.js)
- `claude.ask(text, ctx, facts)`: facts를 시스템 프롬프트에 주입 → 개인화 응답.
- `claude.extractFacts(userText, answer, existing)`: 대화에서 장기 기억감 사실만 추출(최대 3). app.js가 **응답 전송 뒤 백그라운드로** 호출해 auto로 축적(응답 지연 없음).
- 명시 기억: "기억해둬" → memory_remember → add(explicit). 투명·통제: "내 기억 보여줘"/"그거 잊어".

## 보조: lib/session.js
"2번 삭제" 같은 번호 지목을 위해 직전에 보여준 목록을 저장. `setLast(userId,kind,items)` / `getLast(userId)`.

## 주의 (개인정보)
- 저장 데이터가 늘어남 → 본인 서버·본인만 접근 유지. 사용자가 언제든 보고(show) 지울(forget) 수 있게 설계.
- RAG(과거 전체 검색)는 v3 보류.
