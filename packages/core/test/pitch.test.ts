import { describe, expect, it } from 'vitest';
import {
  AVERAGE_BATTER,
  AVERAGE_PITCHER,
  DEFAULT_PITCH_PARAMS,
  createRng,
  pickBattedKind,
  resolvePitch,
  simulate,
  throwLocation,
  type BatterAction,
  type PitchThrow,
} from '../src';

const center: PitchThrow = { pitchType: 'fastball', target: { x: 0, y: 0 }, gauge: 1 };
const wayOutside: PitchThrow = { pitchType: 'fastball', target: { x: 3, y: 3 }, gauge: 1 };
const swing = (timingMs: number, extra: Partial<BatterAction> = {}): BatterAction => ({
  swing: true,
  timingMs,
  ...extra,
});
const take: BatterAction = { swing: false, timingMs: 0 };
const run = (p: PitchThrow, a: BatterAction, rng = createRng(1)) =>
  resolvePitch(p, a, AVERAGE_PITCHER, AVERAGE_BATTER, rng);

describe('노스윙 판정', () => {
  it('존 안은 스트라이크(루킹)', () => {
    expect(run(center, take).event).toEqual({ type: 'strike', swinging: false });
  });
  it('존 밖은 볼', () => {
    expect(run(wayOutside, take).event).toEqual({ type: 'ball' });
  });
});

describe('스윙 판정', () => {
  it('타이밍이 크게 어긋나면 항상 헛스윙', () => {
    for (let i = 0; i < 200; i++) {
      expect(run(center, swing(1000), createRng(i)).event).toEqual({ type: 'strike', swinging: true });
    }
  });

  it('존 한참 밖 공은 맞춰도 컨택이 거의 안 된다', () => {
    let contact = 0;
    for (let i = 0; i < 500; i++) {
      if (run(wayOutside, swing(0), createRng(i)).event.type !== 'strike') contact++;
    }
    expect(contact).toBeLessThan(5);
  });

  const contactRate = (a: BatterAction, p: PitchThrow = center, n = 4000) => {
    const rng = createRng(99);
    let c = 0;
    for (let i = 0; i < n; i++) if (run(p, a, rng).event.type !== 'strike') c++;
    return c / n;
  };

  it('타이밍이 정확할수록 컨택률이 높다', () => {
    expect(contactRate(swing(0))).toBeGreaterThan(contactRate(swing(60)));
    expect(contactRate(swing(60))).toBeGreaterThan(contactRate(swing(150)));
  });

  it('구종 예측이 맞으면 컨택률이 오르고 틀리면 내린다', () => {
    const none = contactRate(swing(40));
    const right = contactRate(swing(40, { guess: { pitchType: 'fastball' } }));
    const wrong = contactRate(swing(40, { guess: { pitchType: 'curve' } }));
    expect(right).toBeGreaterThan(none);
    expect(wrong).toBeLessThan(none);
  });

  it('코스 예측이 맞으면 컨택률이 오른다', () => {
    const none = contactRate(swing(40));
    const right = contactRate(swing(40, { guess: { cell: { x: 0, y: 0 } } }));
    expect(right).toBeGreaterThan(none);
  });

  it('느린 변화구일수록 타이밍 여유가 크다', () => {
    const fast = contactRate(swing(60), { ...center, pitchType: 'fastball' });
    const slow = contactRate(swing(60), { ...center, pitchType: 'changeup' });
    expect(slow).toBeGreaterThan(fast);
  });

  it('인플레이 타구에는 종류와 질이 붙는다', () => {
    const rng = createRng(5);
    for (let i = 0; i < 500; i++) {
      const e = run(center, swing(0), rng).event;
      if (e.type === 'inPlay') {
        expect(['ground', 'line', 'fly', 'popup']).toContain(e.kind);
        expect(['weak', 'normal', 'hard']).toContain(e.quality);
        return;
      }
    }
    throw new Error('인플레이가 한 번도 나오지 않음');
  });
});

describe('제구', () => {
  const spread = (gauge: number, control = 0.5) => {
    const rng = createRng(3);
    let sum = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const l = throwLocation({ ...center, gauge }, { control }, rng);
      sum += Math.hypot(l.x, l.y);
    }
    return sum / n;
  };
  it('게이지가 정확할수록 목표에 가깝다', () => {
    expect(spread(1)).toBeLessThan(spread(0.5));
    expect(spread(0.5)).toBeLessThan(spread(0));
  });
  it('제구 능력치가 높을수록 오차가 작다', () => {
    expect(spread(0.7, 1)).toBeLessThan(spread(0.7, 0));
  });
});

