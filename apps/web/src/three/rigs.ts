import * as THREE from 'three';
import { RELEASE_WORLD, ZONE_CENTER_Z_M, zoneToWorld, type Point3 } from '../game/geometry';
import type { Location } from '@baseball/core';
import { Humanoid, emptyJoints, pinstripeTexture, twoBone, type Joints, SKIN } from './humanoid';

const rad = (d: number) => (d * Math.PI) / 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** 월드(x=오른쪽, y=투수 쪽, z=위) → three.js(x, y=위, z=카메라 쪽) */
export const toV3 = (p: Point3) => new THREE.Vector3(p.x, p.z, -p.y);
/** 수평 방위각(위에서 볼 때 반시계, 0=+x, 90°=투수 쪽) → 앞 방향 / 오른쪽 방향 (three 좌표) */
const fwd = (az: number) => new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
const right = (az: number) => new THREE.Vector3(Math.sin(az), 0, Math.cos(az));
const UP = new THREE.Vector3(0, 1, 0);

interface BodyOpts {
  /** 발밑 기준점(three 좌표) */
  base: THREE.Vector3;
  scale: number;
  /** 골반/가슴이 향한 방위각(rad) */
  pelvisYaw: number;
  chestYaw: number;
  /** 상체를 앞(가슴 방향)으로 숙인 각도(rad) */
  lean: number;
  crouch: number;
  footL: THREE.Vector3;
  footR: THREE.Vector3;
  handL: THREE.Vector3;
  handR: THREE.Vector3;
  headYaw: number;
  /** 팔꿈치가 굽는 방향(생략하면 아래쪽·바깥쪽) */
  poleL?: THREE.Vector3;
  poleR?: THREE.Vector3;
}

/** 몸통·다리·팔 관절을 계산한다. 팔다리는 IK, 어깨/골반은 방위각으로 회전 */
function bodyJoints(o: BodyOpts, j: Joints): Joints {
  const s = o.scale;
  const pelvisH = (0.93 - o.crouch) * s;
  j.pelvis.set(o.base.x, o.base.y + pelvisH, o.base.z);
  const fC = fwd(o.chestYaw);
  const rC = right(o.chestYaw);
  const fP = fwd(o.pelvisYaw);
  const rP = right(o.pelvisYaw);
  const spine = fC.clone().multiplyScalar(Math.sin(o.lean)).addScaledVector(UP, Math.cos(o.lean));
  j.chest.copy(j.pelvis).addScaledVector(spine, 0.5 * s);
  j.neck.copy(j.chest).addScaledVector(spine, 0.1 * s);
  j.head.copy(j.neck).addScaledVector(UP, 0.12 * s).addScaledVector(fC, 0.03 * s * Math.sin(o.lean) * 3);
  j.headYaw = o.headYaw;
  j.shoulderL.copy(j.chest).addScaledVector(rC, -0.2 * s);
  j.shoulderR.copy(j.chest).addScaledVector(rC, 0.2 * s);
  j.hipL.copy(j.pelvis).addScaledVector(rP, -0.1 * s);
  j.hipR.copy(j.pelvis).addScaledVector(rP, 0.1 * s);
  j.footL.copy(o.footL);
  j.footR.copy(o.footR);
  const ankleL = o.footL.clone().add(new THREE.Vector3(0, 0.07 * s, 0));
  const ankleR = o.footR.clone().add(new THREE.Vector3(0, 0.07 * s, 0));
  twoBone(j.hipL, ankleL, 0.46 * s, 0.45 * s, fP.clone().addScaledVector(rP, -0.25), j.kneeL);
  twoBone(j.hipR, ankleR, 0.46 * s, 0.45 * s, fP.clone().addScaledVector(rP, 0.25), j.kneeR);
  j.handL.copy(o.handL);
  j.handR.copy(o.handR);
  twoBone(j.shoulderL, o.handL, 0.3 * s, 0.28 * s, o.poleL ?? new THREE.Vector3(0, -1, 0).addScaledVector(rC, -0.35), j.elbowL);
  twoBone(j.shoulderR, o.handR, 0.3 * s, 0.28 * s, o.poleR ?? new THREE.Vector3(0, -1, 0).addScaledVector(rC, 0.35), j.elbowR);
  return j;
}

