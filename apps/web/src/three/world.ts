import * as THREE from 'three';
import { PLATE_WIDTH_M } from '../game/geometry';

/** 월드(x, y=투수 쪽) 평면 위의 점 → three.js 좌표 */
const flat = (x: number, y: number, h: number) => new THREE.Vector3(x, h, -y);

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
}

/** 간단한 시드 난수 (장식이 항상 같게) */
function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** 지면 위에 깔리는 얇은 도형. 깊이 충돌을 피하려고 polygonOffset과 renderOrder를 쓴다 */
function groundMaterial(color: number | THREE.Texture, order: number) {
  const m = new THREE.MeshLambertMaterial({
    ...(typeof color === 'number' ? { color } : { map: color }),
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -order,
    polygonOffsetUnits: -order,
  });
  return m;
}

function polygonMesh(points: [number, number][], material: THREE.Material, order: number, h = 0.002): THREE.Mesh {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2); // (x, y, 0) → (x, 0, -y)
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = h;
  mesh.renderOrder = order;
  return mesh;
}

/** 폴리라인을 일정한 폭의 띠로 만든다(지면 위 선) */
function ribbon(points: [number, number][], width: number, material: THREE.Material, order: number, h = 0.004): THREE.Mesh {
  const pos: number[] = [];
  const idx: number[] = [];
  points.forEach(([x, y], i) => {
    const a = points[Math.max(0, i - 1)]!;
    const b = points[Math.min(points.length - 1, i + 1)]!;
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const nx = -dy * (width / 2);
    const ny = dx * (width / 2);
    pos.push(x + nx, h, -(y + ny), x - nx, h, -(y - ny));
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.renderOrder = order;
  return m;
}

const circlePts = (cx: number, cy: number, r: number, n = 72): [number, number][] =>
  Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * r, cy + Math.sin((i / n) * Math.PI * 2) * r]);

export interface WorldRefs {
  scoreboard: THREE.Mesh;
}

