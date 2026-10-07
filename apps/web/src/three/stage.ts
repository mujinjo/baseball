import * as THREE from 'three';
import type { Team } from '@baseball/core';
import {
  CAM_BEHIND_M,
  CAM_HEIGHT_M,
  FOCAL_PX,
  HORIZON_Y,
  ZONE_CENTER,
  type Point3,
} from '../game/geometry';
import { AWAY_COLORS, BatterRig, FielderRig, HOME_COLORS, PitcherRig, toV3 } from './rigs';
import { buildWorld } from './world';

const VIEW_W = 540;
const VIEW_H = 960;

/**
 * 게임 화면과 정확히 같은 투영이 되도록 맞춘 카메라.
 * geometry.ts의 project()와 같은 초점거리·소실점을 쓰므로 존 오버레이(Phaser)와 3D 장면이 어긋나지 않는다.
 */
export function createGameCamera(): THREE.PerspectiveCamera {
  // 소실점(원점 투영)이 화면 중앙이 아니라 (ZONE_CENTER.x, HORIZON_Y)이므로 뷰 오프셋으로 주점을 옮긴다
  const fullW = VIEW_W * 2;
  const fullH = VIEW_H * 2;
  const fovY = (2 * Math.atan(fullH / 2 / FOCAL_PX) * 180) / Math.PI;
  const cam = new THREE.PerspectiveCamera(fovY, fullW / fullH, 0.1, 600);
  cam.setViewOffset(fullW, fullH, fullW / 2 - ZONE_CENTER.x, fullH / 2 - HORIZON_Y, VIEW_W, VIEW_H);
  cam.position.set(0, CAM_HEIGHT_M, CAM_BEHIND_M);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

/** three.js 장면. Phaser 캔버스 뒤에 깔려 3D 구장·선수·공을 그린다 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = createGameCamera();
  readonly batter = new BatterRig();
  readonly pitcher = new PitcherRig();
  private fielders: FielderRig[] = [];
  private ball: THREE.Mesh;
  private visible = true;
  /** 개발/디버깅: 다른 시점으로 장면을 확인할 때 쓴다 */
  overrideCamera: THREE.Camera | null = null;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(VIEW_W, VIEW_H, false);
    const c = this.renderer.domElement;
    c.style.position = 'absolute';
    c.style.pointerEvents = 'none';
    container.prepend(c);

    buildWorld(this.scene);

    // 타자
    this.scene.add(this.batter.object);
    // 투수: 마운드 위
    this.scene.add(this.pitcher.object);
    // 내야수: 실제 수비 위치. 1루수·3루수는 이 카메라의 시야 밖이라 화면에 보이지 않는다
    for (const [x, y] of [
      [17, 12], // 1루수
      [5.5, 30], // 2루수(약간 중앙 쪽)
      [-6.5, 30], // 유격수
      [-17, 12], // 3루수
    ] as const) {
      const f = new FielderRig(x, y, HOME_COLORS, 1);
      this.fielders.push(f);
      this.scene.add(f.object);
    }

    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.0368, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const seam = new THREE.Mesh(new THREE.TorusGeometry(0.0372, 0.0035, 6, 20), new THREE.MeshBasicMaterial({ color: 0xc83030 }));
    seam.rotation.y = Math.PI / 2;
    this.ball.add(seam);
    this.ball.visible = false;
    this.scene.add(this.ball);
    this.setBattingTeam('away');
  }

  /** 공격 팀에 따라 타자/수비 유니폼 색을 바꾼다 (원정=남색, 홈=빨강) */
  setBattingTeam(team: Team) {
    const bat = team === 'away' ? AWAY_COLORS : HOME_COLORS;
    const def = team === 'away' ? HOME_COLORS : AWAY_COLORS;
    this.batter.setTeamColors(bat);
    this.pitcher.setTeamColors(def);
    this.fielders.forEach((f) => f.setTeamColors(def));
  }

  /** 공을 월드 좌표에 놓는다. 멀리 있을 때도 보이도록 거리에 따라 조금 키운다 */
  setBall(p: Point3 | null) {
    if (!p) {
      this.ball.visible = false;
      return;
    }
    this.ball.visible = true;
    this.ball.position.copy(toV3(p));
    const depth = p.y + CAM_BEHIND_M;
    this.ball.scale.setScalar(Math.min(4, Math.max(1, depth / 6)));
  }

  /** Phaser 캔버스와 같은 위치/크기에 맞춘다 */
  syncTo(phaserCanvas: HTMLCanvasElement) {
    const r = phaserCanvas.getBoundingClientRect();
    const o = this.container.getBoundingClientRect();
    const c = this.renderer.domElement;
    c.style.left = `${r.left - o.left}px`;
    c.style.top = `${r.top - o.top}px`;
    c.style.width = `${r.width}px`;
    c.style.height = `${r.height}px`;
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.renderer.domElement.style.display = v ? 'block' : 'none';
  }

  render() {
    if (this.visible) this.renderer.render(this.scene, this.overrideCamera ?? this.camera);
  }
}