export interface TeamColors {
  jersey: number;
  pants: number;
  cap: number;
}
export const AWAY_COLORS: TeamColors = { jersey: 0x1b2a57, pants: 0xf7f7fa, cap: 0x131b3a };
export const HOME_COLORS: TeamColors = { jersey: 0xb71c24, pants: 0xf7f7fa, cap: 0x8f1218 };

// ───────────────────────── 타자 ─────────────────────────

/** 스윙 자세 키프레임: 손 위치와 배트 방향, 몸의 회전 */
interface BatPose {
  /** 손(월드 좌표) */
  hands: Point3;
  /** 배트 방향. azimuth: +x(홈플레이트 쪽)=0°, 투수 쪽=+90°, 포수 쪽=-90° / loft: 수평에서 위로 */
  azimuth: number;
  loft: number;
  pelvisYaw: number;
  chestYaw: number;
  lean: number;
  crouch: number;
}

const BODY = { x: -0.78, y: -0.22 };
const BAT_LEN = 0.84;
const STANCE: BatPose = {
  hands: { x: -0.5, y: -0.4, z: 1.36 },
  azimuth: -95,
  loft: 70,
  pelvisYaw: -8,
  chestYaw: -28,
  lean: 0.22,
  crouch: 0.17,
};
const CONTACT_HANDS: Point3 = { x: -0.4, y: -0.08, z: 1.05 };
const FOLLOW: BatPose = {
  hands: { x: -0.32, y: 0.3, z: 1.3 },
  azimuth: 125,
  loft: 38,
  pelvisYaw: 82,
  chestYaw: 108,
  lean: 0.06,
  crouch: 0.05,
};

const lerpPose = (a: BatPose, b: BatPose, t: number): BatPose => ({
  hands: { x: lerp(a.hands.x, b.hands.x, t), y: lerp(a.hands.y, b.hands.y, t), z: lerp(a.hands.z, b.hands.z, t) },
  azimuth: lerp(a.azimuth, b.azimuth, t),
  loft: lerp(a.loft, b.loft, t),
  pelvisYaw: lerp(a.pelvisYaw, b.pelvisYaw, t),
  chestYaw: lerp(a.chestYaw, b.chestYaw, t),
  lean: lerp(a.lean, b.lean, t),
  crouch: lerp(a.crouch, b.crouch, t),
});

/** 우타자: 몸 전체와 배트를 3D로 구성한다. 스윙은 준비 → 타격 → 마무리 순서로 보간 */
export class BatterRig {
  readonly humanoid: Humanoid;
  readonly object = new THREE.Group();
  private bat = new THREE.Group();
  private joints = emptyJoints();
  private lastPose: BatPose = STANCE;

