import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createGameCamera } from '../src/three/stage';
import { toV3 } from '../src/three/rigs';
import { twoBone } from '../src/three/humanoid';
import { project, toScreen, zoneToWorld } from '../src/game/geometry';

/** three.js 카메라로 투영한 화면 픽셀 */
function viaCamera(p: { x: number; y: number; z: number }) {
  const cam = createGameCamera();
  const v = toV3(p).project(cam);
  return { x: ((v.x + 1) / 2) * 540, y: ((1 - v.y) / 2) * 960 };
}

describe('three.js 카메라가 2D 투영(geometry.project)과 같다', () => {
  it('홈플레이트 주변·마운드·존 모서리의 화면 위치가 일치', () => {
    const pts = [
      { x: 0, y: 0, z: 0 },
      { x: 0.216, y: 0, z: 0 },
      { x: -0.8, y: -0.3, z: 1.4 },
      { x: 0, y: 18.44, z: 0 },
      { x: 0.3, y: 17, z: 1.9 },
      { x: 2, y: 105, z: 3 },
    ];
    for (const p of pts) {
      const a = project(p);
      const b = viaCamera(p);
      expect(Math.abs(a.x - b.x)).toBeLessThan(0.5);
      expect(Math.abs(a.y - b.y)).toBeLessThan(0.5);
    }
  });

  it('존 오버레이(toScreen)와 3D로 투영한 존 위치가 거의 같다', () => {
    for (const l of [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: -1, y: -1 }, { x: 1.7, y: 1.7 }]) {
      const o = toScreen(l);
      const c = viaCamera(zoneToWorld(l));
      expect(Math.abs(o.x - c.x)).toBeLessThan(6);
      expect(Math.abs(o.y - c.y)).toBeLessThan(8);
    }
  });
});

describe('좌표 변환과 보정', () => {
  it('월드(x, y=투수 쪽, z=위) → three(x, z, -y)', () => {
    const v = toV3({ x: 1, y: 2, z: 3 });
    expect([v.x, v.y, v.z]).toEqual([1, 3, -2]);
  });
  it('1루·3루 베이스는 이 카메라 시야 밖, 2루는 시야 안', () => {
    const inView = (p: { x: number; y: number; z: number }) => {
      const v = viaCamera(p);
      return v.x >= 0 && v.x <= 540 && v.y >= 0 && v.y <= 960;
    };
    expect(inView({ x: 19.4, y: 19.4, z: 0 })).toBe(false);
    expect(inView({ x: -19.4, y: 19.4, z: 0 })).toBe(false);
    expect(inView({ x: 0, y: 38.8, z: 0 })).toBe(true);
  });
  it('파울 라인은 홈에서 바깥(좌우)으로 벌어진다', () => {
    const near = viaCamera({ x: 2, y: 2, z: 0 });
    const far = viaCamera({ x: 8, y: 8, z: 0 });
    // 오른쪽 파울 라인: 멀어질수록 화면 오른쪽으로(소실점 기준 바깥쪽으로) 나간다
    expect(far.x).toBeGreaterThan(near.x);
    const leftNear = viaCamera({ x: -2, y: 2, z: 0 });
    const leftFar = viaCamera({ x: -8, y: 8, z: 0 });
    expect(leftFar.x).toBeLessThan(leftNear.x);
  });
});

describe('두 뼈 IK', () => {
  it('어깨-팔꿈치-손 길이가 유지되고 pole 쪽으로 굽는다', () => {
    const a = new THREE.Vector3(0, 0, 0);
    const target = new THREE.Vector3(0.4, -0.2, 0.1);
    const out = new THREE.Vector3();
    twoBone(a, target, 0.3, 0.28, new THREE.Vector3(0, -1, 0), out);
    expect(out.distanceTo(a)).toBeCloseTo(0.3, 5);
    expect(out.distanceTo(target)).toBeCloseTo(0.28, 5);
    const flat = a.clone().lerp(target, 0.5);
    expect(out.y).toBeLessThan(flat.y);
  });
  it('닿지 않는 거리면 팔을 쭉 펴 최대한 뻗는다', () => {
    const out = new THREE.Vector3();
    twoBone(new THREE.Vector3(), new THREE.Vector3(2, 0, 0), 0.3, 0.3, new THREE.Vector3(0, -1, 0), out);
    expect(out.distanceTo(new THREE.Vector3())).toBeCloseTo(0.3, 3);
    expect(out.x).toBeGreaterThan(0.25);
  });
});
