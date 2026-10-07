import { describe, expect, it } from 'vitest';
import { isInZone, PITCH_TYPES, DEFAULT_PITCH_PARAMS } from '@baseball/core';
import {
  BREAK_OFFSET,
  ZONE_CENTER,
  GROUND_Y,
  PX_PER_INCH,
  ZONE_SCALE_X,
  ZONE_SCALE_Y,
  ballAt,
  flightMs,
  gaugeAccuracy,
  gaugePosition,
  gridCells,
  toScreen,
} from '../src/game/geometry';
import { describeOutcome } from '../src/game/messages';

describe('좌표 변환', () => {
  it('존 중앙은 화면의 존 중심, 위쪽(+y)은 화면 위쪽', () => {
    expect(toScreen({ x: 0, y: 0 })).toEqual(ZONE_CENTER);
    expect(toScreen({ x: 0, y: 1 }).y).toBe(ZONE_CENTER.y - ZONE_SCALE_Y);
    expect(toScreen({ x: 1, y: 0 }).x).toBe(ZONE_CENTER.x + ZONE_SCALE_X);
  });
});

describe('실제 비율', () => {
  it('존 폭은 홈플레이트 폭(17인치)이고 높이는 폭보다 크다', () => {
    expect(PX_PER_INCH * 17).toBeCloseTo(ZONE_SCALE_X * 2);
    expect(ZONE_SCALE_Y).toBeGreaterThan(ZONE_SCALE_X);
  });
  it('존 아래쪽은 바닥에서 약 20인치 위', () => {
    const zoneBottom = ZONE_CENTER.y + ZONE_SCALE_Y;
    expect((GROUND_Y - zoneBottom) / PX_PER_INCH).toBeGreaterThan(17);
    expect((GROUND_Y - zoneBottom) / PX_PER_INCH).toBeLessThan(24);
  });
});

describe('5×5 코스 격자', () => {
  const cells = gridCells();
  it('25칸, 스트라이크존은 안쪽 9칸', () => {
    expect(cells).toHaveLength(25);
    expect(cells.filter((c) => c.inZone)).toHaveLength(9);
  });
  it('칸의 inZone 표시가 core의 존 판정과 일치한다', () => {
    for (const c of cells) expect(isInZone(c.center)).toBe(c.inZone);
  });
  it('맨 윗줄(row 0)이 가장 높은 공', () => {
    const top = cells.find((c) => c.row === 0)!;
    const bottom = cells.find((c) => c.row === 4)!;
    expect(top.center.y).toBeGreaterThan(bottom.center.y);
  });
});

describe('비행', () => {
  it('느린 구종일수록 오래 날아온다', () => {
    const t = (name: (typeof PITCH_TYPES)[number]) => flightMs(DEFAULT_PITCH_PARAMS.types[name].speed);
    expect(t('fastball')).toBeLessThan(t('slider'));
    expect(t('slider')).toBeLessThan(t('changeup'));
    expect(t('changeup')).toBeLessThan(t('curve'));
  });
  it('직구는 0.6초 안에 도착할 만큼 빠르다', () => {
    expect(flightMs(DEFAULT_PITCH_PARAMS.types.fastball.speed)).toBeLessThan(600);
  });
  it('도착 시점(t=1)에는 변화구도 실제 위치에 정확히 도달한다', () => {
    for (const type of PITCH_TYPES) {
      const actual = { x: 0.3, y: -0.2 };
      const p = ballAt(1, actual, type);
      const dest = toScreen(actual);
      expect(p.x).toBeCloseTo(dest.x, 6);
      expect(p.y).toBeCloseTo(dest.y, 6);
    }
  });
  it('초반에는 오프셋 방향으로 벗어나 날아온다(눈속임)', () => {
    const actual = { x: 0, y: 0 };
    const early = ballAt(0.5, actual, 'curve');
    const straight = ballAt(0.5, actual, 'changeup');
    expect(Object.keys(BREAK_OFFSET)).toHaveLength(4);
    expect(early.y).toBeLessThan(straight.y); // 커브는 높게(화면 위쪽)에서 떨어진다
  });
  it('공은 가까워질수록 커진다', () => {
    expect(ballAt(1, { x: 0, y: 0 }, 'fastball').r).toBeGreaterThan(ballAt(0.1, { x: 0, y: 0 }, 'fastball').r);
  });
});

describe('제구 게이지', () => {
  it('정중앙이 최고 정확도, 양 끝이 0', () => {
    expect(gaugeAccuracy(0.5)).toBe(1);
    expect(gaugeAccuracy(0)).toBe(0);
    expect(gaugeAccuracy(1)).toBe(0);
    expect(gaugeAccuracy(0.4)).toBeCloseTo(0.8);
  });
  it('0→1→0 왕복한다', () => {
    expect(gaugePosition(0)).toBe(0);
    expect(gaugePosition(700)).toBeCloseTo(1);
    expect(gaugePosition(1400)).toBeCloseTo(0);
    expect(gaugePosition(350)).toBeCloseTo(0.5);
  });
});

describe('결과 문구', () => {
  it('볼/스트라이크/삼진/볼넷/홈런', () => {
    expect(describeOutcome({ type: 'ball' }, null, 0).title).toBe('볼');
    expect(describeOutcome({ type: 'strike', swinging: true }, null, 0).title).toBe('헛스윙 스트라이크');
    expect(describeOutcome({ type: 'strike', swinging: false }, 'strikeout', 0).title).toBe('삼진');
    expect(describeOutcome({ type: 'ball' }, 'walk', 1).sub).toBe('1점 득점');
    const hr = describeOutcome({ type: 'inPlay', kind: 'fly', quality: 'hard' }, 'homeRun', 2);
    expect(hr.title).toBe('홈런!!!');
    expect(hr.sub).toBe('강한 뜬공 2점 득점');
    const withDist = describeOutcome({ type: 'inPlay', kind: 'fly', quality: 'hard' }, 'homeRun', 1, 128);
    expect(withDist.sub).toBe('강한 뜬공 128m 1점 득점');
    expect(describeOutcome({ type: 'foul' }, null, 0, 54).sub).toBe('54m');
  });
});