  constructor() {
    this.humanoid = new Humanoid(
      { jersey: 0xffffff, pants: AWAY_COLORS.pants, cap: AWAY_COLORS.cap, skin: SKIN, shoes: 0x1a1a1f },
      1,
      pinstripeTexture('#1b2a57', '#7d8fc4'),
      'helmet',
    );
    // 배트: 노브 + 테이프 손잡이 + 검은 배럴
    const tape = new THREE.MeshLambertMaterial({ color: 0xe6dcc4 });
    const wood = new THREE.MeshLambertMaterial({ color: 0x151515 });
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.017, 0.26, 12), tape);
    handle.position.y = 0.13 - 0.07;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.018, 0.6, 14), wood);
    barrel.position.y = 0.26 - 0.07 + 0.3;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), tape);
    knob.position.y = -0.07;
    this.bat.add(handle, barrel, knob);
    this.object.add(this.humanoid.root, this.bat);
    this.setPose(STANCE);
  }

  setTeamColors(c: TeamColors) {
    // 줄무늬 텍스처가 남색이므로 원정(남색)은 그대로, 홈(빨강)은 붉게 틴트한다
    this.humanoid.setColors(c.jersey === AWAY_COLORS.jersey ? 0xffffff : 0xffb3b8, c.pants, c.cap);
  }

  private setPose(p: BatPose) {
    this.lastPose = p;
    const az = rad(p.azimuth);
    const lo = rad(p.loft);
    const dirW: Point3 = { x: Math.cos(lo) * Math.cos(az), y: Math.cos(lo) * Math.sin(az), z: Math.sin(lo) };
    const dir = toV3(dirW).normalize();
    const hands = toV3(p.hands);
    // 배트 오브젝트: 노브가 손 뒤쪽 7cm
    this.bat.position.copy(hands).addScaledVector(dir, 0.0);
    this.bat.quaternion.setFromUnitVectors(UP, dir);
    // 우타자: 왼손(앞손)이 노브 쪽 아래, 오른손(뒷손)이 그 위를 잡는다
    const upperHand = hands.clone().addScaledVector(dir, 0.13);

    const base = toV3({ x: BODY.x, y: BODY.y, z: 0 });
    const footL = toV3({ x: BODY.x + 0.02, y: BODY.y + 0.34, z: 0 });
    const footR = toV3({ x: BODY.x + 0.12, y: BODY.y - 0.3, z: 0 });
    bodyJoints(
      {
        base,
        scale: 1,
        pelvisYaw: rad(p.pelvisYaw),
        chestYaw: rad(p.chestYaw),
        lean: p.lean,
        crouch: p.crouch,
        footL,
        footR,
        handL: hands,
        handR: upperHand,
        headYaw: rad(90),
      },
      this.joints,
    );
    this.humanoid.update(this.joints);
  }

  /** 공이 올 위치(존 좌표)를 향해 뻗는 타격 자세 */
  private contactPose(target: Location): BatPose {
    const ball = zoneToWorld(target);
    const dx = ball.x - CONTACT_HANDS.x;
    const dy = ball.y - CONTACT_HANDS.y;
    const dz = ball.z - CONTACT_HANDS.z;
    return {
      hands: CONTACT_HANDS,
      azimuth: (Math.atan2(dy, dx) * 180) / Math.PI,
      loft: (Math.atan2(dz, Math.hypot(dx, dy)) * 180) / Math.PI,
      pelvisYaw: 42,
      chestYaw: 66,
      lean: 0.14,
      crouch: 0.13,
    };
  }

  /** 스윙 진행도 u: 0=준비, 1=타격(공 위치), 2=마무리 */
  poseAtProgress(target: Location, u: number): void {
    const contact = this.contactPose(target);
    this.setPose(u <= 1 ? lerpPose(STANCE, contact, u) : lerpPose(contact, FOLLOW, clamp01(u - 1)));
  }

  reset() {
    this.setPose(STANCE);
  }

  /** 현재 자세의 배트 끝(월드 좌표). 잔상/디버깅용 */
  batTip(): THREE.Vector3 {
    const p = this.lastPose;
    const az = rad(p.azimuth);
    const lo = rad(p.loft);
    return toV3({
      x: p.hands.x + BAT_LEN * Math.cos(lo) * Math.cos(az),
      y: p.hands.y + BAT_LEN * Math.cos(lo) * Math.sin(az),
      z: p.hands.z + BAT_LEN * Math.sin(lo),
    });
  }
}

// ───────────────────────── 투수 ─────────────────────────

const MOUND = { y: 18.44, height: 0.25 };
export const WINDUP_MS = 900;

