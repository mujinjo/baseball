import type { BattedBallKind, BattedBallQuality, Half, PitchType, PlateResult, Team } from '@baseball/core';

/** 모든 화면 문자열은 여기서 관리한다 (추후 다국어 확장 지점) */
export const ko = {
  title: '투타 대전 야구',
  subtitle: '한 기기로 둘이서 하는 투수 vs 타자 승부',
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

  role: {
    pitcher: (team: Team) => `투수 (${ko.team[team]})`,
    batter: (team: Team) => `타자 (${ko.team[team]})`,
  },
  pitcherHint: '구종과 코스를 고르고 투구하세요',
  pitcherTarget: '코스를 터치하세요 (안쪽 9칸이 스트라이크)',
  pickPitchFirst: '구종을 먼저 고르세요',
  throwBtn: '투구 게이지 시작',
  stopBtn: '정지! (가운데에 맞출수록 정확)',
  gaugeLabel: '제구 게이지',

  handoffToBatter: (team: Team) => `${ko.team[team]} 타자에게 기기를 넘겨주세요`,
  handoffToPitcher: (team: Team) => `${ko.team[team]} 투수에게 기기를 넘겨주세요`,
  tapWhenReady: '준비되면 화면을 터치',

  batterHint: '구종/코스를 예측해 보세요 (선택)',
  guessType: '구종 예측',
  guessCell: '코스 예측: 표에서 한 칸을 터치',
  noGuess: '예측 없음',
  readyBtn: '타격 준비!',
  getReady: '준비...',
  swingHint: '공이 도착하는 순간 화면을 터치해 스윙!',

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
