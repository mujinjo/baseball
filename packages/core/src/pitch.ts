import defaultParams from './pitch.json';
import { gaussian, weightedPick } from './rng';
import type { BattedBallKind, BattedBallQuality, PitchEvent, Rng } from './types';

export type PitchType = 'fastball' | 'slider' | 'curve' | 'changeup';
export const PITCH_TYPES: PitchType[] = ['fastball', 'slider', 'curve', 'changeup'];

/**
 * 스트라이크존 좌표계: 존 중앙이 (0,0), 존 경계가 x,y = ±1.
 * x: 왼쪽(-) ~ 오른쪽(+), y: 낮음(-) ~ 높음(+). 경계 밖은 볼존.
 */
export interface Location {
  x: number;
  y: number;
}

export interface PitchParams {
  types: Record<PitchType, { speed: number; spread: number; windowMs: number; deception: number }>;
  control: { gaugeBestFactor: number; gaugeWorstFactor: number; ratingFactor: number };
  contact: {
    ratingWindow: number;
    typeGuessRight: number;
    typeGuessWrong: number;
    cellGuessRadius: number;
    cellGuessRight: number;
    cellGuessWrong: number;
    outOfZoneFalloff: number;
    deceptionPenalty: number;
    eyeDeceptionRelief: number;
  };
  foul: { base: number; timing: number; outOfZone: number; max: number };
  quality: {
    timingWeight: number;
    centerWeight: number;
    powerWeight: number;
    typeGuessBonus: number;
    cellGuessBonus: number;
    noise: number;
    hard: number;
    normal: number;
  };
  kindByHeight: Record<'low' | 'mid' | 'high', Record<BattedBallKind, number>>;
  kindAdjust: { hardPopupFactor: number; weakLineFactor: number };
}

export const DEFAULT_PITCH_PARAMS = defaultParams as PitchParams;

/** 투수가 정하는 것: 구종, 노리는 위치, 제구 게이지 정확도(1=완벽) */
export interface PitchThrow {
  pitchType: PitchType;
  target: Location;
  gauge: number;
}

/** 타자가 정하는 것: 스윙 여부, 타이밍 오차(ms, 음수=빠름/양수=늦음), 선택적 예측 */
export interface BatterAction {
  swing: boolean;
  timingMs: number;
  guess?: { pitchType?: PitchType; cell?: Location };
}

/** 선수 능력치 (모두 0~1, 기본 0.5) */
export interface PitcherStats {
  control: number;
}
export interface BatterStats {
  contact: number;
  power: number;
  eye: number;
}
export const AVERAGE_PITCHER: PitcherStats = { control: 0.5 };
export const AVERAGE_BATTER: BatterStats = { contact: 0.5, power: 0.5, eye: 0.5 };

