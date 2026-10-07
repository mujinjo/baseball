import { resolveInPlay, resolveWalk, DEFAULT_AUTO_RUN_PARAMS } from './autoRun';
import type {
  AutoRunParams,
  GameConfig,
  GameState,
  PitchEvent,
  PitchOutcome,
  PlateResult,
  Rng,
  Team,
} from './types';

export const DEFAULT_CONFIG: GameConfig = { innings: 9, maxExtraInnings: 3 };

export function newGame(config: Partial<GameConfig> = {}): GameState {
  return {
    config: { ...DEFAULT_CONFIG, ...config },
    inning: 1,
    half: 'top',
    outs: 0,
    balls: 0,
    strikes: 0,
    bases: [false, false, false],
    score: { away: 0, home: 0 },
    status: 'playing',
    winner: null,
  };
}

export const battingTeam = (state: GameState): Team => (state.half === 'top' ? 'away' : 'home');
export const fieldingTeam = (state: GameState): Team => (state.half === 'top' ? 'home' : 'away');

/**
 * 투구 결과 하나를 적용해 새 상태를 돌려준다 (입력 상태는 변경하지 않음).
 * 타석 종료 시 카운트 초기화, 3아웃 시 초/말 교대, 경기 종료 판정까지 처리한다.
 */
export function applyPitch(
  prev: GameState,
  event: PitchEvent,
  rng: Rng,
  params: AutoRunParams = DEFAULT_AUTO_RUN_PARAMS,
): PitchOutcome {
  if (prev.status === 'finished') throw new Error('이미 종료된 경기입니다');

  const state: GameState = {
    ...prev,
    bases: [...prev.bases],
    score: { ...prev.score },
  };
  let result: PlateResult | null = null;
  let runs = 0;
  let outsAdded = 0;

  switch (event.type) {
    case 'ball':
      state.balls += 1;
      if (state.balls >= 4) {
        const walk = resolveWalk(state.bases);
        state.bases = walk.bases;
        runs = walk.runs;
        result = 'walk';
      }
      break;

    case 'strike':
      state.strikes += 1;
      if (state.strikes >= 3) {
        outsAdded = 1;
        result = 'strikeout';
      }
      break;

    case 'foul':
      if (state.strikes < 2) state.strikes += 1;
      break;

    case 'inPlay': {
      const r = resolveInPlay(state.bases, state.outs, event.kind, event.quality, rng, params);
      state.bases = r.bases;
      runs = r.runs;
      outsAdded = r.outsAdded;
      result = r.result;
      break;
    }
  }

  state.outs += outsAdded;
  state.score[battingTeam(state)] += runs;

  let halfInningEnded = false;
  if (result !== null) {
    state.balls = 0;
    state.strikes = 0;
    if (isWalkOff(state)) {
      finish(state);
    } else if (state.outs >= 3) {
      halfInningEnded = true;
      endHalfInning(state);
    }
  }

  return { state, result, runs, outsAdded, halfInningEnded };
}

/** 마지막 이닝 이후 말 공격에서 홈팀이 역전/리드를 잡는 순간 즉시 종료 */
function isWalkOff(state: GameState): boolean {
  return (
    state.half === 'bottom' &&
    state.inning >= state.config.innings &&
    state.score.home > state.score.away
  );
}

function finish(state: GameState): void {
  state.status = 'finished';
  const { home, away } = state.score;
  state.winner = home > away ? 'home' : away > home ? 'away' : 'draw';
}

function endHalfInning(state: GameState): void {
  const lastRegular = state.inning >= state.config.innings;
  state.outs = 0;
  state.bases = [false, false, false];

  if (state.half === 'top') {
    // 마지막 이닝 초가 끝났을 때 홈팀이 앞서면 말 공격 생략
    if (lastRegular && state.score.home > state.score.away) {
      finish(state);
      return;
    }
    state.half = 'bottom';
    return;
  }

  // 말 종료
  if (lastRegular && state.score.home !== state.score.away) {
    finish(state);
    return;
  }
  if (state.inning >= state.config.innings + state.config.maxExtraInnings) {
    finish(state);
    return;
  }
  state.inning += 1;
  state.half = 'top';
}
