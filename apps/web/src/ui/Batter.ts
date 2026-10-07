import Phaser from 'phaser';
import type { Location } from '@baseball/core';
import { project, zoneToWorld, type Point3 } from '../game/geometry';

/** 스윙을 시작해서 배트가 타격 위치에 닿기까지 걸리는 시간. 타이밍 판정은 이 시점을 기준으로 한다 */
export const SWING_CONTACT_MS = 120;
const FOLLOW_THROUGH_MS = 160;

// ───── 우타자 3D 모델 (단위 m) ─────
// 월드: x=오른쪽(1루), y=투수 쪽, z=위. 우타자는 홈플레이트 왼쪽(3루 쪽) 타석에 서서 홈플레이트를 향한다.
// 카메라가 바로 뒤에 있어 등과 오른쪽 옆모습이 크게 보인다.
const BODY = { x: -0.8, y: -0.3 };
const BAT_LEN = 0.84;

interface Pose {
  hands: Point3;
  /** 배트 방향. azimuth: 수평면에서 +x(홈플레이트 쪽)=0°, 투수 쪽(+y)=+90°, 포수 쪽=-90° */
  azimuth: number;
  /** 수평에서 위로 든 각도 */
  loft: number;
}

/** 준비 자세: 배트를 얼굴 앞쪽에 거의 수직으로 세워 든다 */
const STANCE: Pose = { hands: { x: -0.55, y: -0.42, z: 1.36 }, azimuth: -100, loft: 72 };
/** 타격 후 마무리: 몸 앞(투수 쪽)으로 감아 올린다 */
const FOLLOW: Pose = { hands: { x: -0.22, y: 0.32, z: 1.22 }, azimuth: 120, loft: 36 };
const CONTACT_HANDS: Point3 = { x: -0.45, y: -0.1, z: 1.05 };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: Point3, b: Point3, t: number): Point3 => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });
const rad = (d: number) => (d * Math.PI) / 180;
const add = (a: Point3, b: Point3): Point3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