/** 키프레임 [시각, 값] 을 부드럽게 보간 */
function keyed(t: number, keys: [number, THREE.Vector3][]): THREE.Vector3 {
  if (t <= keys[0]![0]) return keys[0]![1].clone();
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i]!;
    const [t0, v0] = keys[i - 1]!;
    if (t <= t1) return v0.clone().lerp(v1, smooth(t0, t1, t));
  }
  return keys[keys.length - 1]![1].clone();
}

const keyedNum = (t: number, keys: [number, number][]) => {
  if (t <= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i]!;
    const [t0, v0] = keys[i - 1]!;
    if (t <= t1) return lerp(v0, v1, smooth(t0, t1, t));
  }
  return keys[keys.length - 1]![1];
};

/**
 * 우완 투수의 오버핸드 투구. 진행도 τ: 0=세트, 0.3=다리 들기, 0.62=스트라이드 착지, 1=릴리스, 1.4=팔로스루 끝.
 * 투수는 홈플레이트(카메라)를 향해 서므로 그의 오른쪽(던지는 팔)은 화면 왼쪽(-x)이다.
 * 던지는 팔은 몸 뒤로 내려갔다가 어깨 높이로 접어 올린(코킹) 뒤 머리 위를 넘어 앞으로 뿌린다.
 */
export class PitcherRig {
  readonly humanoid: Humanoid;
  readonly object = new THREE.Group();
  private joints = emptyJoints();
  private readonly scale = 1.05;

  constructor() {
    this.humanoid = new Humanoid({ jersey: HOME_COLORS.jersey, pants: 0xf7f7fa, cap: HOME_COLORS.cap, skin: SKIN, shoes: 0x1a1a1f }, this.scale);
    this.object.add(this.humanoid.root);
    this.setProgress(0);
  }

  setTeamColors(c: TeamColors) {
    this.humanoid.setColors(c.jersey, c.pants, c.cap);
  }

