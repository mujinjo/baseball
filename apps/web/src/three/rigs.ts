import * as THREE from 'three';
import { RELEASE_WORLD, ZONE_CENTER_Z_M, zoneToWorld, type Point3 } from '../game/geometry';
import type { Location } from '@baseball/core';
import { Humanoid, emptyJoints, pinstripeTexture, twoBone, type Joints, SKIN } from './humanoid';

const rad = (d: number) => (d * Math.PI) / 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: Point3, b: Point3, t: number): Point3 => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });
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

export interface RelHand {
  f: number;
  r: number;
  u: number;
}

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
  /** 손 목표: three 좌표 그대로, 또는 가슴 기준 상대 좌표(f=가슴이 향한 방향, r=그의 오른쪽, u=위, 단위 m) */
  handL: THREE.Vector3 | RelHand;
  handR: THREE.Vector3 | RelHand;
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
  const resolve = (h: THREE.Vector3 | RelHand) =>
    h instanceof THREE.Vector3
      ? h
      : j.chest.clone().addScaledVector(fC, h.f * s).addScaledVector(rC, h.r * s).addScaledVector(UP, h.u * s);
  const handL = resolve(o.handL);
  const handR = resolve(o.handR);
  j.handL.copy(handL);
  j.handR.copy(handR);
  twoBone(j.shoulderL, handL, 0.3 * s, 0.28 * s, o.poleL ?? new THREE.Vector3(0, -1, 0).addScaledVector(rC, -0.35), j.elbowL);
  twoBone(j.shoulderR, handR, 0.3 * s, 0.28 * s, o.poleR ?? new THREE.Vector3(0, -1, 0).addScaledVector(rC, 0.35), j.elbowR);
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
  /** 앞발 내딛기 진행도(0=처음 자리, 1=내디뎌 착지) */
  stride: number;
  /** 뒷발 뒤꿈치 들림/회전(0~1) */
  heel: number;
}

const BODY = { x: -0.78, y: -0.22 };
const BAT_LEN = 0.84;
const STANCE: BatPose = {
  hands: { x: -0.3, y: -0.42, z: 1.3 },
  azimuth: -95,
  loft: 70,
  pelvisYaw: -8,
  chestYaw: -28,
  lean: 0.22,
  crouch: 0.17,
  stride: 0,
  heel: 0,
};
/** 로드 완료: 앞발을 내디디며 손과 배트를 뒤로 당긴 자세(체중은 뒤, 몸은 닫힘) */
const LOADED: BatPose = {
  hands: { x: -0.4, y: -0.58, z: 1.36 },
  azimuth: -102,
  loft: 60,
  pelvisYaw: -26,
  chestYaw: -46,
  lean: 0.18,
  crouch: 0.2,
  stride: 1,
  heel: 0,
};
const CONTACT_HANDS: Point3 = { x: -0.4, y: -0.08, z: 1.05 };
const FOLLOW: BatPose = {
  hands: { x: -0.3, y: 0.34, z: 1.22 },
  azimuth: 85,
  loft: 28,
  pelvisYaw: 78,
  chestYaw: 104,
  lean: 0.08,
  crouch: 0.07,
  stride: 1,
  heel: 1,
};
/** 마무리 끝: 배트가 몸 앞을 지나 왼쪽 어깨 뒤로 높이 감겨 올라간다. 몸은 투수 쪽을 향해 완전히 열린다 */
const WRAP: BatPose = {
  hands: { x: -0.66, y: 0.06, z: 1.5 },
  azimuth: 205,
  loft: 52,
  pelvisYaw: 122,
  chestYaw: 158,
  lean: 0.04,
  crouch: 0.04,
  stride: 1,
  heel: 1,
};

