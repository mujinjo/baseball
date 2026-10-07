import type { Half, PlateResult, Team } from '@baseball/core';

/** 모든 화면 문자열은 여기서 관리한다 (추후 다국어 확장 지점) */
export const ko = {
  title: '투타 대전 야구',
  hint: '화면을 눌러 임의 투구 시뮬레이션 (M0/M1 데모)',
  team: { away: '원정', home: '홈' } satisfies Record<Team, string>,
  half: { top: '초', bottom: '말' } satisfies Record<Half, string>,
  inning: (n: number) => `${n}회`,
  count: (b: number, s: number, o: number) => `${b}B ${s}S ${o}아웃`,
  gameOver: '경기 종료',
  winner: (w: Team | 'draw') => (w === 'draw' ? '무승부' : `${ko.team[w]} 승리`),
  result: {
    strikeout: '삼진',
    walk: '볼넷',
    single: '단타',
    double: '2루타',
    triple: '3루타',
    homeRun: '홈런',
    groundOut: '땅볼 아웃',
    doublePlay: '병살타',
    lineOut: '라인드라이브 아웃',
    flyOut: '뜬공 아웃',
    popOut: '내야 플라이 아웃',
    sacrificeFly: '희생플라이',
  } satisfies Record<PlateResult, string>,
  runs: (n: number) => (n > 0 ? ` (${n}점)` : ''),
};