  setProgress(tau: number) {
    // 마운드 중심 기준 상대 좌표 (x=오른쪽, y=홈 쪽이 음수, z=마운드 윗면 기준 높이)
    const W = (x: number, y: number, z: number) => toV3({ x, y: MOUND.y + y, z: MOUND.height + z });
    // 체중 이동: 골반이 홈 쪽으로 약 0.9m 나간다
    const shift = lerp(0, -0.9, smooth(0.3, 0.72, tau)) + lerp(0, -0.35, smooth(1.0, 1.4, tau));
    const base = toV3({ x: 0, y: MOUND.y + shift, z: MOUND.height });

    const footR = keyed(tau, [
      [0, W(-0.14, 0.04, 0)],
      [0.55, W(-0.14, 0.04, 0)],
      [0.8, W(-0.2, -0.35, 0.03)],
      [1.0, W(-0.22, -0.65, 0.12)],
      [1.4, W(-0.22, -1.05, 0.28)],
    ]);
    const footL = keyed(tau, [
      [0, W(0.14, 0.0, 0)],
      [0.3, W(0.1, -0.12, 0.55)],
      [0.62, W(0.1, -1.3, 0)],
      [1.4, W(0.1, -1.3, 0)],
    ]);
    // 던지는 손(오른손)과 글러브 손(왼손)
    const handR = keyed(tau, [
      [0, W(-0.06, -0.2, 1.28)],
      [0.3, W(-0.06, -0.22, 1.3)],
      [0.5, W(-0.45, 0.28, 0.95)], // 몸 뒤로 내려 팔을 펴고
      [0.66, W(-0.6, 0.22, 1.6)], // 어깨 높이로 접어 올려 코킹
      [0.84, W(-0.45, -0.3, 2.05)], // 머리 위를 지나
      [1.0, W(RELEASE_WORLD.x, RELEASE_WORLD.y - MOUND.y, RELEASE_WORLD.z - MOUND.height)],
      [1.2, W(-0.05, -1.55, 1.2)],
      [1.4, W(0.25, -1.55, 0.7)], // 반대쪽 무릎 쪽으로 내려오며 마무리
    ]);
    const handL = keyed(tau, [
      [0, W(0.06, -0.2, 1.28)],
      [0.3, W(0.06, -0.22, 1.3)],
      [0.55, W(0.3, -0.75, 1.45)], // 글러브를 홈 쪽으로 뻗어 균형을 잡고
      [0.9, W(0.3, -0.95, 1.5)],
      [1.1, W(0.15, -0.55, 1.15)], // 몸 쪽으로 당긴다
      [1.4, W(0.15, -0.5, 1.05)],
    ]);

    const pelvisYaw = rad(keyedNum(tau, [[0, -100], [0.3, -150], [0.5, -150], [1.0, -78], [1.4, -62]]));
    const chestYaw = rad(keyedNum(tau, [[0, -110], [0.3, -155], [0.55, -150], [0.8, -105], [1.0, -75], [1.4, -50]]));
    const lean = keyedNum(tau, [[0, 0.04], [0.3, 0.0], [0.7, 0.12], [1.0, 0.5], [1.4, 0.7]]);
    const crouch = keyedNum(tau, [[0, 0], [0.3, 0.0], [0.62, 0.12], [1.0, 0.22], [1.4, 0.3]]);

    // 팔꿈치 방향: 코킹 구간엔 옆(오른쪽)으로, 앞으로 뿌릴 땐 아래로
    const outward = right(chestYaw);
    const poleR = new THREE.Vector3(0, -0.4, 0).addScaledVector(outward, lerp(1.0, 0.1, smooth(0.75, 1.0, tau)));
    const poleL = new THREE.Vector3(0, -1, 0).addScaledVector(outward, -0.3);

    bodyJoints(
      {
        base,
        scale: this.scale,
        pelvisYaw,
        chestYaw,
        lean,
        crouch,
        footL,
        footR,
        handL,
        handR,
        headYaw: rad(-90),
        poleL,
        poleR,
      },
      this.joints,
    );
    this.humanoid.update(this.joints);
  }
}

// ───────────────────────── 야수 ─────────────────────────

/** 대기 자세로 서 있는 야수(몸을 숙이고 글러브를 무릎 앞에) */
export class FielderRig {
  readonly humanoid: Humanoid;
  readonly object = new THREE.Group();

  constructor(
    x: number,
    y: number,
    private colors: TeamColors = HOME_COLORS,
    scale = 1,
  ) {
    this.humanoid = new Humanoid({ jersey: colors.jersey, pants: colors.pants, cap: colors.cap, skin: SKIN, shoes: 0xe8e8e8 }, scale);
    this.object.add(this.humanoid.root);
    const base = toV3({ x, y, z: 0 });
    const s = scale;
    const face = rad(-90);
    const r = right(face);
    const f = fwd(face);
    const j = emptyJoints();
    const foot = (side: number) => base.clone().addScaledVector(r, side * 0.24 * s).addScaledVector(f, 0.02);
    bodyJoints(
      {
        base,
        scale: s,
        pelvisYaw: face,
        chestYaw: face,
        lean: 0.5,
        crouch: 0.2 * s,
        footL: foot(-1),
        footR: foot(1),
        handL: base.clone().add(new THREE.Vector3(0, 0.55 * s, 0)).addScaledVector(r, -0.2 * s).addScaledVector(f, 0.35 * s),
        handR: base.clone().add(new THREE.Vector3(0, 0.6 * s, 0)).addScaledVector(r, 0.2 * s).addScaledVector(f, 0.3 * s),
        headYaw: face,
      },
      j,
    );
    this.humanoid.update(j);
  }

  setTeamColors(c: TeamColors) {
    this.colors = c;
    this.humanoid.setColors(c.jersey, c.pants, c.cap);
  }
}

export { ZONE_CENTER_Z_M };