const lerpPose = (a: BatPose, b: BatPose, t: number): BatPose => ({
  hands: { x: lerp(a.hands.x, b.hands.x, t), y: lerp(a.hands.y, b.hands.y, t), z: lerp(a.hands.z, b.hands.z, t) },
  azimuth: lerp(a.azimuth, b.azimuth, t),
  loft: lerp(a.loft, b.loft, t),
  pelvisYaw: lerp(a.pelvisYaw, b.pelvisYaw, t),
  chestYaw: lerp(a.chestYaw, b.chestYaw, t),
  lean: lerp(a.lean, b.lean, t),
  crouch: lerp(a.crouch, b.crouch, t),
  stride: lerp(a.stride, b.stride, t),
  heel: lerp(a.heel, b.heel, t),
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

    // 체중 이동과 발: 앞발은 들었다 내디디고(착지 후 고정), 뒷발은 뒤꿈치가 들리며 회전한다
    const st = p.stride;
    const hl = p.heel;
    const base = toV3({ x: BODY.x, y: BODY.y + 0.08 * st + 0.06 * hl, z: 0 });
    const cf = fwd(rad(p.chestYaw));
    const cr = right(rad(p.chestYaw));
    // 앞팔(왼팔)은 팔꿈치가 아래·앞쪽을, 뒷팔(오른팔)은 팔꿈치가 바깥·살짝 위를 향한다
    const poleL = new THREE.Vector3(0, -1, 0).addScaledVector(cf, 0.7).addScaledVector(cr, -0.2);
    const poleR = new THREE.Vector3(0, -0.45, 0).addScaledVector(cr, 0.9).addScaledVector(cf, -0.35);
    const footL = toV3({ x: BODY.x + 0.02 + 0.05 * st, y: BODY.y + 0.34 + 0.18 * st, z: 0.26 * Math.sin(Math.PI * st) });
    const footR = toV3({ x: BODY.x + 0.12 + 0.04 * hl, y: BODY.y - 0.3 + 0.03 * hl, z: 0.05 * hl });
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
        poleL,
        poleR,
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
      stride: 1,
      heel: 0.7,
    };
  }

  /** 로드(앞발 내딛기 + 손·배트 뒤로 당김) 진행도 L: 0=준비, 1=로드 완료. 투구 직후 자동으로 진행된다 */
  loadAt(load: number): void {
    this.setPose(lerpPose(STANCE, LOADED, smooth(0, 1, clamp01(load))));
  }

  /**
   * 스윙 진행도 u: 0=로드 자세에서 출발, 1=타격(공 위치), 2=마무리. load: 스윙 시작 시점의 로드 진행도.
   * 실제 스윙처럼 골반이 먼저 돌고 → 어깨 → 손 → 배트 머리 순서로 늦게 따라온다(배트 머리가 뒤에서 끌려 나옴).
   */
  poseAtProgress(target: Location, u: number, load = 1): void {
    const c = this.contactPose(target);
    const start = lerpPose(STANCE, LOADED, smooth(0, 1, clamp01(load)));
    if (u <= 1) {
      const e = (a: number, b: number) => smooth(a, b, u);
      this.setPose({
        hands: lerp3(start.hands, c.hands, e(0, 0.8)),
        azimuth: lerp(start.azimuth, c.azimuth, e(0.3, 1)),
        loft: lerp(start.loft, c.loft, e(0.05, 0.85)),
        pelvisYaw: lerp(start.pelvisYaw, c.pelvisYaw, e(0, 0.75)),
        chestYaw: lerp(start.chestYaw, c.chestYaw, e(0.12, 0.92)),
        lean: lerp(start.lean, c.lean, u),
        crouch: lerp(start.crouch, c.crouch, u),
        stride: lerp(start.stride, c.stride, e(0, 0.3)),
        heel: lerp(start.heel, c.heel, e(0.2, 1)),
      });
    } else {
      const t = clamp01(u - 1);
      // 타격 → 투수 쪽으로 쭉 뻗고(0~0.45) → 몸 앞으로 감아 왼쪽 어깨 뒤로 감겨 올라간다(0.4~1)
      this.setPose(t <= 0.45 ? lerpPose(c, FOLLOW, smooth(0, 0.45, t)) : lerpPose(FOLLOW, WRAP, smooth(0.4, 1, t)));
    }
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
 * 손 위치는 가슴 기준 상대 좌표(앞 f / 오른쪽 r / 위 u)로 정의해 몸이 돌고 숙여도 팔이 자연스럽게 따라온다.
 *  - 던지는 팔: 가슴 앞 → 몸 뒤로 내림 → 어깨 높이로 접어 올림(코킹) → 머리 위로 뿌림 → 반대쪽 허리로 마무리
 *  - 글러브 팔: 가슴 앞 → 홈 쪽으로 뻗어 균형 → 릴리스와 함께 가슴으로 당김
 */
export class PitcherRig {
  readonly humanoid: Humanoid;
  readonly object = new THREE.Group();
  private joints = emptyJoints();
  private readonly scale = 1.05;

  constructor() {
    this.humanoid = new Humanoid(
      { jersey: HOME_COLORS.jersey, pants: 0xf7f7fa, cap: HOME_COLORS.cap, skin: SKIN, shoes: 0x1a1a1f },
      this.scale,
      undefined,
      'cap',
      'L',
    );
    this.object.add(this.humanoid.root);
    this.setProgress(0);
  }

  setTeamColors(c: TeamColors) {
    this.humanoid.setColors(c.jersey, c.pants, c.cap);
  }

  /** 진행도 τ의 관절 위치를 계산한다 */
  computeJoints(tau: number): Joints {
    // 마운드 중심 기준 상대 좌표 (x=오른쪽, y=홈 쪽이 음수, z=마운드 윗면 기준 높이)
    const W = (x: number, y: number, z: number) => toV3({ x, y: MOUND.y + y, z: MOUND.height + z });
    const rel = (f: number, r: number, u: number) => new THREE.Vector3(f, r, u);
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
    const handR = keyed(tau, [
      [0, rel(0.14, 0.04, -0.3)],
      [0.3, rel(0.16, 0.04, -0.2)],
      [0.5, rel(-0.3, 0.42, -0.42)], // 몸 뒤로 내려 팔을 편다
      [0.66, rel(-0.12, 0.52, 0.28)], // 어깨 높이로 접어 올린 코킹
      [0.84, rel(0.22, 0.34, 0.5)], // 머리 위를 지나
      [1.0, rel(0.4, 0.26, 0.42)], // 릴리스: 가슴 앞 위쪽
      [1.2, rel(0.34, 0.0, -0.22)],
      [1.4, rel(0.28, -0.1, -0.5)], // 반대쪽 허리로 내려오며 마무리
    ]);
    const handL = keyed(tau, [
      [0, rel(0.14, -0.04, -0.3)],
      [0.3, rel(0.16, -0.04, -0.2)],
      [0.5, rel(0.42, -0.2, 0.02)], // 글러브를 홈 쪽으로 뻗어 균형
      [0.85, rel(0.4, -0.22, 0.1)],
      [1.05, rel(0.22, -0.2, -0.12)], // 릴리스와 함께 가슴으로 당김
      [1.3, rel(0.14, -0.15, -0.28)],
      [1.4, rel(0.14, -0.15, -0.28)],
    ]);

    const pelvisYaw = rad(keyedNum(tau, [[0, -100], [0.3, -150], [0.5, -150], [1.0, -78], [1.4, -62]]));
    const chestYaw = rad(keyedNum(tau, [[0, -110], [0.3, -155], [0.55, -150], [0.8, -105], [1.0, -75], [1.4, -50]]));
    const lean = keyedNum(tau, [[0, 0.04], [0.3, 0.0], [0.7, 0.12], [1.0, 0.5], [1.4, 0.7]]);
    const crouch = keyedNum(tau, [[0, 0], [0.3, 0.0], [0.62, 0.12], [1.0, 0.22], [1.4, 0.3]]);

    // 팔꿈치 방향: 던지는 팔은 코킹 때 바깥쪽(오른쪽)으로, 뿌릴 땐 아래로. 글러브 팔은 아래·바깥으로 굽힌다
    const outward = right(chestYaw);
    const poleR = new THREE.Vector3(0, -0.3, 0).addScaledVector(outward, keyedNum(tau, [[0, 0.3], [0.45, 0.4], [0.66, 1.0], [0.9, 0.6], [1.0, 0.2]]));
    const poleL = new THREE.Vector3(0, -1, 0).addScaledVector(outward, -0.7);

    return bodyJoints(
      {
        base,
        scale: this.scale,
        pelvisYaw,
        chestYaw,
        lean,
        crouch,
        footL,
        footR,
        handL: { f: handL.x, r: handL.y, u: handL.z },
        handR: { f: handR.x, r: handR.y, u: handR.z },
        headYaw: rad(-90),
        poleL,
        poleR,
      },
      this.joints,
    );
  }

  setProgress(tau: number) {
    this.humanoid.update(this.computeJoints(tau));
  }

  /** 던지는 손(오른손)의 월드 좌표(x=오른쪽, y=투수 쪽, z=위). 릴리스 지점 계산과 손에 쥔 공 표시에 쓴다 */
  rightHandWorld(tau?: number): Point3 {
    const j = tau === undefined ? this.joints : this.computeJoints(tau);
    return { x: j.handR.x, y: -j.handR.z, z: j.handR.y };
  }

  /** 릴리스(τ=1) 순간 공이 나오는 월드 좌표 */
  releasePoint(): Point3 {
    const keep = this.joints;
    this.joints = emptyJoints();
    const p = this.rightHandWorld(1);
    this.joints = keep;
    return p;
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
    this.humanoid = new Humanoid({ jersey: colors.jersey, pants: colors.pants, cap: colors.cap, skin: SKIN, shoes: 0xe8e8e8 }, scale, undefined, 'cap', 'L');
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
