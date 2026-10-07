import { gridCells, type GridCell } from './grid';
import { gaussian, weightedPick } from './rng';
import {
  DEFAULT_PITCH_PARAMS,
  PITCH_TYPES,
  type BatterAction,
  type Location,
  type PitchParams,
  type PitchType,
} from './pitch';
import type { Bases, Rng } from './types';

/** 컴퓨터 상대의 난이도 */
export type AiLevel = 'easy' | 'normal' | 'hard';
export const AI_LEVELS: AiLevel[] = ['easy', 'normal', 'hard'];

export interface AiProfile {
  /** 투수: 제구 게이지 평균 정확도와 흔들림 */
  gaugeMean: number;
  gaugeJitter: number;
  /** 투수: 상황을 읽고 코스·구종을 섞는 정도 (0=무작위, 1=최대) */
  pitchSmarts: number;
  /** 타자: 타이밍 오차 표준편차(ms) */
  timingSigmaMs: number;
  /** 타자: 공 위치를 보는 눈의 오차 (작을수록 좋음) */
  eyeNoise: number;
  /** 타자: 2스트라이크 전 존 안 공을 그냥 보내는 확률 */
  takeRate: number;
  /** 타자: 존 근처 나쁜 공에 속아 휘두르는 확률 */
  chaseRate: number;
}

export const AI_PROFILES: Record<AiLevel, AiProfile> = {
  easy: { gaugeMean: 0.55, gaugeJitter: 0.35, pitchSmarts: 0.2, timingSigmaMs: 80, eyeNoise: 0.45, takeRate: 0.2, chaseRate: 0.4 },
  normal: { gaugeMean: 0.7, gaugeJitter: 0.25, pitchSmarts: 0.6, timingSigmaMs: 50, eyeNoise: 0.3, takeRate: 0.3, chaseRate: 0.25 },
  hard: { gaugeMean: 0.85, gaugeJitter: 0.15, pitchSmarts: 1, timingSigmaMs: 30, eyeNoise: 0.18, takeRate: 0.35, chaseRate: 0.15 },
};

export interface CountContext {
  balls: number;
  strikes: number;
  outs: number;
  bases: Bases;
}

export interface PastPitch {
  pitchType: PitchType;
  target: Location;
}

const CELLS = gridCells();
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 카운트에 따라 존 안으로 던질 확률 */
export function zoneProbability(ctx: CountContext, smarts: number): number {
  let p = 0.6;
  if (ctx.balls >= 3) p = 0.95;
  else if (ctx.balls > ctx.strikes) p = 0.8;
  else if (ctx.strikes === 2 && ctx.balls <= 1) p = 0.3; // 유인구
  return 0.6 + (p - 0.6) * smarts;
}

/**
 * 컴퓨터 투수의 구종/코스 선택. 카운트를 읽고 직전 투구와 겹치지 않게 섞는다.
 * 제구 게이지는 aiGauge로 따로 뽑는다.
 */
export function aiChoosePitch(
  ctx: CountContext,
  history: PastPitch[],
  level: AiLevel,
  rng: Rng,
  params: PitchParams = DEFAULT_PITCH_PARAMS,
): { pitchType: PitchType; target: Location } {
  const smarts = AI_PROFILES[level].pitchSmarts;
  const wantZone = rng() < zoneProbability(ctx, smarts);
  const last = history[history.length - 1];
  const recent = history.slice(-3);

  // 구종: 스트라이크가 필요하면 제구가 좋은 구종, 아니면 직전과 다른 속도의 공을 선호
  const typeWeights = {} as Record<PitchType, number>;
  for (const t of PITCH_TYPES) {
    const spec = params.types[t];
    let w = 1;
    if (wantZone) w *= 1 + smarts * (0.4 / spec.spread - 1);
    if (last) {
      const speedGap = Math.abs(spec.speed - params.types[last.pitchType].speed);
      w *= 1 + smarts * (speedGap / 30);
      if (t === last.pitchType) w *= 1 - 0.6 * smarts;
    }
    typeWeights[t] = Math.max(0.05, w);
  }
  const pitchType = weightedPick(typeWeights, rng);

  // 코스: 존 안(모서리·가장자리 선호) 또는 존 바로 밖(유인구)
  const pool = CELLS.filter((c) => c.inZone === wantZone);
  const cellWeights: Record<string, number> = {};
  pool.forEach((c, i) => {
    let w = 1;
    const edge = Math.max(Math.abs(c.center.x), Math.abs(c.center.y));
    if (wantZone) {
      // 한가운데는 맞기 쉬우니 스마트할수록 피한다
      if (c.col === 2 && c.row === 2) w *= 1 - 0.8 * smarts;
      else w *= 1 + 0.5 * smarts * (edge > 0.5 ? 1 : 0);
    } else {
      // 존에서 너무 먼 공은 뻔한 볼 → 가까운 칸 선호
      w *= 1 + smarts * (edge < 1.2 ? 0.8 : 0);
    }
    for (const p of recent) {
      if (Math.hypot(p.target.x - c.center.x, p.target.y - c.center.y) < 0.2) w *= 1 - 0.5 * smarts;
    }
    cellWeights[String(i)] = Math.max(0.05, w);
  });
  const chosen: GridCell = pool[Number(weightedPick(cellWeights, rng))]!;
  return { pitchType, target: chosen.center };
}

/** 컴퓨터 투수의 제구 게이지 정확도(0~1) */
export function aiGauge(level: AiLevel, rng: Rng): number {
  const p = AI_PROFILES[level];
  return clamp01(p.gaugeMean + (rng() - 0.5) * 2 * p.gaugeJitter);
}

/** 눈으로 본 위치와 카운트로 스윙 여부를 정한다 (밸런스 시뮬레이션과 컴퓨터 타자가 공유) */
export function decideSwing(
  seen: Location,
  strikes: number,
  opts: { takeRate: number; chaseRate: number },
  rng: Rng,
): boolean {
  const twoStrikes = strikes === 2;
  const seenIn = Math.abs(seen.x) <= 1 && Math.abs(seen.y) <= 1;
  const seenNear = Math.abs(seen.x) <= 1.4 && Math.abs(seen.y) <= 1.4;
  if (seenIn) return twoStrikes || rng() >= opts.takeRate;
  return seenNear && rng() < (twoStrikes ? opts.chaseRate * 2 : opts.chaseRate);
}

/** 컴퓨터 타자: 날아오는 공을 눈으로 보고(오차 있음) 스윙 여부와 타이밍을 정한다 */
export function aiBatterAction(
  actual: Location,
  strikes: number,
  level: AiLevel,
  rng: Rng,
): BatterAction {
  const p = AI_PROFILES[level];
  const seen = { x: actual.x + gaussian(rng) * p.eyeNoise, y: actual.y + gaussian(rng) * p.eyeNoise };
  const swing = decideSwing(seen, strikes, p, rng);
  return { swing, timingMs: swing ? gaussian(rng) * p.timingSigmaMs : 0 };
}
