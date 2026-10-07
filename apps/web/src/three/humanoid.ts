import * as THREE from 'three';

/**
 * 관절 위치만으로 자세를 표현하는 사람 모형. 팔다리는 두 관절 사이를 잇는 원기둥, 관절은 구로 그린다.
 * 모든 좌표는 three.js 월드 좌표(x=오른쪽, y=위, z=카메라 쪽)다.
 */
export interface Joints {
  pelvis: THREE.Vector3;
  chest: THREE.Vector3;
  neck: THREE.Vector3;
  head: THREE.Vector3;
  shoulderL: THREE.Vector3;
  shoulderR: THREE.Vector3;
  elbowL: THREE.Vector3;
  elbowR: THREE.Vector3;
  handL: THREE.Vector3;
  handR: THREE.Vector3;
  hipL: THREE.Vector3;
  hipR: THREE.Vector3;
  kneeL: THREE.Vector3;
  kneeR: THREE.Vector3;
  footL: THREE.Vector3;
  footR: THREE.Vector3;
  /** 머리가 바라보는 방향(rotation.y) */
  headYaw: number;
}

export interface HumanoidColors {
  jersey: number;
  pants: number;
  cap: number;
  skin: number;
  shoes: number;
}

export const SKIN = 0xd9a07a;

export const emptyJoints = (): Joints => ({
  pelvis: new THREE.Vector3(),
  chest: new THREE.Vector3(),
  neck: new THREE.Vector3(),
  head: new THREE.Vector3(),
  shoulderL: new THREE.Vector3(),
  shoulderR: new THREE.Vector3(),
  elbowL: new THREE.Vector3(),
  elbowR: new THREE.Vector3(),
  handL: new THREE.Vector3(),
  handR: new THREE.Vector3(),
  hipL: new THREE.Vector3(),
  hipR: new THREE.Vector3(),
  kneeL: new THREE.Vector3(),
  kneeR: new THREE.Vector3(),
  footL: new THREE.Vector3(),
  footR: new THREE.Vector3(),
  headYaw: 0,
});

const UP = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

/** 두 뼈 IK: 어깨(a)에서 손(target)까지 닿는 팔꿈치(무릎) 위치. pole 쪽으로 굽는다 */
export function twoBone(
  a: THREE.Vector3,
  target: THREE.Vector3,
  l1: number,
  l2: number,
  pole: THREE.Vector3,
  out: THREE.Vector3,
): THREE.Vector3 {
  const d = tmpA.subVectors(target, a);
  const dist = Math.min(Math.max(d.length(), 1e-4), l1 + l2 - 1e-3);
  const dir = d.clone().normalize();
  const x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const p = tmpB.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (p.lengthSq() < 1e-6) p.set(0, -1, 0).addScaledVector(dir, dir.y);
  p.normalize();
  return out.copy(a).addScaledVector(dir, x).addScaledVector(p, h);
}

/** 두 점 사이를 잇는 원기둥(위쪽 반지름 1, 아래쪽은 taper 배) + 양 끝 구 */
class Limb {
  readonly group = new THREE.Group();
  private cyl: THREE.Mesh;
  private capA: THREE.Mesh;
  private capB: THREE.Mesh;

  constructor(mat: THREE.Material, taper = 0.85) {
    this.cyl = new THREE.Mesh(new THREE.CylinderGeometry(1, taper, 1, 14, 1, true), mat);
    this.capA = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mat);
    this.capB = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mat);
    this.group.add(this.cyl, this.capA, this.capB);
  }

  set(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number) {
    const len = a.distanceTo(b);
    this.cyl.position.copy(a).add(b).multiplyScalar(0.5);
    this.cyl.quaternion.setFromUnitVectors(UP, tmpA.subVectors(a, b).normalize());
    this.cyl.scale.set(ra, Math.max(len, 1e-4), ra);
    // 아래쪽 반지름을 맞추기 위해 비율을 geometry taper에 맡기고, rb는 캡 크기로만 사용
    this.capA.position.copy(a);
    this.capA.scale.setScalar(ra);
    this.capB.position.copy(b);
    this.capB.scale.setScalar(rb);
  }
}

