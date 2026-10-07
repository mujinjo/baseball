export type Team = 'away' | 'home';
/** top = 초(원정 공격), bottom = 말(홈 공격) */
export type Half = 'top' | 'bottom';
/** [1루, 2루, 3루] 주자 유무 */
export type Bases = [boolean, boolean, boolean];

export interface GameConfig {
  /** 정규 이닝 수 (기본 9, 단축 모드 3) */
  innings: number;
  /** 정규 이닝 후 동점일 때 허용하는 연장 이닝 수. 소진 후에도 동점이면 무승부 */
  maxExtraInnings: number;
}

export interface GameState {
  config: GameConfig;
  inning: number;
  half: Half;
  outs: number;
  balls: number;
  strikes: number;
  bases: Bases;
  score: Record<Team, number>;
  status: 'playing' | 'finished';
  winner: Team | 'draw' | null;
}

export type BattedBallKind = 'ground' | 'line' | 'fly' | 'popup';
export type BattedBallQuality = 'weak' | 'normal' | 'hard';

/** 투구 한 번의 결과 (판정 엔진이 만들어 상태머신에 넘긴다) */
export type PitchEvent =
  | { type: 'ball' }
  | { type: 'strike'; swinging: boolean }
  | { type: 'foul' }
  | { type: 'inPlay'; kind: BattedBallKind; quality: BattedBallQuality };

/** 타석이 끝났을 때의 결과 */
export type PlateResult =
  | 'strikeout'
  | 'walk'
  | 'single'
  | 'double'
  | 'triple'
  | 'homeRun'
  | 'groundOut'
  | 'doublePlay'
  | 'lineOut'
  | 'flyOut'
  | 'popOut'
  | 'sacrificeFly';

export interface PitchOutcome {
  state: GameState;
  /** 타석이 계속되면 null */
  result: PlateResult | null;
  /** 이번 투구로 들어온 점수 */
  runs: number;
  /** 이번 투구로 늘어난 아웃 수 */
  outsAdded: number;
  /** 이닝(초/말)이 바뀌었는지 */
  halfInningEnded: boolean;
}

export type Rng = () => number;

export type HitOrOut = 'out' | 'single' | 'double' | 'triple' | 'homeRun';

export interface AutoRunParams {
  /** 타구 종류×질별 결과 가중치 (합이 1일 필요는 없음) */
  batted: Record<BattedBallKind, Record<BattedBallQuality, Partial<Record<HitOrOut, number>>>>;
  /** 무사 + 1루 주자 + 땅볼 아웃일 때 병살 확률 */
  doublePlayChance: number;
  /** 땅볼 아웃 시 강제 진루가 아닌 주자가 한 베이스 진루할 확률 */
  groundOutAdvance: number;
  /** 뜬공 아웃 시 3루 주자 태그업 득점 확률 (2사 미만) */
  sacFlyChance: Record<BattedBallQuality, number>;
  /** 단타 시 2루 주자 홈 득점 확률 */
  secondScoresOnSingle: Record<BattedBallQuality, number>;
  /** 단타 시 1루 주자가 3루까지 갈 확률 */
  firstToThirdOnSingle: Record<BattedBallQuality, number>;
  /** 2루타 시 1루 주자 홈 득점 확률 */
  firstScoresOnDouble: Record<BattedBallQuality, number>;
}
