import { describe, expect, it } from 'vitest';
import { isInZone, PITCH_TYPES, DEFAULT_PITCH_PARAMS } from '@baseball/core';
import {
  BREAK_OFFSET,
  ZONE_CENTER,
  GROUND_Y,
  PX_PER_INCH,
  ZONE_SCALE_X,
  project,
  zoneToWorld,
  ZONE_SCALE_Y,
  ballWorldAt,
  RELEASE_WORLD,
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
  it('존 아래쪽은 바닥에서 20~30인치 위', () => {
    const zoneBottom = ZONE_CENTER.y + ZONE_SCALE_Y;
    expect((GROUND_Y - zoneBottom) / PX_PER_INCH).toBeGreaterThan(20);
    expect((GROUND_Y - zoneBottom) / PX_PER_INCH).toBeLessThan(30);
  });
  it('존이 마운드(투수) 높이에 겹쳐 보인다', () => {
    const mound = project({ x: 0, y: 18.44, z: 0 });
    expect(Math.abs(mound.y - ZONE_CENTER.y)).toBeLessThan(ZONE_SCALE_Y);
    expect(Math.abs(mound.x - ZONE_CENTER.x)).toBeLessThan(ZONE_SCALE_X * 2);
  });
});

describe('3D 투영', () => {
  it('홈플레이트 중앙 바닥은 GROUND_Y, 폭은 존 폭', () => {
    const c = project({ x: 0, y: 0, z: 0 });
    expect(c.x).toBeCloseTo(ZONE_CENTER.x);
    expect(c.y).toBeCloseTo(GROUND_Y);
    const edge = project({ x: 0.216, y: 0, z: 0 });
    expect((edge.x - c.x) * 2).toBeCloseTo(ZONE_SCALE_X * 2, 0);
  });
  it('존 좌표를 월드로 보냈다가 투영하면 화면 존 위치와 거의 같다', () => {
    for (const l of [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: -1, y: -1 }]) {
      const p = project(zoneToWorld(l));
      const s = toScreen(l);
      expect(Math.abs(p.x - s.x)).toBeLessThan(4);
      expect(Math.abs(p.y - s.y)).toBeLessThan(6);
    }
  });
  it('멀리 있을수록 작고 위쪽(수평선 쪽)에 보인다', () => {
    const near = project({ x: 0, y: 0, z: 0 });
    const far = project({ x: 0, y: 18.44, z: 0 });
    expect(far.scale).toBeLessThan(near.scale);
    expect(far.y).toBeLessThan(near.y);
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
  it('도착 시점(t=1)에는 변화구도 실제 위치(홈플레이트 위)에 정확히 도달한다', () => {
    for (const type of PITCH_TYPES) {
      const actual = { x: 0.3, y: -0.2 };
      const p = ballWorldAt(1, actual, type);
      const dest = zoneToWorld(actual);
      expect(p.x).toBeCloseTo(dest.x, 6);
      expect(p.y).toBeCloseTo(dest.y, 6);
      expect(p.z).toBeCloseTo(dest.z, 6);
    }
  });
  it('출발점은 투수의 릴리스 지점', () => {
    const p = ballWorldAt(0, { x: 0, y: 0 }, 'fastball');
    expect(p.x).toBeCloseTo(RELEASE_WORLD.x);
    expect(p.y).toBeCloseTo(RELEASE_WORLD.y);
    expect(p.z).toBeCloseTo(RELEASE_WORLD.z);
  });
  it('초반에는 오프셋 방향으로 벗어나 날아온다(눈속임): 커브는 높게 시작해 떨어진다', () => {
    const actual = { x: 0, y: 0 };
    const curve = ballWorldAt(0.5, actual, 'curve');
    const change = ballWorldAt(0.5, actual, 'changeup');
    expect(Object.keys(BREAK_OFFSET)).toHaveLength(4);
    expect(curve.z).toBeGreaterThan(change.z);
  });
  it('공은 투수에서 홈플레이트로 다가온다', () => {
    expect(ballWorldAt(0.8, { x: 0, y: 0 }, 'fastball').y).toBeLessThan(ballWorldAt(0.2, { x: 0, y: 0 }, 'fastball').y);
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
