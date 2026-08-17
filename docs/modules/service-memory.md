# 모듈: service-memory

버전: v1.0.0 · 상태: 가동·검증 · 레이어: service
담당 파일: `lib/memory.js`

## 역할
사용자별 대화 맥락을 저장·로드해 "이어지는 질문"을 이해하게 한다(F006). 파일 기반(`data/memory-{userId}.json` 또는 단일 파일).

## 제공 인터페이스
- `load(userId) -> {role, text}[]`: 최근 N개(예: 최근 12개) 반환
- `append(userId, role, text)`: 메시지 추가, 상한 초과 시 오래된 것부터 버림

## 결정 지점 / 주의
- 맥락 상한(N)으로 프롬프트 길이·토큰 관리. 기본 최근 12개.
- 개인 봇이라 사용자 1명이지만 userId 키로 일반화(확장 여지).
