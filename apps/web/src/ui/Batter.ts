import Phaser from 'phaser';
import type { Location } from '@baseball/core';
import { project, zoneToWorld, type Point3 } from '../game/geometry';

/** 스윙을 시작해서 배트가 타격 위치에 닿기까지 걸리는 시간. 타이밍 판정은 이 시점을 기준으로 한다 */
export const SWING_CONTACT_MS = 120;
const FOLLOW_THROUGH_MS = 160;

// ───── 우타자 3D 모델 (단위 m, 키 1.65m로 약간 줄임) ─────
// 월드: x=오른쪽(1루), y=투수 쪽, z=위. 우타자는 포수 뒤에서 볼 때 홈플레이트 왼쪽(3루 쪽)에 서서 홈플레이트를 향한다.
const BODY_X = -0.72;
const BAT_LEN = 0.84;
const SHOULDER = { x: BODY_X + 0.05, y: -0.08, z: 1.36 };

interface Pose {
  hands: Point3;
  /** 배트 방향. azimuth: 수평면에서 +x(홈플레이트 쪽)=0°, 투수 쪽(+y)=+90°, 포수 쪽=-90° */
  azimuth: number;
  /** 수평에서 위로 든 각도 */
  loft: number;
}

/** 준비 자세: 배트를 어깨 뒤(포수 쪽)로 세워 든다 */
const STANCE: Pose = { hands: { x: -0.62, y: -0.30, z: 1.12 }, azimuth: -105, loft: 44 };
/** 타격 후 마무리: 몸 앞(투수 쪽)으로 감아 올린다 */
const FOLLOW: Pose = { hands: { x: -0.30, y: 0.42, z: 1.12 }, azimuth: 118, loft: 38 };
const CONTACT_HANDS: Point3 = { x: -0.5, y: -0.02, z: 0.98 };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: Point3, b: Point3, t: number): Point3 => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });
const rad = (d: number) => (d * Math.PI) / 180;

/** 방향 각도(azimuth, loft)와 길이로 배트 끝 월드 좌표를 구한다 */
function batTip(p: Pose): Point3 {
  const c = Math.cos(rad(p.loft));
  return {
    x: p.hands.x + BAT_LEN * c * Math.cos(rad(p.azimuth)),
    y: p.hands.y + BAT_LEN * c * Math.sin(rad(p.azimuth)),
    z: p.hands.z + BAT_LEN * Math.sin(rad(p.loft)),
  };
}

/** 포수 뒤에서 본 우타자와 배트. 몸과 배트를 3D로 만들어 같은 카메라로 투영한다 */
export class Batter {
  private body: Phaser.GameObjects.Graphics;
  private dynamic: Phaser.GameObjects.Graphics;
  private trail: Phaser.GameObjects.Graphics;
  private trailPts: { x: number; y: number }[] = [];
  private tweens: Phaser.Tweens.Tween[] = [];

  constructor(private scene: Phaser.Scene) {
    this.body = scene.add.graphics().setDepth(1);
    this.drawBody();
    this.trail = scene.add.graphics().setDepth(5);
    this.dynamic = scene.add.graphics().setDepth(6);
    this.pose(STANCE);
  }

  private drawBody() {
    const g = this.body;
    const P = (x: number, y: number, z: number) => project({ x: BODY_X + x, y, z });
    const line = (w: number, color: number, a: Point3, b: Point3) => {
      const pa = project(a);
      const pb = project(b);
      g.lineStyle(w * pa.scale, color, 1).lineBetween(pa.x, pa.y, pb.x, pb.y);
    };
    // 다리: 어깨너비로 벌려 홈플레이트를 향해 선 자세 (한 발은 투수 쪽, 한 발은 포수 쪽)
    const legColor = 0x2c2c3a;
    line(0.17, legColor, { x: BODY_X + 0.05, y: 0.28, z: 0.05 }, { x: BODY_X + 0.03, y: 0.14, z: 0.88 });
    line(0.17, legColor, { x: BODY_X + 0.05, y: -0.28, z: 0.05 }, { x: BODY_X + 0.03, y: -0.12, z: 0.88 });
    for (const y of [0.28, -0.28]) {
      const f = project({ x: BODY_X + 0.1, y, z: 0.03 });
      g.fillStyle(0x111111, 1).fillRoundedRect(f.x - 0.16 * f.scale, f.y - 0.03 * f.scale, 0.3 * f.scale, 0.06 * f.scale, 3);
    }
    // 상체(옆모습: 홈플레이트 쪽을 향함)
    const hipL = P(-0.13, 0, 0.88);
    const hipR = P(0.13, 0, 0.88);
    const shL = P(-0.12, -0.02, 1.38);
    const shR = P(0.12, -0.02, 1.38);
    g.fillStyle(0xd9d9e0, 1).fillPoints([hipL, hipR, shR, shL], true);
    g.fillStyle(0x16224a, 1).fillRect(hipL.x, hipL.y - 8, hipR.x - hipL.x, 8); // 허리띠
    // 목과 머리
    const neck = P(0, -0.02, 1.43);
    g.fillStyle(0xe6b88f, 1).fillCircle(neck.x, neck.y, 7);
    const head = project({ x: BODY_X + 0.06, y: 0, z: 1.53 });
    g.fillStyle(0xe6b88f, 1).fillCircle(head.x, head.y, 0.11 * head.scale);
    // 헬멧: 머리 윗부분과 귀 보호대
    g.fillStyle(0x16224a, 1).fillCircle(head.x - 2, head.y - 0.03 * head.scale, 0.125 * head.scale);
    g.fillStyle(0xe6b88f, 1).fillRect(head.x + 2, head.y - 0.02 * head.scale, 0.1 * head.scale, 0.12 * head.scale);
    g.fillStyle(0x16224a, 1).fillRect(head.x + 4, head.y - 0.045 * head.scale, 0.12 * head.scale, 0.03 * head.scale); // 챙
  }

