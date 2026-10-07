import { applyPitch, newGame } from './game';
import {
  AVERAGE_BATTER,
  AVERAGE_PITCHER,
  PITCH_TYPES,
  isInZone,
  resolvePitch,
  throwLocation,
  DEFAULT_PITCH_PARAMS,
  type BatterAction,
  type BatterStats,
  type Location,
  type PitchParams,
  type PitchThrow,
  type PitcherStats,
  type PitchType,
} from './pitch';
import { DEFAULT_AUTO_RUN_PARAMS } from './autoRun';
import { gaussian } from './rng';
import type { AutoRunParams, PlateResult, Rng } from './types';

/**
 * 밸런스 검증용 기본 정책. 실제 AI(M4)와는 별개로, 판정 엔진의 수치를 점검하기 위한 단순한 투수/타자 모델이다.
 */
export interface SimOptions {
  plateAppearances: number;
  pitcher?: PitcherStats;
  batter?: BatterStats;
  /** 타자의 타이밍 오차 표준편차(ms). 작을수록 숙련 */
  timingSigmaMs?: number;
  /** 타자가 구종을 맞게 예측할 확률. undefined면 예측하지 않음 */
  guessAccuracy?: number;
  /** 투수 게이지 평균 정확도(0~1) */
  gaugeMean?: number;
  /** 존 안을 노리는 투구 비율 */
  zoneRate?: number;
  /** 2스트라이크 전에 존 안 공을 그냥 지켜보는 확률 (타석 길이를 만든다) */
  takeRate?: number;
  /** 존 밖(근처) 공에 헛스윙 유도당해 휘두르는 확률 */
  chaseRate?: number;
  pitchParams?: PitchParams;
  autoRunParams?: AutoRunParams;
}

export interface SimStats {
  plateAppearances: number;
  pitches: number;
  /** 결과별 횟수 */
  counts: Record<PlateResult, number>;
  /** 투구 통계 */
  swingRate: number;
  zoneRate: number;
  contactRate: number;
  /** 계산 지표 */
  avg: number;
  obp: number;
  slg: number;
  kRate: number;
  bbRate: number;
  hrRate: number;
  pitchesPerPA: number;
}

const ALL_RESULTS: PlateResult[] = [
  'strikeout', 'walk', 'single', 'double', 'triple', 'homeRun',
  'groundOut', 'doublePlay', 'lineOut', 'flyOut', 'popOut', 'sacrificeFly',
];

function pickTarget(zoneRate: number, rng: Rng): Location {
  if (rng() < zoneRate) return { x: (rng() * 2 - 1) * 0.9, y: (rng() * 2 - 1) * 0.9 };
  // 존 바깥 (경계 바로 밖 ~ 1.7까지)
  for (;;) {
    const l = { x: (rng() * 2 - 1) * 1.7, y: (rng() * 2 - 1) * 1.7 };
    if (Math.abs(l.x) > 1.05 || Math.abs(l.y) > 1.05) return l;
  }
}