/** 구장(야간)을 만든다. 단위 m, 원점은 홈플레이트 중앙 */
export function buildWorld(scene: THREE.Scene): WorldRefs {
  const r = rng(11);
  scene.background = canvasTexture(4, 256, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#02040a');
    grd.addColorStop(0.7, '#0a1426');
    grd.addColorStop(1, '#17284a');
    g.fillStyle = grd;
    g.fillRect(0, 0, 4, 256);
  });
  scene.fog = new THREE.FogExp2(0x070d1a, 0.0032);

  // ── 조명 ──
  scene.add(new THREE.HemisphereLight(0xb4c4f0, 0x4a3828, 0.95));
  const key = new THREE.DirectionalLight(0xfff4e0, 1.25);
  key.position.set(6, 24, 30);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x7fa0ff, 0.35);
  fill.position.set(-20, 10, -10);
  scene.add(fill);

  // ── 지면 ──
  const grassTex = canvasTexture(
    64,
    128,
    (g) => {
      g.fillStyle = '#1b5e2a';
      g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#216d31';
      g.fillRect(0, 64, 64, 64);
      for (let i = 0; i < 400; i++) {
        g.fillStyle = r() > 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)';
        g.fillRect(r() * 64, r() * 128, 1, 2);
      }
    },
    [8, 80],
  );
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshLambertMaterial({ map: grassTex }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(0, 0, -300);
  scene.add(grass);

  const dirtTex = canvasTexture(
    256,
    256,
    (g) => {
      g.fillStyle = '#9c5d3b';
      g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 2600; i++) {
        const c = r();
        g.fillStyle = c > 0.66 ? 'rgba(60,30,15,0.28)' : c > 0.33 ? 'rgba(220,150,100,0.22)' : 'rgba(255,255,255,0.06)';
        g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2);
      }
    },
    [3, 3],
  );
  const dirt = (order: number) => groundMaterial(dirtTex, order);

  // 내야 흙(스킨): 마운드를 중심으로 한 큰 원 + 홈 주변 원 (먼 쪽은 좌우를 모은다)
  scene.add(polygonMesh(circlePts(0, 19, 27), dirt(1), 1, 0.002));
  scene.add(polygonMesh(circlePts(0, 0.5, 5.2), dirt(3), 3, 0.005));
  // 안쪽 잔디 다이아몬드
  const diamond: [number, number][] = [
    [0, 8.2],
    [16.4, 19.4],
    [0, 35.4],
    [-16.4, 19.4],
  ];
  const dense: [number, number][] = [];
  for (let i = 0; i < diamond.length; i++) {
    const a = diamond[i]!;
    const b = diamond[(i + 1) % diamond.length]!;
    for (let k = 0; k < 12; k++) dense.push([a[0] + ((b[0] - a[0]) * k) / 12, a[1] + ((b[1] - a[1]) * k) / 12]);
  }
  const lawn = new THREE.MeshLambertMaterial({ map: grassTex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  scene.add(polygonMesh(dense, lawn, 2, 0.003));

  // 마운드(투수판까지 18.44m)
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.7, 0.25, 40), dirt(4));
  mound.position.copy(flat(0, 18.44, 0.125));
  scene.add(mound);
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.15), new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
  rubber.position.copy(flat(0, 18.44, 0.26));
  scene.add(rubber);

  // ── 흰 선: 파울 라인, 타석 박스, 홈플레이트 ──
  const chalk = new THREE.MeshLambertMaterial({ color: 0xf3f0e8, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  for (const side of [-1, 1]) {
    const line: [number, number][] = [];
    for (let t = 0.2; t <= 110; t += t < 10 ? 0.5 : 4) line.push([side * t, t]);
    scene.add(ribbon(line, 0.12, chalk, 6, 0.01));
  }
  const half = PLATE_WIDTH_M / 2;
  const boxIn = half + 0.152;
  // 타석 박스: 실제(1.22×1.83m)보다 작게 줄여 화면을 덜 가리게 한다
  const boxOut = boxIn + 0.9;
  const boxY = 0.7;
  for (const side of [-1, 1]) {
    const rect: [number, number][] = [
      [side * boxIn, boxY],
      [side * boxOut, boxY],
      [side * boxOut, -boxY],
      [side * boxIn, -boxY],
      [side * boxIn, boxY],
    ];
    scene.add(ribbon(rect, 0.05, chalk, 6, 0.012));
  }
  const plate = polygonMesh(
    [
      [-half, 0.216],
      [half, 0.216],
      [half, 0],
      [0, -0.216],
      [-half, 0],
    ],
    new THREE.MeshLambertMaterial({ color: 0xf6f3ea, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }),
    8,
    0.016,
  );
  scene.add(plate);

  // 베이스: 실제 위치(1루·3루는 이 카메라 시야 밖, 2루는 투수 뒤에 보임)
  const baseMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  for (const [bx, by] of [
    [19.4, 19.4],
    [-19.4, 19.4],
    [0, 38.8],
  ] as const) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.09, 0.46), baseMat);
    b.position.copy(flat(bx, by, 0.05));
    b.rotation.y = Math.PI / 4;
    scene.add(b);
  }

  // ── 외야 펜스, 관중석, 전광판 ──
  const wallY = 105;
  const adTex = canvasTexture(1024, 64, (g) => {
    g.fillStyle = '#0f1830';
    g.fillRect(0, 0, 1024, 64);
    const cols = ['#1f4fb0', '#f2f2f2', '#1f7a3a', '#b02a2a', '#f0b020'];
    for (let i = 0; i < 12; i++) {
      g.fillStyle = cols[i % cols.length]!;
      g.fillRect(i * 85 + 4, 6, 77, 52);
      g.fillStyle = i % cols.length === 1 || i % cols.length === 4 ? '#222' : '#fff';
      g.fillRect(i * 85 + 14, 24, 57, 8);
      g.fillRect(i * 85 + 24, 38, 37, 5);
    }
  });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(300, 3.2), new THREE.MeshBasicMaterial({ map: adTex }));
  wall.position.copy(flat(0, wallY - 0.3, 1.6));
  scene.add(wall);
  const track = new THREE.Mesh(new THREE.PlaneGeometry(300, 9), new THREE.MeshLambertMaterial({ color: 0x7d4b2c }));
  track.rotation.x = -Math.PI / 2;
  track.position.copy(flat(0, wallY - 5, 0.01));
  scene.add(track);

  const crowd = canvasTexture(1024, 256, (g) => {
    g.fillStyle = '#12151d';
    g.fillRect(0, 0, 1024, 256);
    const cols = ['#7a3b3b', '#3b5a7a', '#b0a070', '#4a4a55', '#c04040', '#d0d0d0'];
    for (let i = 0; i < 3800; i++) {
      g.fillStyle = cols[Math.floor(r() * cols.length)]!;
      g.fillRect(r() * 1024, r() * 256, 3, 4);
    }
  });
  const stands = new THREE.Mesh(new THREE.PlaneGeometry(300, 26), new THREE.MeshBasicMaterial({ map: crowd }));
  stands.rotation.x = -0.55;
  stands.position.copy(flat(0, wallY + 8, 14));
  scene.add(stands);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(300, 3, 6), new THREE.MeshLambertMaterial({ color: 0x151822 }));
  upper.position.copy(flat(0, wallY + 20, 29));
  scene.add(upper);

  const sbTex = canvasTexture(512, 240, (g) => {
    g.fillStyle = '#090d18';
    g.fillRect(0, 0, 512, 240);
    g.fillStyle = '#12347a';
    g.fillRect(8, 8, 496, 224);
    g.fillStyle = '#0b2150';
    g.fillRect(8, 8, 496, 30);
    g.fillStyle = '#dfe7ff';
    for (let i = 0; i < 16; i++) g.fillRect(18 + i * 30, 16, 22, 14);
    g.fillStyle = '#0a1a44';
    g.fillRect(18, 50, 230, 170);
    g.fillRect(258, 50, 236, 170);
    for (let k = 0; k < 8; k++) {
      g.fillStyle = k % 3 === 0 ? '#ffd23f' : '#dfe7ff';
      g.fillRect(28, 60 + k * 20, 40 + ((k * 37) % 120), 10);
      g.fillStyle = '#dfe7ff';
      g.fillRect(268, 60 + k * 20, 30 + ((k * 53) % 150), 10);
    }
    g.fillStyle = '#c41e2a';
    g.fillRect(258, 190, 236, 30);
  });
  const scoreboard = new THREE.Mesh(new THREE.PlaneGeometry(30, 14), new THREE.MeshBasicMaterial({ map: sbTex }));
  scoreboard.position.copy(flat(1.5, wallY + 3, 15.5));
  scene.add(scoreboard);

  // ── 스카이라인과 조명탑 ──
  const skyline = canvasTexture(128, 256, (g) => {
    g.fillStyle = '#0b101b';
    g.fillRect(0, 0, 128, 256);
    for (let y = 8; y < 256; y += 14) {
      for (let x = 6; x < 128; x += 14) {
        if (r() > 0.55) {
          g.fillStyle = r() > 0.5 ? '#6a6a45' : '#8a8a60';
          g.fillRect(x, y, 5, 7);
        }
      }
    }
  });
  const bMat = new THREE.MeshBasicMaterial({ map: skyline });
  for (let i = 0; i < 46; i++) {
    const h = 18 + r() * 70;
    const w = 14 + r() * 18;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 10), bMat);
    b.position.copy(flat(-300 + i * 13 + r() * 6, 190 + r() * 40, h / 2));
    scene.add(b);
  }
  const glow = canvasTexture(128, 128, (g) => {
    const grd = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    grd.addColorStop(0, 'rgba(210,225,255,0.95)');
    grd.addColorStop(0.3, 'rgba(160,190,255,0.35)');
    grd.addColorStop(1, 'rgba(120,160,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  });
  for (const [x, y] of [
    [-38, 100],
    [-70, 115],
    [60, 110],
    [95, 120],
  ] as const) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 46, 8), new THREE.MeshLambertMaterial({ color: 0x1d222c }));
    pole.position.copy(flat(x, y, 23));
    scene.add(pole);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(9, 5, 0.8), new THREE.MeshBasicMaterial({ color: 0xf2f7ff }));
    panel.position.copy(flat(x, y - 1, 47));
    scene.add(panel);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    sprite.scale.set(70, 70, 1);
    sprite.position.copy(flat(x, y - 2, 47));
    scene.add(sprite);
  }
  return { scoreboard };
}
