import type { AiLevel, BattedBallKind, BattedBallQuality, Half, PitchType, PlateResult, Team } from '@baseball/core';

/** 모든 화면 문자열은 여기서 관리한다 (추후 다국어 확장 지점) */
export const ko = {
  title: '투타 대전 야구',
  subtitle: '컴퓨터와 겨루는 투수 vs 타자 승부',
  team: { away: '원정', home: '홈' } satisfies Record<Team, string>,
  half: { top: '초', bottom: '말' } satisfies Record<Half, string>,
  inning: (n: number) => `${n}회`,
  innings: (n: number) => `${n}이닝 경기`,
  gameOver: '경기 종료',
  winner: (w: Team | 'draw') => (w === 'draw' ? '무승부' : `${ko.team[w]} 승리!`),
  again: '다시 하기',
  toTitle: '처음으로',

  pitchType: {
    fastball: '직구',
    slider: '슬라이더',
    curve: '커브',
    changeup: '체인지업',
  } satisfies Record<PitchType, string>,

  level: { easy: '쉬움', normal: '보통', hard: '어려움' } satisfies Record<AiLevel, string>,
  levelLabel: '컴퓨터 난이도',
  sideLabel: '내 팀',
  side: { away: '원정 (선공)', home: '홈 (후공)' } satisfies Record<Team, string>,
  start: (n: number) => `${n}이닝 경기 시작`,

  role: {
    pitcher: (team: Team) => `내가 투수 (${ko.team[team]})`,
    batter: (team: Team) => `내가 타자 (${ko.team[team]})`,
  },
  pitcherHint: '구종을 고르고 코스를 터치하면 바로 게이지가 움직여요',
  pitcherGauge: '가운데에서 멈출수록 정확해요! (스페이스바도 가능)',
  gaugeLabel: '제구 게이지',
  stopBtn: '정지!',
  waitCourse: '코스를 고르세요',
  batterHint: '컴퓨터 투수가 던집니다',
  getReady: '준비...',
  swingHint: '공이 도착하는 순간 화면을 터치해 스윙! (스페이스바도 가능)',
  youWin: '승리!',
  youLose: '패배...',
  draw: '무승부',

  early: '빠름',
  late: '늦음',
  timing: (ms: number) => {
    const a = Math.abs(Math.round(ms));
    if (a <= 15) return '완벽한 타이밍!';
    return ms < 0 ? `${a}ms 빨랐다` : `${a}ms 늦었다`;
  },
  noSwing: '스윙 안 함',

  ball: '볼',
  strikeLooking: '스트라이크 (루킹)',
  strikeSwinging: '헛스윙 스트라이크',
  foul: '파울',
  strikeoutLooking: '루킹',
  strikeoutSwinging: '헛스윙',
  pitchInfo: (t: PitchType, speed: number) => `${ko.pitchType[t]} ${speed}km/h`,

  kind: {
    ground: '땅볼',
    line: '라인드라이브',
    fly: '뜬공',
    popup: '내야 플라이',
  } satisfies Record<BattedBallKind, string>,
  quality: { weak: '약한', normal: '', hard: '강한' } satisfies Record<BattedBallQuality, string>,
  result: {
    strikeout: '삼진',
    walk: '볼넷',
    single: '안타!',
    double: '2루타!',
    triple: '3루타!!',
    homeRun: '홈런!!!',
    groundOut: '아웃',
    doublePlay: '병살타',
    lineOut: '아웃',
    flyOut: '아웃',
    popOut: '아웃',
    sacrificeFly: '희생플라이',
  } satisfies Record<PlateResult, string>,
  runs: (n: number) => (n > 0 ? ` ${n}점 득점` : ''),
};
