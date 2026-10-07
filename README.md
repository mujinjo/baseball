# 투타 대전 야구

투수 vs 타자 1:1 대전 웹 게임 (이후 Capacitor로 모바일 이식). 기획·로드맵은 [PLAN.md](PLAN.md) 참고.

## 구조
- `packages/core` — 순수 TypeScript 규칙 엔진 (카운트/아웃/이닝/점수, 타구 기반 자동 주루). UI 의존 없음
- `apps/web` — Vite + Phaser 3 클라이언트 (M3: 포수 시점 2인 핫시트 대전 화면)

## 명령어
```
npm install
npm run dev        # 개발 서버
npm test           # core 단위 테스트
npm run typecheck
npm run build
npm run simulate -w @baseball/core   # 밸런스 시뮬레이션 리포트
```

## 자동 주루
주루 조작은 없다. `core/src/autoRun.ts`가 타구(종류×질)와 주자/아웃 상황으로 결과를 판정하고,
확률은 `core/src/autoRun.json`에서 조정한다.

## 투구 판정 (M2)
`core/src/pitch.ts`의 `resolvePitch(투구, 타자행동, 투수능력, 타자능력, rng)`가 한 투구를 `PitchEvent`로 바꾼다.
- 투수: 구종 + 노리는 위치(존 중심 (0,0), 경계 ±1) + 제구 게이지 → 실제 위치 = 목표 + 오차
- 타자: 스윙 여부 + 타이밍 오차(ms) + 선택적 구종/코스 예측 (맞추면 유리, 틀리면 불리)
- 결과: 볼/스트라이크/헛스윙/파울/인플레이(타구 종류·질) → M1 상태머신에 입력
- 수치는 `pitch.json`에서 조정하고 `npm run simulate`로 타율·삼진율·볼넷율을 확인한다

## 플레이 방법 (M3, 한 기기 2인 대전)
1. 투수: 구종 → 코스(5×5 격자, 안쪽 9칸이 스트라이크) → 제구 게이지를 가운데에서 멈추기
2. 기기를 타자에게 넘김 → 타자는 구종/코스를 예측(선택)하고 `타격 준비!`
3. 공이 날아오면 도착하는 순간에 화면을 터치해 스윙 (안 누르면 스윙 안 함)
4. 결과·주루는 core가 자동 판정. 투구마다 투수/타자 교대로 기기를 넘긴다
