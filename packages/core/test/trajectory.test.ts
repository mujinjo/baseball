import { describe, expect, it } from 'vitest';
import {
  FOUL_LINE_DEG,
  applyPitch,
  createRng,
  fenceDistance,
  newGame,
  traceBattedBall,
  traceFoul,
  type BattedBallKind,
  type BattedBallQuality,
  type PlateResult,
} from '../src';

const KINDS: BattedBallKind[] = ['ground', 'line', 'fly', 'popup'];
const QUALS: BattedBallQuality[] = ['weak', 'normal', 'hard'];

describe('펜스 거리', () => {
  it('센터가 가장 깊고 파울 라인이 가장 얕다', () => {
    expect(fenceDistance(0)).toBeCloseTo(120);
    expect(fenceDistance(45)).toBeCloseTo(98);
    expect(fenceDistance(-45)).toBeCloseTo(98);
    expect(fenceDistance(20)).toBeLessThan(fenceDistance(0));
  });
});

describe('타구 궤적이 결과와 모순되지 않는다', () => {
  const rng = createRng(21);
  const sample = (result: PlateResult, kind: BattedBallKind, n = 600) =>
    Array.from({ length: n }, (_, i) => traceBattedBall(kind, QUALS[i % 3]!, result, rng));

  it('홈런은 항상 펜스 너머, 아웃/안타는 펜스 안쪽', () => {
    for (const t of sample('homeRun', 'fly')) expect(t.distanceM).toBeGreaterThan(fenceDistance(t.angleDeg));
    for (const r of ['single', 'double', 'triple', 'flyOut', 'lineOut', 'sacrificeFly', 'popOut'] as PlateResult[]) {
      for (const t of sample(r, r === 'popOut' ? 'popup' : r === 'lineOut' ? 'line' : 'fly')) {
        expect(t.distanceM).toBeLessThan(fenceDistance(t.angleDeg));
      }
    }
  });

  it('땅볼 아웃은 내야, 뜬공 아웃은 외야 깊이', () => {
    for (const t of sample('groundOut', 'ground')) expect(t.distanceM).toBeLessThanOrEqual(32);
    for (const t of sample('flyOut', 'fly')) expect(t.distanceM).toBeGreaterThanOrEqual(58);
    for (const t of sample('popOut', 'popup')) expect(t.distanceM).toBeLessThanOrEqual(46);
  });

  it('안타 종류가 길수록 멀리 간다 (평균)', () => {
    const avg = (r: PlateResult, k: BattedBallKind) => {
      const s = sample(r, k, 800);
      return s.reduce((a, t) => a + t.distanceM, 0) / s.length;
    };
    expect(avg('single', 'line')).toBeLessThan(avg('double', 'line'));
    expect(avg('double', 'line')).toBeLessThan(avg('triple', 'line'));
    expect(avg('triple', 'line')).toBeLessThan(avg('homeRun', 'line'));
  });

  it('강한 타구가 더 멀리 간다', () => {
    const avg = (q: BattedBallQuality) => {
      let sum = 0;
      for (let i = 0; i < 800; i++) sum += traceBattedBall('fly', q, 'flyOut', rng).distanceM;
      return sum / 800;
    };
    expect(avg('hard')).toBeGreaterThan(avg('weak'));
  });

  it('페어 타구는 항상 파울 라인 안쪽, 파울은 바깥', () => {
    for (const kind of KINDS) {
      for (const r of ['single', 'double', 'groundOut', 'flyOut', 'homeRun'] as PlateResult[]) {
        for (const t of sample(r, kind, 100)) expect(Math.abs(t.angleDeg)).toBeLessThan(FOUL_LINE_DEG);
      }
    }
    for (let i = 0; i < 300; i++) {
      const f = traceFoul(rng);
      expect(Math.abs(f.angleDeg)).toBeGreaterThan(FOUL_LINE_DEG);
      expect(f.kind).toBe('foul');
    }
  });

  it('연출 시간과 높이가 양수', () => {
    for (const kind of KINDS) {
      for (const t of sample('single', kind, 50)) {
        expect(t.durationMs).toBeGreaterThan(0);
        expect(t.apexM).toBeGreaterThan(0);
      }
    }
  });
});

describe('applyPitch의 궤적', () => {
  it('인플레이/파울에만 궤적이 붙는다', () => {
    const rng = createRng(1);
    const s = newGame();
    expect(applyPitch(s, { type: 'ball' }, rng).trace).toBeUndefined();
    expect(applyPitch(s, { type: 'strike', swinging: true }, rng).trace).toBeUndefined();
    expect(applyPitch(s, { type: 'foul' }, rng).trace?.kind).toBe('foul');
    const hit = applyPitch(s, { type: 'inPlay', kind: 'fly', quality: 'hard' }, rng);
    expect(hit.trace).toBeDefined();
    if (hit.result === 'homeRun') expect(hit.trace!.distanceM).toBeGreaterThan(fenceDistance(hit.trace!.angleDeg));
  });

  it('실제 경기 흐름에서도 홈런은 펜스 너머, 아웃은 펜스 안', () => {
    const rng = createRng(33);
    for (let i = 0; i < 4000; i++) {
      const out = applyPitch(
        newGame(),
        { type: 'inPlay', kind: KINDS[i % 4]!, quality: QUALS[i % 3]! },
        rng,
      );
      const t = out.trace!;
      const fence = fenceDistance(t.angleDeg);
      if (out.result === 'homeRun') expect(t.distanceM).toBeGreaterThan(fence);
      else expect(t.distanceM).toBeLessThan(fence);
    }
  });
});
