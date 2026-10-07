import { describe, expect, it } from 'vitest';
import {
  AI_LEVELS,
  AI_PROFILES,
  AVERAGE_BATTER,
  AVERAGE_PITCHER,
  PITCH_TYPES,
  aiBatterAction,
  aiChoosePitch,
  aiGauge,
  applyPitch,
  createRng,
  decideSwing,
  isInZone,
  newGame,
  resolvePitch,
  type AiLevel,
  type CountContext,
  type PastPitch,
} from '../src';

const ctx = (balls: number, strikes: number): CountContext => ({
  balls,
  strikes,
  outs: 0,
  bases: [false, false, false],
});

describe('컴퓨터 투수', () => {
  const zoneShare = (c: CountContext, level: AiLevel, n = 3000) => {
    const rng = createRng(5);
    let inZone = 0;
    for (let i = 0; i < n; i++) if (isInZone(aiChoosePitch(c, [], level, rng).target)) inZone++;
    return inZone / n;
  };

  it('볼카운트가 불리하면 스트라이크를, 유리하면 유인구를 더 던진다', () => {
    const behind = zoneShare(ctx(3, 0), 'hard');
    const even = zoneShare(ctx(1, 1), 'hard');
    const ahead = zoneShare(ctx(0, 2), 'hard');
    expect(behind).toBeGreaterThan(even);
    expect(even).toBeGreaterThan(ahead);
    expect(behind).toBeGreaterThan(0.85);
    expect(ahead).toBeLessThan(0.45);
  });

  it('쉬움은 카운트를 덜 읽는다', () => {
    const easy = zoneShare(ctx(0, 2), 'easy');
    const hard = zoneShare(ctx(0, 2), 'hard');
    expect(easy).toBeGreaterThan(hard);
  });

  it('항상 유효한 구종과 격자 코스를 고른다', () => {
    const rng = createRng(2);
    for (let i = 0; i < 500; i++) {
      const p = aiChoosePitch(ctx(i % 4, i % 3), [], AI_LEVELS[i % 3]!, rng);
      expect(PITCH_TYPES).toContain(p.pitchType);
      expect(Math.abs(p.target.x)).toBeLessThanOrEqual(1.35);
      expect(Math.abs(p.target.y)).toBeLessThanOrEqual(1.35);
    }
  });

  it('직전과 같은 구종을 연달아 던지는 빈도가 무작위(25%)보다 낮다', () => {
    const rng = createRng(3);
    const last: PastPitch = { pitchType: 'fastball', target: { x: 0, y: 0 } };
    let same = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) if (aiChoosePitch(ctx(1, 1), [last], 'hard', rng).pitchType === 'fastball') same++;
    expect(same / n).toBeLessThan(0.2);
  });

  it('어려울수록 제구 게이지가 정확하다', () => {
    const avg = (l: AiLevel) => {
      const rng = createRng(9);
      let sum = 0;
      for (let i = 0; i < 2000; i++) sum += aiGauge(l, rng);
      return sum / 2000;
    };
    expect(avg('hard')).toBeGreaterThan(avg('normal'));
    expect(avg('normal')).toBeGreaterThan(avg('easy'));
  });
});

describe('컴퓨터 타자', () => {
  it('존 한가운데는 대체로 휘두르고, 한참 벗어난 공은 거의 거른다', () => {
    const rng = createRng(4);
    let mid = 0;
    let wild = 0;
    for (let i = 0; i < 2000; i++) {
      if (aiBatterAction({ x: 0, y: 0 }, 0, 'normal', rng).swing) mid++;
      if (aiBatterAction({ x: 1.6, y: 1.6 }, 0, 'normal', rng).swing) wild++;
    }
    expect(mid / 2000).toBeGreaterThan(0.5);
    expect(wild / 2000).toBeLessThan(0.05);
  });

  it('2스트라이크에서는 존 안 공을 반드시 휘두른다', () => {
    const rng = createRng(1);
    for (let i = 0; i < 200; i++) {
      expect(decideSwing({ x: 0.2, y: 0.2 }, 2, { takeRate: 1, chaseRate: 0 }, rng)).toBe(true);
    }
  });

  it('어려울수록 타이밍 오차가 작다', () => {
    const spread = (l: AiLevel) => {
      const rng = createRng(6);
      let sum = 0;
      let n = 0;
      while (n < 2000) {
        const a = aiBatterAction({ x: 0, y: 0 }, 2, l, rng);
        if (a.swing) {
          sum += Math.abs(a.timingMs);
          n++;
        }
      }
      return sum / n;
    };
    expect(spread('hard')).toBeLessThan(spread('normal'));
    expect(spread('normal')).toBeLessThan(spread('easy'));
    expect(AI_PROFILES.hard.timingSigmaMs).toBeLessThan(AI_PROFILES.easy.timingSigmaMs);
  });
});

describe('컴퓨터 vs 컴퓨터 경기', () => {
  /** 한 타석을 AI 투수/AI 타자로 끝까지 진행 */
  function playGame(pitchLevel: AiLevel, batLevel: AiLevel, seed: number) {
    const rng = createRng(seed);
    let s = newGame({ innings: 3, maxExtraInnings: 1 });
    const history: PastPitch[] = [];
    let pitches = 0;
    let hits = 0;
    let pa = 0;
    while (s.status === 'playing') {
      const choice = aiChoosePitch(s, history, pitchLevel, rng);
      history.push(choice);
      const pitch = { ...choice, gauge: aiGauge(pitchLevel, rng) };
      // 실제 위치를 먼저 정해 타자가 볼 수 있게 한다
      const probe = resolvePitch(pitch, { swing: false, timingMs: 0 }, AVERAGE_PITCHER, AVERAGE_BATTER, rng);
      const action = aiBatterAction(probe.actual, s.strikes, batLevel, rng);
      const detail = resolvePitch(pitch, action, AVERAGE_PITCHER, AVERAGE_BATTER, rng, undefined, probe.actual);
      const out = applyPitch(s, detail.event, rng);
      s = out.state;
      pitches++;
      if (out.result) {
        pa++;
        if (['single', 'double', 'triple', 'homeRun'].includes(out.result)) hits++;
      }
      if (pitches > 5000) throw new Error('경기가 끝나지 않음');
    }
    return { s, pitches, hits, pa };
  }

  it('여러 경기가 정상 종료되고 득점이 야구답다', () => {
    let runs = 0;
    let hits = 0;
    let pa = 0;
    const games = 60;
    for (let g = 0; g < games; g++) {
      const r = playGame('normal', 'normal', 100 + g);
      expect(r.s.winner).not.toBeNull();
      runs += r.s.score.away + r.s.score.home;
      hits += r.hits;
      pa += r.pa;
    }
    const perGame = runs / games; // 3이닝 양 팀 합계
    expect(perGame).toBeGreaterThan(0.5);
    expect(perGame).toBeLessThan(9);
    expect(hits / pa).toBeGreaterThan(0.15);
    expect(hits / pa).toBeLessThan(0.4);
  });

  it('어려운 투수가 쉬운 투수보다 실점이 적다', () => {
    const total = (pl: AiLevel) => {
      let runs = 0;
      for (let g = 0; g < 80; g++) {
        const r = playGame(pl, 'normal', 500 + g);
        runs += r.s.score.away + r.s.score.home;
      }
      return runs;
    };
    expect(total('hard')).toBeLessThan(total('easy'));
  });
});