/** 단일 타석(주자 없음, 0아웃에서 시작)을 끝까지 시뮬레이션한다 */
export function simulatePlateAppearance(
  opts: SimOptions,
  rng: Rng,
  tally?: { pitches: number; swings: number; inZone: number; contacts: number },
): PlateResult {
  const pitcher = opts.pitcher ?? AVERAGE_PITCHER;
  const batter = opts.batter ?? AVERAGE_BATTER;
  const pp = opts.pitchParams ?? DEFAULT_PITCH_PARAMS;
  const ap = opts.autoRunParams ?? DEFAULT_AUTO_RUN_PARAMS;
  const sigma = opts.timingSigmaMs ?? 40;
  const gaugeMean = opts.gaugeMean ?? 0.7;
  const zoneRate = opts.zoneRate ?? 0.6;
  const takeRate = opts.takeRate ?? 0.3;
  const chaseRate = opts.chaseRate ?? 0.25;

  let state = newGame();
  for (;;) {
    const pitchType = PITCH_TYPES[Math.floor(rng() * PITCH_TYPES.length)]!;
    const gauge = Math.min(1, Math.max(0, gaugeMean + (rng() - 0.5) * 0.5));
    const pitch: PitchThrow = { pitchType, target: pickTarget(zoneRate, rng), gauge };

    // 타자: 투구 위치를 눈으로 보고(오차 있음) 스윙 여부를 정한다
    const seen: Location = pitchLocationSeen(pitch, pitcher, batter, rng, pp);
    const twoStrikes = state.strikes === 2;
    const seenIn = Math.abs(seen.x) <= 1 && Math.abs(seen.y) <= 1;
    const seenNear = Math.abs(seen.x) <= 1.4 && Math.abs(seen.y) <= 1.4;
    const swing = seenIn
      ? twoStrikes || rng() >= takeRate
      : seenNear && rng() < (twoStrikes ? chaseRate * 2 : chaseRate);

    const action: BatterAction = { swing, timingMs: gaussian(rng) * sigma };
    if (opts.guessAccuracy !== undefined) {
      const right = rng() < opts.guessAccuracy;
      const others = PITCH_TYPES.filter((t) => t !== pitchType);
      action.guess = { pitchType: right ? pitchType : others[Math.floor(rng() * others.length)]! };
    }

    const detail = resolvePitch(pitch, action, pitcher, batter, rng, pp);
    if (tally) {
      tally.pitches++;
      if (isInZone(detail.actual)) tally.inZone++;
      if (swing) {
        tally.swings++;
        if (detail.event.type !== 'strike') tally.contacts++;
      }
    }
    const out = applyPitch(state, detail.event, rng, ap);
    if (out.result) return out.result;
    state = out.state;
  }
}

/**
 * 타자가 보는 투구 위치. 실제 위치를 resolvePitch 안에서 다시 뽑으므로 여기서는 같은 분포의 독립 표본에
 * 시각 오차(eye)를 더한 근사치를 쓴다. 정책 판단용이므로 정확히 같을 필요는 없다.
 */
function pitchLocationSeen(
  pitch: PitchThrow,
  pitcher: PitcherStats,
  batter: BatterStats,
  rng: Rng,
  pp: PitchParams,
): Location {
  const l = throwLocation(pitch, pitcher, rng, pp);
  const noise = 0.3 * (1.2 - batter.eye);
  return { x: l.x + gaussian(rng) * noise, y: l.y + gaussian(rng) * noise };
}

export function simulate(opts: SimOptions, rng: Rng): SimStats {
  const counts = Object.fromEntries(ALL_RESULTS.map((r) => [r, 0])) as Record<PlateResult, number>;
  const tally = { pitches: 0, swings: 0, inZone: 0, contacts: 0 };
  for (let i = 0; i < opts.plateAppearances; i++) {
    counts[simulatePlateAppearance(opts, rng, tally)]++;
  }
  const pa = opts.plateAppearances;
  const hits = counts.single + counts.double + counts.triple + counts.homeRun;
  // 타수: 볼넷·희생플라이 제외
  const ab = pa - counts.walk - counts.sacrificeFly;
  const totalBases = counts.single + 2 * counts.double + 3 * counts.triple + 4 * counts.homeRun;
  return {
    plateAppearances: pa,
    pitches: tally.pitches,
    counts,
    swingRate: tally.swings / tally.pitches,
    zoneRate: tally.inZone / tally.pitches,
    contactRate: tally.swings ? tally.contacts / tally.swings : 0,
    avg: hits / ab,
    obp: (hits + counts.walk) / pa,
    slg: totalBases / ab,
    kRate: counts.strikeout / pa,
    bbRate: counts.walk / pa,
    hrRate: counts.homeRun / pa,
    pitchesPerPA: tally.pitches / pa,
  };
}