describe('타구 종류', () => {
  const share = (y: number, kind: string) => {
    const rng = createRng(11);
    let c = 0;
    const n = 6000;
    for (let i = 0; i < n; i++) if (pickBattedKind(y, 'normal', rng) === kind) c++;
    return c / n;
  };
  it('낮은 공은 땅볼, 높은 공은 뜬공이 많다', () => {
    expect(share(-1, 'ground')).toBeGreaterThan(share(1, 'ground'));
    expect(share(1, 'fly') + share(1, 'popup')).toBeGreaterThan(share(-1, 'fly') + share(-1, 'popup'));
  });
  it('강한 타구는 팝플라이가 줄어든다', () => {
    const rng = createRng(2);
    const count = (q: 'weak' | 'hard') => {
      let c = 0;
      for (let i = 0; i < 6000; i++) if (pickBattedKind(1.2, q, rng) === 'popup') c++;
      return c;
    };
    expect(count('hard')).toBeLessThan(count('weak'));
  });
});

describe('밸런스 시뮬레이션 (보통 타자 vs 보통 투수, 주자 없음)', () => {
  const N = 12000;
  const base = simulate({ plateAppearances: N }, createRng(1));

  it('타율/출루율/삼진/볼넷/홈런이 야구다운 범위', () => {
    expect(base.avg).toBeGreaterThan(0.2);
    expect(base.avg).toBeLessThan(0.31);
    expect(base.obp).toBeGreaterThan(0.28);
    expect(base.obp).toBeLessThan(0.4);
    expect(base.kRate).toBeGreaterThan(0.15);
    expect(base.kRate).toBeLessThan(0.3);
    expect(base.bbRate).toBeGreaterThan(0.04);
    expect(base.bbRate).toBeLessThan(0.12);
    expect(base.hrRate).toBeGreaterThan(0.005);
    expect(base.hrRate).toBeLessThan(0.05);
    expect(base.pitchesPerPA).toBeGreaterThan(3);
    expect(base.pitchesPerPA).toBeLessThan(4.5);
  });

  it('타이밍이 좋은 타자가 더 잘 친다', () => {
    const good = simulate({ plateAppearances: N, timingSigmaMs: 25 }, createRng(2));
    const bad = simulate({ plateAppearances: N, timingSigmaMs: 70 }, createRng(3));
    expect(good.avg).toBeGreaterThan(base.avg);
    expect(base.avg).toBeGreaterThan(bad.avg);
    expect(good.kRate).toBeLessThan(bad.kRate);
  });

  it('제구가 좋은 투수일수록 볼넷이 줄고 삼진은 늘지는 않는다 (존 투구 증가)', () => {
    const wild = simulate({ plateAppearances: N, gaugeMean: 0.35 }, createRng(4));
    const sharp = simulate({ plateAppearances: N, gaugeMean: 0.95 }, createRng(5));
    expect(sharp.bbRate).toBeLessThan(wild.bbRate);
  });

  it('구종을 잘 읽는 타자가 유리하고, 무작위 예측은 이득이 크지 않다', () => {
    const read = simulate({ plateAppearances: N, guessAccuracy: 0.75 }, createRng(6));
    const random = simulate({ plateAppearances: N, guessAccuracy: 0.25 }, createRng(7));
    expect(read.slg).toBeGreaterThan(base.slg + 0.05);
    expect(random.slg - base.slg).toBeLessThan(0.05);
  });

  it('같은 시드면 같은 결과', () => {
    const a = simulate({ plateAppearances: 500 }, createRng(77));
    const b = simulate({ plateAppearances: 500 }, createRng(77));
    expect(a).toEqual(b);
  });

  it('기본 파라미터 구종 속도 순서: 직구 > 슬라이더 > 체인지업 > 커브', () => {
    const t = DEFAULT_PITCH_PARAMS.types;
    expect(t.fastball.speed).toBeGreaterThan(t.slider.speed);
    expect(t.slider.speed).toBeGreaterThan(t.changeup.speed);
    expect(t.changeup.speed).toBeGreaterThan(t.curve.speed);
  });
});