const mat = (color: number, opts: THREE.MeshLambertMaterialParameters = {}) =>
  new THREE.MeshLambertMaterial({ color, ...opts });

/** 유니폼 줄무늬 텍스처 */
export function pinstripeTexture(base: string, stripe: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 16;
  const x = c.getContext('2d')!;
  x.fillStyle = base;
  x.fillRect(0, 0, 64, 16);
  x.fillStyle = stripe;
  for (let i = 0; i < 64; i += 8) x.fillRect(i, 0, 1.5, 16);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 3);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Humanoid {
  readonly root = new THREE.Group();
  readonly jerseyMat: THREE.MeshLambertMaterial;
  readonly capMat: THREE.MeshLambertMaterial;
  private pantsMat: THREE.MeshLambertMaterial;
  private skinMat: THREE.MeshLambertMaterial;
  private shoesMat: THREE.MeshLambertMaterial;
  private torso: THREE.Mesh;
  private pelvisMesh: THREE.Mesh;
  private headMesh: THREE.Mesh;
  private helmet: THREE.Group;
  private neckLimb: Limb;
  private armU: [Limb, Limb];
  private armL: [Limb, Limb];
  private hands: [THREE.Mesh, THREE.Mesh];
  private legU: [Limb, Limb];
  private legL: [Limb, Limb];
  private feet: [THREE.Mesh, THREE.Mesh];
  private flap: THREE.Mesh;

  constructor(
    colors: HumanoidColors,
    private scale = 1,
    jerseyMap?: THREE.Texture,
    private helmetStyle: 'helmet' | 'cap' = 'cap',
  ) {
    this.jerseyMat = mat(colors.jersey, jerseyMap ? { map: jerseyMap } : {});
    this.capMat = mat(colors.cap);
    this.pantsMat = mat(colors.pants);
    this.skinMat = mat(colors.skin);
    this.shoesMat = mat(colors.shoes);
    const s = scale;

    this.torso = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.82, 1, 20, 1), this.jerseyMat);
    this.pelvisMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), this.pantsMat);
    this.headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.105 * s, 18, 14), this.skinMat);
    this.neckLimb = new Limb(this.skinMat, 1);

    // 모자 / 헬멧: 윗반구 + 챙(+ 헬멧은 귀 보호대)
    this.helmet = new THREE.Group();
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.118 * s, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62),
      this.capMat,
    );
    shell.position.y = 0.012 * s;
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.15 * s, 0.012 * s, 0.1 * s), this.capMat);
    brim.position.set(0.1 * s, 0.01 * s, 0);
    this.flap = new THREE.Mesh(new THREE.BoxGeometry(0.07 * s, 0.1 * s, 0.015 * s), this.capMat);
    this.flap.position.set(0.01 * s, -0.05 * s, -0.105 * s);
    this.flap.visible = this.helmetStyle === 'helmet';
    this.helmet.add(shell, brim, this.flap);

    const sleeve = this.jerseyMat;
    this.armU = [new Limb(sleeve, 0.8), new Limb(sleeve, 0.8)];
    this.armL = [new Limb(this.skinMat, 0.75), new Limb(this.skinMat, 0.75)];
    this.hands = [
      new THREE.Mesh(new THREE.SphereGeometry(0.045 * s, 10, 8), mat(0xf4f4f6)),
      new THREE.Mesh(new THREE.SphereGeometry(0.045 * s, 10, 8), mat(0xf4f4f6)),
    ];
    this.legU = [new Limb(this.pantsMat, 0.8), new Limb(this.pantsMat, 0.8)];
    this.legL = [new Limb(this.pantsMat, 0.75), new Limb(this.pantsMat, 0.75)];
    // 신발: 앞뒤로 긴 둥근 형태 (캡슐을 눕혀 X축 방향으로)
    const shoe = () => {
      const geo = new THREE.CapsuleGeometry(0.045 * s, 0.17 * s, 4, 10);
      geo.rotateZ(Math.PI / 2);
      geo.scale(1, 0.85, 1.05);
      return new THREE.Mesh(geo, this.shoesMat);
    };
    this.feet = [shoe(), shoe()];

    this.root.add(
      this.torso,
      this.pelvisMesh,
      this.headMesh,
      this.neckLimb.group,
      this.helmet,
      ...this.armU.map((l) => l.group),
      ...this.armL.map((l) => l.group),
      ...this.hands,
      ...this.legU.map((l) => l.group),
      ...this.legL.map((l) => l.group),
      ...this.feet,
    );
  }

  setColors(jersey: number, pants: number, cap: number) {
    this.jerseyMat.color.setHex(jersey);
    this.pantsMat.color.setHex(pants);
    this.capMat.color.setHex(cap);
  }

  /** 관절 위치로 모형을 갱신한다 */
  update(j: Joints) {
    const s = this.scale;
    // 몸통: 골반→가슴 축, 어깨 방향을 폭 축으로
    const yAxis = tmpA.subVectors(j.chest, j.pelvis).normalize().clone();
    const wAxis = tmpB.subVectors(j.shoulderR, j.shoulderL).normalize().clone();
    wAxis.addScaledVector(yAxis, -wAxis.dot(yAxis)).normalize();
    const xAxis = new THREE.Vector3().crossVectors(yAxis, wAxis).normalize();
    const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, wAxis);
    const len = j.pelvis.distanceTo(j.chest);
    this.torso.position.copy(j.pelvis).add(j.chest).multiplyScalar(0.5);
    this.torso.quaternion.setFromRotationMatrix(basis);
    this.torso.scale.set(0.125 * s, len + 0.08 * s, 0.2 * s);
    this.pelvisMesh.position.copy(j.pelvis);
    this.pelvisMesh.quaternion.copy(this.torso.quaternion);
    this.pelvisMesh.scale.set(0.12 * s, 0.1 * s, 0.17 * s);

    this.neckLimb.set(j.chest.clone().lerp(j.neck, 0.6), j.head.clone().lerp(j.neck, 0.4), 0.05 * s, 0.05 * s);
    this.headMesh.position.copy(j.head);
    this.helmet.position.copy(j.head);
    this.helmet.rotation.y = j.headYaw;
    this.headMesh.rotation.y = j.headYaw;

    this.armU[0].set(j.shoulderL, j.elbowL, 0.062 * s, 0.05 * s);
    this.armU[1].set(j.shoulderR, j.elbowR, 0.062 * s, 0.05 * s);
    this.armL[0].set(j.elbowL, j.handL, 0.047 * s, 0.04 * s);
    this.armL[1].set(j.elbowR, j.handR, 0.047 * s, 0.04 * s);
    this.hands[0].position.copy(j.handL);
    this.hands[1].position.copy(j.handR);

    this.legU[0].set(j.hipL, j.kneeL, 0.085 * s, 0.07 * s);
    this.legU[1].set(j.hipR, j.kneeR, 0.085 * s, 0.07 * s);
    this.legL[0].set(j.kneeL, j.footL.clone().add(new THREE.Vector3(0, 0.07 * s, 0)), 0.068 * s, 0.05 * s);
    this.legL[1].set(j.kneeR, j.footR.clone().add(new THREE.Vector3(0, 0.07 * s, 0)), 0.068 * s, 0.05 * s);
    // 신발: 몸이 향한 방향(헬멧 방향이 아닌 골반 방향)으로
    const fwd = Math.atan2(-xAxis.z, xAxis.x);
    this.feet.forEach((f, i) => {
      const foot = i === 0 ? j.footL : j.footR;
      f.position.copy(foot).add(new THREE.Vector3(0, 0.045 * s, 0));
      f.rotation.y = fwd;
    });
  }
}