  /** 배트와 팔을 현재 자세로 그린다 */
  private pose(p: Pose) {
    const g = this.dynamic;
    g.clear();
    const hands = project(p.hands);
    const tip = project(batTip(p));
    const sh = project(SHOULDER);
    // 팔
    g.lineStyle(0.1 * sh.scale, 0xd9d9e0, 1).lineBetween(sh.x, sh.y, hands.x, hands.y);
    // 배트: 손잡이(가늘게) + 머리(굵게)
    const hx = lerp(hands.x, tip.x, 0.28);
    const hy = lerp(hands.y, tip.y, 0.28);
    g.lineStyle(0.034 * hands.scale, 0xb98a52, 1).lineBetween(hands.x, hands.y, hx, hy);
    g.lineStyle(0.07 * tip.scale, 0xd8b176, 1).lineBetween(hx, hy, tip.x, tip.y);
    g.fillStyle(0x222222, 1).fillCircle(hands.x, hands.y, 0.06 * hands.scale); // 장갑
    return tip;
  }

  reset() {
    this.tweens.forEach((t) => t.stop());
    this.tweens = [];
    this.trail.clear().setAlpha(1);
    this.trailPts = [];
    this.pose(STANCE);
  }

  /** 공 위치를 향해 뻗는 타격 자세: 손에서 공을 향해 배트가 일직선이 된다 */
  private contactPose(target: Location): Pose {
    const ball = zoneToWorld(target);
    const dx = ball.x - CONTACT_HANDS.x;
    const dy = ball.y - CONTACT_HANDS.y;
    const dz = ball.z - CONTACT_HANDS.z;
    return {
      hands: CONTACT_HANDS,
      azimuth: (Math.atan2(dy, dx) * 180) / Math.PI,
      loft: (Math.atan2(dz, Math.hypot(dx, dy)) * 180) / Math.PI,
    };
  }

  /** 스윙 진행도 u: 0=준비, 1=타격, 2=마무리. 방위각이 계속 증가하는 것이 우타자의 스윙(위에서 볼 때 반시계) */
  private poseAtProgress(contact: Pose, u: number): Pose {
    const blend = (a: Pose, b: Pose, t: number): Pose => ({
      hands: lerp3(a.hands, b.hands, t),
      azimuth: lerp(a.azimuth, b.azimuth, t),
      loft: lerp(a.loft, b.loft, t),
    });
    return u <= 1 ? blend(STANCE, contact, u) : blend(contact, FOLLOW, Math.min(1, u - 1));
  }

  /** 개발/테스트용: 스윙의 특정 지점을 그린다 */
  debugFrame(target: Location, u: number) {
    this.reset();
    this.pose(this.poseAtProgress(this.contactPose(target), u));
  }

  /** 공이 도착할 위치(존 좌표)를 향해 스윙한다. 배트는 SWING_CONTACT_MS 뒤에 그 위치를 지난다 */
  swing(target: Location) {
    this.reset();
    const contact = this.contactPose(target);
    const state = { u: 0 };
    const draw = () => {
      const tip = this.pose(this.poseAtProgress(contact, state.u));
      this.trailPts.push({ x: tip.x, y: tip.y });
      this.trail.clear().lineStyle(8, 0xffffff, 0.28).strokePoints(this.trailPts, false);
    };
    const t1 = this.scene.tweens.add({
      targets: state,
      u: 1,
      duration: SWING_CONTACT_MS,
      ease: 'Quad.easeIn',
      onUpdate: draw,
      onComplete: () => {
        const t2 = this.scene.tweens.add({
          targets: state,
          u: 2,
          duration: FOLLOW_THROUGH_MS,
          ease: 'Quad.easeOut',
          onUpdate: draw,
          onComplete: () => this.scene.tweens.add({ targets: this.trail, alpha: 0, duration: 200 }),
        });
        this.tweens.push(t2);
      },
    });
    this.tweens.push(t1);
  }
}
