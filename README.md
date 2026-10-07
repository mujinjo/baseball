# 투타 대전 야구

투수 vs 타자 1:1 대전 웹 게임 (이후 Capacitor로 모바일 이식). 기획·로드맵은 [PLAN.md](PLAN.md) 참고.

## 구조
- `packages/core` — 순수 TypeScript 규칙 엔진 (카운트/아웃/이닝/점수, 타구 기반 자동 주루). UI 의존 없음
- `apps/web` — Vite + Phaser 3 클라이언트 (현재는 core 확인용 데모 화면)

## 명령어
```
npm install
npm run dev        # 개발 서버
npm test           # core 단위 테스트
npm run typecheck
npm run build
```

## 자동 주루
주루 조작은 없다. `core/src/autoRun.ts`가 타구(종류×질)와 주자/아웃 상황으로 결과를 판정하고,
확률은 `core/src/autoRun.json`에서 조정한다.
