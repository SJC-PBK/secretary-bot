# 복구 절차 (재부팅·정전 대비)

두 대가 서로 **독립**이다. 각각 복구법이 다르다.

- **서버(scv, 192.168.x.x)** = 봇 본체가 도는 곳. 여기가 죽으면 봇이 멈춘다.
- **이 Windows PC** = 개발·폰 제어(remote-control)용. 여기가 죽어도 **봇은 계속 돈다**(서버에 있으므로).

---

## A. 서버(scv) 재부팅/정전 후 — 봇 자체 복구

**대부분 자동이다.** `secretary-bot.service`가 systemd에 **enabled** 등록돼 있어 부팅 시 자동 기동하고, 토큰은 `.env`(EnvironmentFile)에 있어 유지된다.

**확인(재부팅 후 1분 내):**
```
ssh pbk@192.168.x.x
sudo systemctl status secretary-bot      # active (running) 이어야 함
sudo journalctl -u secretary-bot -n 15   # "Now connected to Slack" 확인
```
그다음 슬랙에서 봇에 DM 한 번 → 응답 오면 정상.

**안 뜨면:**
```
sudo systemctl restart secretary-bot
sudo journalctl -u secretary-bot -n 30   # 오류 메시지 확인
```

**⚠️ 정전 주의(미해결 리스크):** 서버가 **물리적으로 다시 켜져야** 자동복구가 의미 있다. BIOS 전원복구(AC 복전 시 자동 부팅) 설정이 안 돼 있으면 정전 후 수동으로 전원을 눌러야 한다. → **BIOS에서 "Restore on AC Power Loss = Power On" 설정 확인 필요**(CC봇과 공통 미완 항목).

**claude 인증:** 서버 두뇌는 `CLAUDE_CODE_OAUTH_TOKEN`(claudebot 구독, `.env`)으로 인증 — 재부팅해도 유지. 단 이 토큰은 **1년 유효**(setup-token) → 만료 시 `sudo -u claudebot claude setup-token`으로 재발급 후 `.env` 갱신.

> 현재 서버엔 **v1이 배포돼 있음**. v2(캘린더·장기기억) 반영은 아직 — 반영해도 복구 절차는 동일(systemd).

---

## B. 이 Windows PC 재부팅 후 — 폰 remote-control 복구

**봇에는 영향 없음**(서버에서 계속 돎). 죽는 건 PC의 Claude 세션(폰 제어 연결)뿐.

**복구 순서:**
1. Windows 로그인(계정 로그인 상태여야 세션·claude 인증 유지).
2. 터미널(PowerShell) 열기 — 기본 폴더 `C:\Users\jobcnt`.
3. **`.\rc`** 입력 → Enter. (= `claude --continue --remote-control` — 가장 최근 작업 대화를 remote-control로 복구)
4. 폰 **Claude 앱 → Code**에서 그 세션에 연결.

**`.\rc`가 엉뚱한 대화를 열면:** 아래로 목록에서 직접 고르기(방향키 사용, 마우스 불필요):
```
claude --resume --remote-control
```
→ 목록에서 **가장 최근/작업 내용이 맞는 것** 선택.

**절전 주의:** PC가 슬립/절전 들어가면 세션·폰 연결이 끊긴다 → 전원 옵션에서 **절전 해제**(항상 켜짐) 권장.

---

## C. 최후의 복구 (세션을 못 찾거나 다 꼬였을 때) — 항상 통함

프로젝트 상태가 **문서와 git에 전부 박제**돼 있어, 세션 없이도 처음부터 이어갈 수 있다.
1. `C:\Users\jobcnt\secretary-bot` 폴더에서 그냥 `claude` 실행(원하면 `--remote-control`).
2. Claude에게: **"docs/state.json 과 docs/handover-morning.md 읽고 이어서 진행해줘"**
   → 코드·서버 상태·다음 할 일 전체 맥락 복구.
3. 코드 백업: 로컬 git 커밋(`06114cc`, branch main). (GitHub 미푸시 — 필요 시 저장소 만들어 push)

---

## 한 장 요약

| 죽은 것 | 봇 영향 | 복구 |
|---|---|---|
| 서버(scv) 재부팅 | 봇 멈춤 | systemd 자동 기동. `systemctl status`로 확인. 정전 시 전원/BIOS 확인 |
| 이 PC 재부팅 | 없음 | 로그인 → `.\rc` → 폰 앱 연결 |
| 세션 다 꼬임 | 없음 | secretary-bot 폴더서 `claude` → "docs 읽고 이어가줘" |
