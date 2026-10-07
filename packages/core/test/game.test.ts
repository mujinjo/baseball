import { describe, expect, it } from 'vitest';
import {
  applyPitch,
  createRng,
  newGame,
  DEFAULT_AUTO_RUN_PARAMS,
  type AutoRunParams,
  type Bases,
  type BattedBallKind,
  type BattedBallQuality,
  type GameState,
  type HitOrOut,
  type PitchEvent,
} from '../src';

/** 정해진 값을 순서대로 돌려주는 난수 (다 쓰면 마지막 값 반복) */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
};

/** 특정 결과만 나오도록 가중치를 고정한 파라미터 */
const forced = (outcome: HitOrOut, overrides: Partial<AutoRunParams> = {}): AutoRunParams => {
  const only = { [outcome]: 1 } as Partial<Record<HitOrOut, number>>;
  const kinds: BattedBallKind[] = ['ground', 'line', 'fly', 'popup'];
  const quals: BattedBallQuality[] = ['weak', 'normal', 'hard'];
  const batted = {} as AutoRunParams['batted'];
  for (const k of kinds) {
    batted[k] = {} as AutoRunParams['batted'][typeof k];
    for (const q of quals) batted[k][q] = only;
  }
  return { ...DEFAULT_AUTO_RUN_PARAMS, batted, ...overrides };
};

const state = (patch: Partial<GameState> = {}): GameState => ({ ...newGame(), ...patch });
const play = (s: GameState, e: PitchEvent, rng = seq(0.5), p?: AutoRunParams) =>
  applyPitch(s, e, rng, p);
const inPlay = (kind: BattedBallKind, quality: BattedBallQuality = 'normal'): PitchEvent => ({
  type: 'inPlay',
  kind,
  quality,
});
const full: Bases = [true, true, true];

