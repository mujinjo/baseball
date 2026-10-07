import { weightedPick } from './rng';
import type { BattedBallKind, BattedBallQuality, PlateResult, Rng } from './types';

/**
 * 타구 궤적. 결과(안타/아웃/홈런…)가 이미 정해진 뒤에, 그 결과와 모순되지 않는 비거리·방향을 만든다.
 * 좌표: 홈플레이트 기준 극좌표. angleDeg 0 = 센터, 음수 = 좌측(3루 쪽), 양수 = 우측(1루 쪽).
 * ±45°가 파울 라인이며 그 바깥은 파울 지역이다.
 */
export interface BattedBallTrace {
  kind: BattedBallKind | 'foul';
  angleDeg: number;
  /** 첫 낙하(또는 포구) 지점까지의 거리(m) */
  distanceM: number;
  /** 최고 높이(m). 땅볼은 튀는 높이 */
  apexM: number;
  /** 화면 연출 시간(ms). 실제 체공 시간이 아니라 보기 좋게 줄인 값 */
  durationMs: number;
}

export const FOUL_LINE_DEG = 45;

/** 방향별 외야 펜스 거리(m): 센터 120, 파울 라인 98 */
export function fenceDistance(angleDeg: number): number {
  const a = Math.min(FOUL_LINE_DEG, Math.abs(angleDeg));
  return 98 + (120 - 98) * Math.cos((a * Math.PI) / 90);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 타구 질에 따라 구간 안에서 어디쯤일지(0~1) */
function qualityT(q: BattedBallQuality, rng: Rng): number {
  const [lo, hi] = q === 'weak' ? [0, 0.4] : q === 'normal' ? [0.3, 0.7] : [0.6, 1];
  return lerp(lo, hi, rng());
}

/** 정면~좌우로 퍼지는 방향(삼각 분포 느낌). 파울 라인 안쪽에서만 */
function fairAngle(rng: Rng, spread = 40): number {
  return (rng() + rng() - 1) * spread;
}

const clampAngle = (a: number) => Math.max(-FOUL_LINE_DEG + 2, Math.min(FOUL_LINE_DEG - 2, a));

export function traceBattedBall(
  kind: BattedBallKind,
  quality: BattedBallQuality,
  result: PlateResult,
  rng: Rng,
): BattedBallTrace {
  const t = qualityT(quality, rng);
  let angle = fairAngle(rng);
  let dist: number;

  switch (result) {
    case 'homeRun': {
      angle = clampAngle(fairAngle(rng, 42));
      const extra = lerp(2, 28, t) * (Math.abs(angle) > 35 ? 0.6 : 1);
      dist = fenceDistance(angle) + extra;
      break;
    }
    case 'triple': {
      // 좌중간/우중간 혹은 라인 쪽 깊은 곳
      angle = clampAngle((rng() < 0.5 ? -1 : 1) * lerp(15, 40, rng()));
      dist = fenceDistance(angle) - lerp(22, 5, t);
      break;
    }
    case 'double':
      angle = clampAngle((rng() < 0.5 ? -1 : 1) * lerp(8, 40, rng()));
      dist = lerp(68, fenceDistance(angle) - 8, t);
      break;
    case 'single':
      dist = kind === 'ground' ? lerp(28, 52, t) : kind === 'line' ? lerp(42, 66, t) : lerp(45, 62, t);
      break;
    case 'groundOut':
    case 'doublePlay':
      dist = lerp(14, 32, t);
      break;
    case 'lineOut':
      dist = lerp(34, 78, t);
      break;
    case 'popOut':
      dist = lerp(18, 46, t);
      break;
    case 'sacrificeFly':
      angle = clampAngle(fairAngle(rng, 30));
      dist = lerp(72, Math.min(96, fenceDistance(angle) - 8), t);
      break;
    case 'flyOut':
    default:
      dist = lerp(58, fenceDistance(angle) - 6, t);
      break;
  }

  return { kind, angleDeg: angle, distanceM: Math.round(dist), ...shape(kind, result, dist, rng) };
}

/** 종류별 최고 높이와 연출 시간 */
function shape(kind: BattedBallKind, result: PlateResult, dist: number, rng: Rng) {
  switch (kind) {
    case 'ground':
      return { apexM: lerp(0.4, 1.2, rng()), durationMs: 900 + dist * 8 };
    case 'line':
      return { apexM: lerp(6, 16, rng()), durationMs: 900 + dist * 6 };
    case 'popup':
      return { apexM: lerp(32, 48, rng()), durationMs: 1800 };
    case 'fly':
      return {
        apexM: lerp(22, 42, rng()) * (result === 'homeRun' ? 1.1 : 1),
        durationMs: 1500 + dist * 8,
      };
  }
}

/** 파울 타구: 라인 바깥(또는 백네트 쪽)으로 날아간다 */
export function traceFoul(rng: Rng): BattedBallTrace {
  const side = rng() < 0.5 ? -1 : 1;
  const zone = weightedPick({ near: 5, wide: 3, back: 2 }, rng);
  const a = zone === 'near' ? lerp(47, 65, rng()) : zone === 'wide' ? lerp(65, 100, rng()) : lerp(120, 170, rng());
  const dist = zone === 'back' ? lerp(8, 25, rng()) : lerp(18, 85, rng());
  return {
    kind: 'foul',
    angleDeg: side * a,
    distanceM: Math.round(dist),
    apexM: lerp(8, 34, rng()),
    durationMs: 1300 + dist * 6,
  };
}
