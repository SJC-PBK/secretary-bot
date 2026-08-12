# 오류리포트 — secretary-bot

## ER-001 — Windows에서 헤드리스 Claude 호출 실패
- 모듈: service-claude (lib/claude.js)
- 발견일: 2026-08-13 (로컬 스모크 테스트 중)
- 증상: 봇이 질문에 실제 답변 대신 "지금 답변 생성에 문제가 있어요. 잠시 후 다시…" 대체 메시지만 반환.
- 재현 조건: Windows에서 `node --env-file=.env app.js` 실행 → 슬랙 DM으로 질문.
- 원인: `spawn('claude', args)`가 Windows에서 ENOENT. `claude`가 `.cmd`/스크립트 래퍼라 `shell` 없이 실행 불가(Node 18.20+/20.12+ 보안 정책). 코드의 `child.on('error')` 안전장치가 이를 잡아 null→대체 메시지로 흐름(그래서 크래시는 안 남).
- 진단 근거: `claude -p --output-format text`를 셸에서 stdin으로 직접 호출하면 정상(exit 0). 즉 인증·플래그·CLI는 정상이고 spawn 방식만 문제.
- 조치: `spawn(bin, args, { ..., shell: process.platform === 'win32' })` — Windows에서만 shell:true.
- 검증: 수정 후 재실행 → 슬랙 DM 질문에 실제 답변 도착 확인(사용자 육안).
- 재발 방지: 리눅스 서버(scv)에선 `claude`가 일반 실행파일이라 shell:false 유지로 기존 동작 그대로. 크로스플랫폼 spawn으로 양쪽 모두 커버.
- 상태: 완치 ✅
