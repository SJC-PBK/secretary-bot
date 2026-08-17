# 모듈: service-claude

버전: v1.0.0 · 상태: 가동·검증 · 레이어: service
담당 파일: `lib/claude.js`

## 역할
헤드리스 Claude(`claude -p`)를 자식 프로세스로 호출하는 래퍼. 질문답변·문서/메일 초안·리마인더 자연어 파싱에 쓰인다. **도구 미부여(순수 텍스트)** — 파일·명령 실행 도구를 주지 않는다(v1 보안 전제).

## 제공 인터페이스
- `ask(prompt, context) -> Promise<string>`: 대화 맥락을 포함해 답변 텍스트 반환
- `parseReminder(text, nowKST) -> Promise<{at, message} | null>`: 자연어를 절대시각(ISO, +09:00)과 메시지로 파싱. 실패 시 null

## 결정 지점 / 주의
- 호출 방식: `claude -p "<프롬프트>" --output-format text` + 도구 제한(허용 도구 없음). 정확한 플래그는 구현 시 확정하고 modules 갱신.
- `parseReminder`는 claude에게 "현재 KST 시각"을 함께 주고 JSON만 출력하도록 지시 → 파싱. 애매하면 null 반환(server-app이 되물음).
- 타임아웃·비정상 종료 처리(응답 없으면 사용자에게 "잠시 후 다시" 안내).
