import type { Location, PitchType } from '@baseball/core';

/**
 * 존 좌표(중앙 0,0 / 경계 ±1) ↔ 화면 좌표 변환. 포수 뒤에서 본 고정 카메라.
 * 존의 폭은 홈플레이트 폭(17인치)과 같고, 높이는 약 24인치(폭의 1.41배)라 가로·세로 배율이 다르다.
 */
export const ZONE_CENTER = { x: 270, y: 470 };
export const ZONE_SCALE_X = 60;
export const ZONE_SCALE_Y = 84;
/** 홈플레이트 높이에서 1인치가 차지하는 픽셀 */
export const PX_PER_INCH = (ZONE_SCALE_X * 2) / 17;
/** 홈플레이트(바닥) 깊이의 화면 y. 존 아래쪽(무릎, 바닥에서 약 18인치) 아래에 있다 */
export const GROUND_Y = 682;
/** 투수가 공을 놓는 지점(마운드 위, 화면상 작게 보임) */
export const RELEASE_POINT = { x: 270, y: 272 };

// ───── 3D → 화면 투영 ─────
// 카메라는 홈플레이트 뒤쪽 위에서 투수 쪽을 수평으로 본다. 월드 좌표(m): x=오른쪽(1루), y=투수 쪽, z=위, 원점=홈플레이트 중앙 바닥.
// 홈플레이트(폭 0.432m)가 존 폭(120px)과 같도록 초점거리를 잡는다.
export const PLATE_WIDTH_M = 0.432;
export const PX_PER_M = (ZONE_SCALE_X * 2) / PLATE_WIDTH_M;
export const CAM_HEIGHT_M = 1.6;
export const CAM_BEHIND_M = 5.05;
export const FOCAL_PX = PX_PER_M * CAM_BEHIND_M;
export const HORIZON_Y = GROUND_Y - PX_PER_M * CAM_HEIGHT_M;

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** 월드 좌표 → 화면 좌표. scale은 그 지점에서 1m가 차지하는 픽셀 */
export function project(p: Point3) {
  const depth = p.y + CAM_BEHIND_M;
  return {
    x: ZONE_CENTER.x + (FOCAL_PX * p.x) / depth,
    y: HORIZON_Y + (FOCAL_PX * (CAM_HEIGHT_M - p.z)) / depth,
    scale: FOCAL_PX / depth,
  };
}

/** 존 좌표(±1이 존 경계) → 홈플레이트 위 공간의 월드 좌표. 존 높이는 약 0.46~1.07m */
export const ZONE_CENTER_Z_M = 0.76;
export const ZONE_HALF_HEIGHT_M = 0.305;
export const zoneToWorld = (l: Location): Point3 => ({
  x: (l.x * PLATE_WIDTH_M) / 2,
  y: 0.05,
  z: ZONE_CENTER_Z_M + l.y * ZONE_HALF_HEIGHT_M,
});

export const toScreen = (l: Location) => ({
  x: ZONE_CENTER.x + l.x * ZONE_SCALE_X,
  y: ZONE_CENTER.y - l.y * ZONE_SCALE_Y,
});

export { GRID_EDGES, gridCells, type GridCell } from '@baseball/core';

/** 공이 날아오는 시간(ms). 느린 구종일수록 오래 걸린다 */
export const flightMs = (speedKmh: number) => 520 + (150 - speedKmh) * 8;

/** 변화구의 눈속임: 공이 처음엔 이 오프셋만큼 벗어난 곳을 향하다 막판에 실제 위치로 꺾인다 */
export const BREAK_OFFSET: Record<PitchType, Location> = {
  fastball: { x: 0, y: -0.35 },
  slider: { x: 0.9, y: 0.2 },
  curve: { x: 0.2, y: 0.9 },
  changeup: { x: 0, y: -0.15 },
};

/** t(0~1) 시점의 공 화면 위치와 반지름 */
export function ballAt(t: number, actual: Location, type: PitchType) {
  const c = Math.min(1, Math.max(0, t));
  const off = BREAK_OFFSET[type];
  const k = 1 - Math.pow(c, 2.5);
  const target = toScreen({ x: actual.x + off.x * k, y: actual.y + off.y * k });
  return {
    x: RELEASE_POINT.x + (target.x - RELEASE_POINT.x) * c,
    y: RELEASE_POINT.y + (target.y - RELEASE_POINT.y) * c,
    r: 2 + 8 * c * c,
  };
}

/** 게이지 위치(0~1, 0.5가 정중앙) → 제구 정확도(0~1) */
export const gaugeAccuracy = (pos: number) => Math.max(0, 1 - Math.abs(pos - 0.5) * 2);

/** 시간(ms)에 따라 0→1→0으로 왕복하는 게이지 위치 */
export function gaugePosition(elapsedMs: number, periodMs = 1400) {
  const p = (elapsedMs % periodMs) / periodMs;
  return p < 0.5 ? p * 2 : 2 - p * 2;
}