export interface PitchDetail {
  /** 이번 투구가 실제로 들어온 위치 */
  actual: Location;
  inZone: boolean;
  /** 구속(km/h) */
  speed: number;
  /** 상태머신에 넘길 결과 */
  event: PitchEvent;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const isInZone = (l: Location) => Math.abs(l.x) <= 1 && Math.abs(l.y) <= 1;

/** 존 바깥으로 벗어난 거리 (존 안이면 0) */
function distanceOutsideZone(l: Location): number {
  const dx = Math.max(0, Math.abs(l.x) - 1);
  const dy = Math.max(0, Math.abs(l.y) - 1);
  return Math.hypot(dx, dy);
}

/** 제구: 목표 위치에 게이지·능력치에 따른 오차를 더해 실제 투구 위치를 정한다 */
export function throwLocation(
  t: PitchThrow,
  pitcher: PitcherStats,
  rng: Rng,
  params: PitchParams = DEFAULT_PITCH_PARAMS,
): Location {
  const c = params.control;
  const gaugeFactor = lerp(c.gaugeWorstFactor, c.gaugeBestFactor, clamp(t.gauge, 0, 1));
  const ratingFactor = 1 + c.ratingFactor * (0.5 - clamp(pitcher.control, 0, 1));
  const sigma = params.types[t.pitchType].spread * gaugeFactor * ratingFactor;
  return { x: t.target.x + gaussian(rng) * sigma, y: t.target.y + gaussian(rng) * sigma };
}

/**
 * 투구 한 번을 판정해 PitchEvent로 변환한다.
 * 노스윙: 존 안이면 스트라이크, 밖이면 볼.
 * 스윙: 타이밍·위치·구종 예측으로 헛스윙/파울/인플레이(타구 종류·질)를 결정한다.
 */
export function resolvePitch(
  pitch: PitchThrow,
  action: BatterAction,
  pitcher: PitcherStats,
  batter: BatterStats,
  rng: Rng,
  params: PitchParams = DEFAULT_PITCH_PARAMS,
): PitchDetail {
  const spec = params.types[pitch.pitchType];
  const actual = throwLocation(pitch, pitcher, rng, params);
  const inZone = isInZone(actual);
  const base = { actual, inZone, speed: spec.speed };

  if (!action.swing) {
    return { ...base, event: inZone ? { type: 'strike', swinging: false } : { type: 'ball' } };
  }

  const c = params.contact;
  const q = params.quality;

  // 예측 보정
  let windowMult = 1;
  let guessBonus = 0;
  const g = action.guess;
  if (g?.pitchType) {
    if (g.pitchType === pitch.pitchType) {
      windowMult *= c.typeGuessRight;
      guessBonus += q.typeGuessBonus;
    } else {
      windowMult *= c.typeGuessWrong;
    }
  }
  if (g?.cell) {
    if (Math.hypot(g.cell.x - actual.x, g.cell.y - actual.y) <= c.cellGuessRadius) {
      windowMult *= c.cellGuessRight;
      guessBonus += q.cellGuessBonus;
    } else {
      windowMult *= c.cellGuessWrong;
    }
  }

  const window = spec.windowMs * windowMult * (1 - c.ratingWindow / 2 + c.ratingWindow * clamp(batter.contact, 0, 1));
  const t = Math.abs(action.timingMs) / window;
  const timingScore = Math.exp(-(t * t) / 2);
  const outDist = distanceOutsideZone(actual);
  const zoneFactor = Math.exp(-(outDist * outDist) / c.outOfZoneFalloff);
  const deception = spec.deception * (1 - c.eyeDeceptionRelief * clamp(batter.eye, 0, 1));
  const contactProb = timingScore * zoneFactor * (1 - deception * c.deceptionPenalty);

  if (rng() >= contactProb) {
    return { ...base, event: { type: 'strike', swinging: true } };
  }

  const f = params.foul;
  const foulProb = Math.min(
    f.max,
    f.base + f.timing * clamp(t / 2, 0, 1) + (inZone ? 0 : f.outOfZone),
  );
  if (rng() < foulProb) return { ...base, event: { type: 'foul' } };

  // 타구 질
  const centerScore = 1 - Math.min(1, Math.hypot(actual.x, actual.y) / 1.2);
  const score =
    q.timingWeight * timingScore +
    q.centerWeight * centerScore +
    q.powerWeight * clamp(batter.power, 0, 1) +
    guessBonus +
    (rng() - 0.5) * 2 * q.noise;
  const quality: BattedBallQuality = score >= q.hard ? 'hard' : score >= q.normal ? 'normal' : 'weak';

  return { ...base, event: { type: 'inPlay', kind: pickBattedKind(actual.y, quality, rng, params), quality } };
}

/** 타구 높이(투구 높이)와 질로 타구 종류를 정한다: 낮은 공 → 땅볼, 높은 공 → 뜬공/팝플라이 */
export function pickBattedKind(
  y: number,
  quality: BattedBallQuality,
  rng: Rng,
  params: PitchParams = DEFAULT_PITCH_PARAMS,
): BattedBallKind {
  const h = clamp((y + 1.4) / 2.8, 0, 1);
  const { low, mid, high } = params.kindByHeight;
  const weights = {} as Record<BattedBallKind, number>;
  for (const k of ['ground', 'line', 'fly', 'popup'] as BattedBallKind[]) {
    weights[k] = h < 0.5 ? lerp(low[k], mid[k], h * 2) : lerp(mid[k], high[k], (h - 0.5) * 2);
  }
  if (quality === 'hard') weights.popup *= params.kindAdjust.hardPopupFactor;
  if (quality === 'weak') weights.line *= params.kindAdjust.weakLineFactor;
  return weightedPick(weights, rng);
}
