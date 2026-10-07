import defaultParams from './autoRun.json';
import { weightedPick } from './rng';
import type {
  AutoRunParams,
  Bases,
  BattedBallKind,
  BattedBallQuality,
  PlateResult,
  Rng,
} from './types';

export const DEFAULT_AUTO_RUN_PARAMS = defaultParams as AutoRunParams;

export interface RunResolution {
  result: PlateResult;
  bases: Bases;
  runs: number;
  outsAdded: number;
}

const count = (bases: Bases) => bases.filter(Boolean).length;

/** 볼넷: 강제 진루만 일어난다 */
export function resolveWalk(bases: Bases): { bases: Bases; runs: number } {
  const [b1, b2, b3] = bases;
  if (!b1) return { bases: [true, b2, b3], runs: 0 };
  if (!b2) return { bases: [true, true, b3], runs: 0 };
  if (!b3) return { bases: [true, true, true], runs: 0 };
  return { bases: [true, true, true], runs: 1 };
}

/**
 * 타구(종류+질)와 현재 주루/아웃 상황으로 결과·진루·득점·아웃을 자동 판정한다.
 * 단순화: 야수선택(타자 세이프, 주자 아웃)과 도루/폭투 등은 다루지 않는다.
 */
export function resolveInPlay(
  bases: Bases,
  outs: number,
  kind: BattedBallKind,
  quality: BattedBallQuality,
  rng: Rng,
  params: AutoRunParams = DEFAULT_AUTO_RUN_PARAMS,
): RunResolution {
  const [b1, b2, b3] = bases;
  const roll = (p: number) => rng() < p;
  const outcome = weightedPick(params.batted[kind][quality], rng);

  switch (outcome) {
    case 'homeRun':
      return { result: 'homeRun', bases: [false, false, false], runs: count(bases) + 1, outsAdded: 0 };

    case 'triple':
      return { result: 'triple', bases: [false, false, true], runs: count(bases), outsAdded: 0 };

    case 'double': {
      let runs = (b2 ? 1 : 0) + (b3 ? 1 : 0);
      let third = false;
      if (b1) {
        if (roll(params.firstScoresOnDouble[quality])) runs += 1;
        else third = true;
      }
      return { result: 'double', bases: [false, true, third], runs, outsAdded: 0 };
    }

    case 'single': {
      let runs = b3 ? 1 : 0;
      let second = false;
      let third = false;
      if (b2) {
        if (roll(params.secondScoresOnSingle[quality])) runs += 1;
        else third = true;
      }
      if (b1) {
        if (!third && roll(params.firstToThirdOnSingle[quality])) third = true;
        else second = true;
      }
      return { result: 'single', bases: [true, second, third], runs, outsAdded: 0 };
    }

    case 'out':
      return resolveOut(bases, outs, kind, quality, rng, params);
  }
}

function resolveOut(
  bases: Bases,
  outs: number,
  kind: BattedBallKind,
  quality: BattedBallQuality,
  rng: Rng,
  params: AutoRunParams,
): RunResolution {
  const [b1, b2, b3] = bases;
  const roll = (p: number) => rng() < p;
  const stay = (result: PlateResult, outsAdded = 1): RunResolution => ({
    result,
    bases,
    runs: 0,
    outsAdded,
  });

  if (kind === 'line') return stay('lineOut');
  if (kind === 'popup') return stay('popOut');

  if (kind === 'fly') {
    if (outs < 2 && b3 && roll(params.sacFlyChance[quality])) {
      return { result: 'sacrificeFly', bases: [b1, b2, false], runs: 1, outsAdded: 1 };
    }
    return stay('flyOut');
  }

  // 땅볼
  if (b1 && outs < 2 && roll(params.doublePlayChance)) {
    if (outs + 2 >= 3) {
      return { result: 'doublePlay', bases: [false, false, false], runs: 0, outsAdded: 2 };
    }
    // 무사 병살: 3루 주자 득점, 2루 주자 3루
    return { result: 'doublePlay', bases: [false, false, b2], runs: b3 ? 1 : 0, outsAdded: 2 };
  }

  if (outs + 1 >= 3) return stay('groundOut');

  // 타자 아웃. 강제 진루 + 비강제 주자는 확률 진루
  const forced2 = b1 && b2;
  const forced3 = b1 && b2 && b3;
  const next: Bases = [false, false, false];
  let runs = 0;
  if (b3) {
    if (forced3 || roll(params.groundOutAdvance)) runs += 1;
    else next[2] = true;
  }
  if (b2) {
    if (forced2 || (!next[2] && roll(params.groundOutAdvance))) next[2] = true;
    else next[1] = true;
  }
  if (b1) next[1] = true;
  return { result: 'groundOut', bases: next, runs, outsAdded: 1 };
}