/** 배트 방향 단위벡터 */
function batDir(p: Pose): Point3 {
  const c = Math.cos(rad(p.loft));
  return { x: c * Math.cos(rad(p.azimuth)), y: c * Math.sin(rad(p.azimuth)), z: Math.sin(rad(p.loft)) };
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

  /** 선분 형태의 팔다리: 두께(m)를 그 지점의 원근 배율로 그리고 양 끝을 둥글게 */
  private limb(g: Phaser.GameObjects.Graphics, a: Point3, b: Point3, w: number, color: number, alpha = 1) {
    const pa = project(a);
    const pb = project(b);
    g.lineStyle(w * ((pa.scale + pb.scale) / 2), color, alpha).lineBetween(pa.x, pa.y, pb.x, pb.y);
    g.fillStyle(color, alpha).fillCircle(pa.x, pa.y, (w * pa.scale) / 2).fillCircle(pb.x, pb.y, (w * pb.scale) / 2);
  }

  private drawBody() {
    const g = this.body;
    const X = BODY.x;
    const Y = BODY.y;
    // 바닥 그림자
    const sh = project({ x: X, y: Y, z: 0 });
    g.fillStyle(0x000000, 0.28).fillEllipse(sh.x + 14, sh.y, 1.1 * sh.scale, 0.28 * sh.scale);

    // 다리(흰 바지): 어깨너비로 벌리고 무릎을 살짝 굽힌 스탠스
    const pants = 0xeceef2;
    const shade = 0xc9ced8;
    const hipL = { x: X - 0.14, y: Y, z: 0.98 };
    const hipR = { x: X + 0.16, y: Y, z: 0.98 };
    const kneeL = { x: X - 0.2, y: Y + 0.04, z: 0.52 };
    const kneeR = { x: X + 0.24, y: Y + 0.04, z: 0.52 };
    const footL = { x: X - 0.2, y: Y + 0.06, z: 0.08 };
    const footR = { x: X + 0.26, y: Y + 0.06, z: 0.08 };
    for (const [h, k, f] of [
      [hipL, kneeL, footL],
      [hipR, kneeR, footR],
    ] as const) {
      this.limb(g, h, k, 0.2, pants);
      this.limb(g, k, f, 0.16, pants);
      this.limb(g, add(h, { x: 0.05, y: 0, z: 0 }), add(k, { x: 0.05, y: 0, z: 0 }), 0.05, shade, 0.7); // 바지 주름
    }
    // 신발
    for (const f of [footL, footR]) {
      const p = project(f);
      g.fillStyle(0xf4f4f6, 1).fillEllipse(p.x + 6, p.y + 6, 0.3 * p.scale, 0.09 * p.scale);
      g.fillStyle(0x222222, 1).fillRect(p.x - 0.14 * p.scale + 6, p.y + 6 + 0.035 * p.scale, 0.28 * p.scale, 0.016 * p.scale);
    }

    // 상체(남색 유니폼): 등이 보이도록 어깨폭이 넓게 보인다
    const jersey = 0x1b2a57;
    const torso = [
      project({ x: X - 0.17, y: Y, z: 0.96 }),
      project({ x: X + 0.19, y: Y, z: 0.96 }),
      project({ x: X + 0.24, y: Y, z: 1.5 }),
      project({ x: X - 0.22, y: Y, z: 1.5 }),
    ];
    g.fillStyle(jersey, 1).fillPoints(torso, true);
    // 등 쪽 대각선 줄무늬
    for (let i = 0; i < 4; i++) {
      const a = project({ x: X - 0.2 + i * 0.1, y: Y, z: 1.48 });
      const b = project({ x: X - 0.1 + i * 0.1, y: Y, z: 1.0 });
      g.lineStyle(0.03 * a.scale, 0x5d70b0, 0.55).lineBetween(a.x, a.y, b.x, b.y);
    }
    const belt = [
      project({ x: X - 0.17, y: Y, z: 0.99 }),
      project({ x: X + 0.19, y: Y, z: 0.99 }),
      project({ x: X + 0.19, y: Y, z: 0.93 }),
      project({ x: X - 0.17, y: Y, z: 0.93 }),
    ];
    g.fillStyle(0x0d1530, 1).fillPoints(belt, true);

    // 목과 머리: 뒤통수와 헬멧
    const neck = project({ x: X + 0.02, y: Y, z: 1.55 });
    g.fillStyle(0xc88f68, 1).fillRect(neck.x - 0.045 * neck.scale, neck.y - 0.05 * neck.scale, 0.09 * neck.scale, 0.1 * neck.scale);
    const head = project({ x: X + 0.02, y: Y, z: 1.7 });
    g.fillStyle(0xd9a07a, 1).fillCircle(head.x, head.y, 0.12 * head.scale);
    g.fillStyle(0x131b3a, 1).fillEllipse(head.x, head.y - 0.025 * head.scale, 0.27 * head.scale, 0.25 * head.scale);
    g.fillStyle(0x131b3a, 1).fillRect(head.x - 0.02 * head.scale, head.y - 0.02 * head.scale, 0.15 * head.scale, 0.09 * head.scale); // 귀 보호대
    g.fillStyle(0x3a4a86, 0.8).fillEllipse(head.x - 0.06 * head.scale, head.y - 0.08 * head.scale, 0.08 * head.scale, 0.04 * head.scale); // 헬멧 광택
  }

  /** 배트와 팔을 현재 자세로 그린다. 배트 끝의 화면 좌표를 돌려준다 */
  private pose(p: Pose) {
    const g = this.dynamic;
    g.clear();
    const dir = batDir(p);
    const at = (d: number): Point3 => ({ x: p.hands.x + dir.x * d, y: p.hands.y + dir.y * d, z: p.hands.z + dir.z * d });
    const knob = at(-0.07);
    const grip = at(0.22);
    const tip = at(BAT_LEN);

    // 팔: 어깨 → 팔꿈치(소매) → 손(맨살 + 보호대)
    const shoulders: Point3[] = [
      { x: BODY.x + 0.2, y: BODY.y, z: 1.46 },
      { x: BODY.x - 0.18, y: BODY.y, z: 1.46 },
    ];
    const handsAt = [p.hands, at(0.12)];
    shoulders.forEach((sh, i) => {
      const hand = handsAt[i]!;
      const mid = lerp3(sh, hand, 0.5);
      const elbow = add(mid, { x: i === 0 ? 0.1 : -0.1, y: -0.05, z: -0.17 });
      this.limb(g, sh, elbow, 0.12, 0x1b2a57); // 소매
      this.limb(g, elbow, hand, 0.085, 0xd9a07a); // 팔뚝
      this.limb(g, lerp3(elbow, hand, 0.35), lerp3(elbow, hand, 0.55), 0.095, 0x151515); // 팔 보호대
    });

    // 배트: 노브 → 테이프 감은 손잡이 → 검은 배럴(끝으로 갈수록 굵게)
    this.taper(g, knob, grip, 0.034, 0.034, 0xe2d6bd);
    this.taper(g, grip, tip, 0.036, 0.075, 0x141414);
    const kp = project(knob);
    g.fillStyle(0xe2d6bd, 1).fillCircle(kp.x, kp.y, 0.025 * kp.scale);
    // 장갑
    for (const h of handsAt) {
      const hp = project(h);
      g.fillStyle(0xf6f6f8, 1).fillCircle(hp.x, hp.y, 0.062 * hp.scale);
      g.lineStyle(1, 0xaaaaaa, 0.8).strokeCircle(hp.x, hp.y, 0.062 * hp.scale);
    }
    return project(tip);
  }

  /** 두께가 변하는 선(배트): 화면에서 수직 방향으로 폭을 준 사각형 */
  private taper(g: Phaser.GameObjects.Graphics, a: Point3, b: Point3, wa: number, wb: number, color: number) {
    const pa = project(a);
    const pb = project(b);
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const ra = (wa * pa.scale) / 2;
    const rb = (wb * pb.scale) / 2;
    g.fillStyle(color, 1).fillPoints(
      [
        { x: pa.x + nx * ra, y: pa.y + ny * ra },
        { x: pb.x + nx * rb, y: pb.y + ny * rb },
        { x: pb.x - nx * rb, y: pb.y - ny * rb },
        { x: pa.x - nx * ra, y: pa.y - ny * ra },
      ],
      true,
    );
    g.fillStyle(color, 1).fillCircle(pb.x, pb.y, rb);
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