describe('볼카운트', () => {
  it('스트라이크 3개면 삼진, 아웃 1 증가 및 카운트 초기화', () => {
    let s = newGame();
    s = play(s, { type: 'strike', swinging: false }).state;
    s = play(s, { type: 'strike', swinging: true }).state;
    const o = play(s, { type: 'strike', swinging: true });
    expect(o.result).toBe('strikeout');
    expect(o.state.outs).toBe(1);
    expect([o.state.balls, o.state.strikes]).toEqual([0, 0]);
  });

  it('파울은 2스트라이크에서 카운트를 올리지 않는다', () => {
    const s = state({ strikes: 2 });
    const o = play(s, { type: 'foul' });
    expect(o.state.strikes).toBe(2);
    expect(o.result).toBeNull();
  });

  it('볼 4개면 볼넷, 주자 1루', () => {
    let s = newGame();
    for (let i = 0; i < 3; i++) s = play(s, { type: 'ball' }).state;
    const o = play(s, { type: 'ball' });
    expect(o.result).toBe('walk');
    expect(o.state.bases).toEqual([true, false, false]);
  });

  it('만루 볼넷은 밀어내기 1점', () => {
    const o = play(state({ balls: 3, bases: [...full] }), { type: 'ball' });
    expect(o.runs).toBe(1);
    expect(o.state.score.away).toBe(1);
    expect(o.state.bases).toEqual(full);
  });

  it('1,3루 볼넷은 만루가 되고 득점은 없다', () => {
    const o = play(state({ balls: 3, bases: [true, false, true] }), { type: 'ball' });
    expect(o.state.bases).toEqual(full);
    expect(o.runs).toBe(0);
  });

  it('입력 상태를 변경하지 않는다', () => {
    const s = newGame();
    const snapshot = JSON.stringify(s);
    play(s, { type: 'ball' });
    play(s, inPlay('fly', 'hard'), seq(0.5), forced('homeRun'));
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe('자동 주루 - 안타', () => {
  it('홈런: 주자 전원 + 타자 득점', () => {
    const o = play(state({ bases: [true, false, true] }), inPlay('fly', 'hard'), seq(0.5), forced('homeRun'));
    expect(o.result).toBe('homeRun');
    expect(o.runs).toBe(3);
    expect(o.state.bases).toEqual([false, false, false]);
    expect(o.state.score.away).toBe(3);
  });

  it('3루타: 주자 전원 득점, 타자 3루', () => {
    const o = play(state({ bases: [true, true, false] }), inPlay('line'), seq(0.5), forced('triple'));
    expect(o.runs).toBe(2);
    expect(o.state.bases).toEqual([false, false, true]);
  });

  it('2루타: 2·3루 주자 득점, 1루 주자는 확률로 득점/3루', () => {
    const scores = play(state({ bases: full }), inPlay('line'), seq(0), forced('double'));
    expect(scores.runs).toBe(3);
    expect(scores.state.bases).toEqual([false, true, false]);

    const holds = play(state({ bases: full }), inPlay('line'), seq(0.99), forced('double'));
    expect(holds.runs).toBe(2);
    expect(holds.state.bases).toEqual([false, true, true]);
  });

  it('단타: 3루 주자 득점, 2루 주자는 확률로 득점, 1루 주자는 2루', () => {
    const p = forced('single');
    const hold = play(state({ bases: full }), inPlay('line'), seq(0.99), p);
    expect(hold.runs).toBe(1);
    expect(hold.state.bases).toEqual(full);

    const score = play(state({ bases: full }), inPlay('line'), seq(0.0), p);
    expect(score.runs).toBe(2);
  });

  it('단타: 1루 주자가 3루까지 가면 주자 1,3루', () => {
    const o = play(state({ bases: [true, false, false] }), inPlay('line', 'hard'), seq(0.0), forced('single'));
    expect(o.state.bases).toEqual([true, false, true]);
  });
});

describe('자동 주루 - 아웃', () => {
  it('뜬공 아웃 + 3루 주자 태그업 희생플라이', () => {
    const o = play(state({ bases: [false, false, true] }), inPlay('fly', 'hard'), seq(0.0), forced('out'));
    expect(o.result).toBe('sacrificeFly');
    expect(o.runs).toBe(1);
    expect(o.state.outs).toBe(1);
    expect(o.state.bases).toEqual([false, false, false]);
  });

  it('2사에는 희생플라이가 없다', () => {
    const o = play(state({ outs: 2, bases: [false, false, true] }), inPlay('fly', 'hard'), seq(0.0), forced('out'));
    expect(o.result).toBe('flyOut');
    expect(o.runs).toBe(0);
    expect(o.halfInningEnded).toBe(true);
  });

  it('땅볼 병살: 무사 1루', () => {
    const o = play(state({ bases: [true, false, false] }), inPlay('ground'), seq(0.0), forced('out'));
    expect(o.result).toBe('doublePlay');
    expect(o.state.outs).toBe(2);
    expect(o.state.bases).toEqual([false, false, false]);
  });

  it('무사 만루 병살: 3루 주자 득점, 2루 주자 3루', () => {
    const o = play(state({ bases: [...full] }), inPlay('ground'), seq(0.0), forced('out'));
    expect(o.result).toBe('doublePlay');
    expect(o.runs).toBe(1);
    expect(o.state.bases).toEqual([false, false, true]);
  });

  it('1사 병살이면 이닝 종료, 득점 없음', () => {
    const o = play(state({ outs: 1, bases: [...full] }), inPlay('ground'), seq(0.0), forced('out'));
    expect(o.runs).toBe(0);
    expect(o.halfInningEnded).toBe(true);
    expect(o.state.half).toBe('bottom');
  });

  it('병살이 안 되면 강제 진루 (1루 주자 → 2루)', () => {
    const o = play(state({ bases: [true, false, false] }), inPlay('ground'), seq(0.99), forced('out'));
    expect(o.result).toBe('groundOut');
    expect(o.state.bases).toEqual([false, true, false]);
  });

  it('만루 땅볼 아웃은 밀어내기식 강제 득점', () => {
    const o = play(state({ bases: [...full] }), inPlay('ground'), seq(0.99), forced('out'));
    expect(o.runs).toBe(1);
    expect(o.state.bases).toEqual([false, true, true]);
  });

  it('1사 3루 땅볼: 3루 주자는 확률로 득점', () => {
    const p = forced('out');
    const go = play(state({ outs: 0, bases: [false, false, true] }), inPlay('ground'), seq(0.0), p);
    expect(go.runs).toBe(1);
    const stay = play(state({ outs: 0, bases: [false, false, true] }), inPlay('ground'), seq(0.99), p);
    expect(stay.runs).toBe(0);
    expect(stay.state.bases).toEqual([false, false, true]);
  });

  it('3번째 아웃에서는 득점 없이 이닝 교대', () => {
    const o = play(state({ outs: 2, bases: [false, false, true] }), inPlay('ground'), seq(0.0), forced('out'));
    expect(o.runs).toBe(0);
    expect(o.state.outs).toBe(0);
    expect(o.state.half).toBe('bottom');
    expect(o.state.bases).toEqual([false, false, false]);
  });

  it('라인드라이브/팝플라이 아웃은 주자 변화 없음', () => {
    const line = play(state({ bases: [true, false, false] }), inPlay('line'), seq(0.5), forced('out'));
    expect(line.result).toBe('lineOut');
    expect(line.state.bases).toEqual([true, false, false]);
    const pop = play(state(), inPlay('popup'), seq(0.5));
    expect(pop.result).toBe('popOut');
  });
});

describe('이닝/경기 진행', () => {
  const threeOuts = (s: GameState) => {
    let cur = s;
    for (let i = 0; i < 3; i++) {
      for (let k = 0; k < 3; k++) cur = play(cur, { type: 'strike', swinging: true }).state;
      if (cur.status === 'finished') break;
    }
    return cur;
  };

  it('초 → 말 → 다음 이닝 순서', () => {
    let s = threeOuts(newGame());
    expect([s.inning, s.half]).toEqual([1, 'bottom']);
    s = threeOuts(s);
    expect([s.inning, s.half]).toEqual([2, 'top']);
  });

  it('9회 초 종료 시 홈팀이 앞서면 말 공격 없이 종료', () => {
    const s = threeOuts(state({ inning: 9, half: 'top', score: { away: 1, home: 2 } }));
    expect(s.status).toBe('finished');
    expect(s.winner).toBe('home');
  });

  it('9회 말 종료 후 원정팀 승리', () => {
    const s = threeOuts(state({ inning: 9, half: 'bottom', score: { away: 3, home: 2 } }));
    expect(s.winner).toBe('away');
  });

  it('9회 말 끝내기: 역전 순간 즉시 종료', () => {
    const o = play(
      state({ inning: 9, half: 'bottom', score: { away: 3, home: 3 }, bases: [false, false, true] }),
      inPlay('line'),
      seq(0.5),
      forced('single'),
    );
    expect(o.state.status).toBe('finished');
    expect(o.state.winner).toBe('home');
    expect(o.state.score.home).toBe(4);
  });

  it('9회 말 동점이면 연장 진입', () => {
    const s = threeOuts(state({ inning: 9, half: 'bottom', score: { away: 2, home: 2 } }));
    expect(s.status).toBe('playing');
    expect([s.inning, s.half]).toEqual([10, 'top']);
  });

  it('연장 한도까지 동점이면 무승부', () => {
    const s = threeOuts(
      state({ inning: 12, half: 'bottom', score: { away: 2, home: 2 } }),
    );
    expect(s.status).toBe('finished');
    expect(s.winner).toBe('draw');
  });

  it('3이닝 단축 모드', () => {
    const s = threeOuts(
      state({ config: { innings: 3, maxExtraInnings: 0 }, inning: 3, half: 'bottom', score: { away: 1, home: 0 } }),
    );
    expect(s.winner).toBe('away');
  });

  it('종료된 경기에 투구를 적용하면 오류', () => {
    expect(() => play(state({ status: 'finished' }), { type: 'ball' })).toThrow();
  });

  it('득점은 공격 팀에 기록된다 (초=원정, 말=홈)', () => {
    const top = play(state(), inPlay('fly', 'hard'), seq(0.5), forced('homeRun'));
    expect(top.state.score).toEqual({ away: 1, home: 0 });
    const bot = play(state({ half: 'bottom' }), inPlay('fly', 'hard'), seq(0.5), forced('homeRun'));
    expect(bot.state.score).toEqual({ away: 0, home: 1 });
  });
});

describe('파라미터/시뮬레이션 건전성', () => {
  it('같은 시드면 같은 경기 결과', () => {
    const run = (seed: number) => {
      const rng = createRng(seed);
      let s = newGame({ innings: 3 });
      const kinds: BattedBallKind[] = ['ground', 'line', 'fly', 'popup'];
      const quals: BattedBallQuality[] = ['weak', 'normal', 'hard'];
      while (s.status === 'playing') {
        s = applyPitch(
          s,
          { type: 'inPlay', kind: kinds[Math.floor(rng() * 4)]!, quality: quals[Math.floor(rng() * 3)]! },
          rng,
        ).state;
      }
      return s.score;
    };
    expect(run(42)).toEqual(run(42));
  });

  it('무작위 투구 2천 경기 동안 상태 불변식 유지', () => {
    const rng = createRng(7);
    const kinds: BattedBallKind[] = ['ground', 'line', 'fly', 'popup'];
    const quals: BattedBallQuality[] = ['weak', 'normal', 'hard'];
    for (let g = 0; g < 2000; g++) {
      let s = newGame();
      let steps = 0;
      while (s.status === 'playing') {
        const r = rng();
        const e: PitchEvent =
          r < 0.3 ? { type: 'ball' }
          : r < 0.55 ? { type: 'strike', swinging: rng() < 0.5 }
          : r < 0.7 ? { type: 'foul' }
          : { type: 'inPlay', kind: kinds[Math.floor(rng() * 4)]!, quality: quals[Math.floor(rng() * 3)]! };
        s = applyPitch(s, e, rng).state;
        // expect()는 느려서 수십만 회 호출에는 직접 검사한다
        if (s.outs < 0 || s.outs >= 3 || s.balls >= 4 || s.strikes >= 3) {
          throw new Error(`불변식 위반: ${JSON.stringify(s)}`);
        }
        if (++steps > 5000) throw new Error('경기가 끝나지 않음');
      }
      if (s.winner === null) throw new Error('종료된 경기에 승자 정보가 없음');
    }
  });

  it('타구 종류별 안타율이 현실적인 범위', () => {
    const rng = createRng(1);
    const rate = (kind: BattedBallKind, quality: BattedBallQuality) => {
      let hits = 0;
      const n = 20000;
      for (let i = 0; i < n; i++) {
        const r = applyPitch(newGame(), { type: 'inPlay', kind, quality }, rng).result;
        if (r === 'single' || r === 'double' || r === 'triple' || r === 'homeRun') hits++;
      }
      return hits / n;
    };
    expect(rate('ground', 'weak')).toBeLessThan(0.2);
    expect(rate('line', 'hard')).toBeGreaterThan(0.7);
    expect(rate('popup', 'hard')).toBe(0);
    expect(rate('fly', 'hard')).toBeGreaterThan(rate('fly', 'normal'));
  });
});
