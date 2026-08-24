# secretary-bot — 프로젝트 지침

슬랙 DM으로 소통하는 개인 비서 봇. 상세 기획은 `docs/plan.md`, 요구원장은 `docs/requirements.md`, 진행 상태는 `docs/state.json` 참조.

## 프로젝트 요약
- 뼈대: Node.js + Slack Bolt (Socket Mode)
- 두뇌: 헤드리스 Claude (`claude -p`) — v1은 파일·명령 도구 미부여(순수 텍스트)
- 저장: 파일 기반 JSON (`data/`)
- 배포: 사무실 서버 scv(192.168.x.x) systemd `secretary-bot.service`
- 보안: 허용된 Slack ID만 응답, 외부 데이터 접근 없음

---

## LLM 행동 규칙 (원문 무결 수록 — 충돌 시 이 원문이 기준)

```
Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.
Tradeoff: These guidelines bias toward caution over speed. For trivial tasks, use judgment.

1. Think Before Coding
Don't assume. Don't hide confusion. Surface tradeoffs.
Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

2. Simplicity First
Minimum code that solves the problem. Nothing speculative.
* No features beyond what was asked.
* No abstractions for single-use code.
* No "flexibility" or "configurability" that wasn't requested.
* No error handling for impossible scenarios.
* If you write 200 lines and it could be 50, rewrite it.
Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

3. Surgical Changes
Touch only what you must. Clean up only your own mess.
When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.
When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.
The test: Every changed line should trace directly to the user's request.

4. Goal-Driven Execution
Define success criteria. Loop until verified.
Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"
For multi-step tasks, state a brief plan:
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

These guidelines are working if: fewer unnecessary changes in diffs, fewer rewrites due to overcomplication,
and clarifying questions come before implementation rather than after mistakes.
```
