import Phaser from 'phaser';
import { GROUND_Y, PX_PER_INCH } from '../game/geometry';

/** 스윙을 시작해서 배트가 타격 위치에 닿기까지 걸리는 시간. 타이밍 판정은 이 시점을 기준으로 한다 */
export const SWING_CONTACT_MS = 120;
const FOLLOW_THROUGH_MS = 150;

const REST_ANGLE = -35;
const BAT_LEN = 260;
/** 우타자는 포수 뒤에서 볼 때 홈플레이트 왼쪽 타석에 선다 */
const BODY_X = 88;
const PIVOT = { x: 142, y: 440 };
/** 몸 전체가 화면(스코어보드/관중석)을 가리지 않도록 실제 비율보다 조금 줄인다 */
const BODY_SCALE = 0.84;

/** 포수 뒤에서 본 우타자와 배트. 키는 실제 비율(6피트 ≈ 72인치)로 그린다 */
export class Batter {
  private bat: Phaser.GameObjects.Container;
  private trail: Phaser.GameObjects.Graphics;
  private trailPts: { x: number; y: number }[] = [];
  private tweens: Phaser.Tweens.Tween[] = [];

  constructor(private scene: Phaser.Scene) {
    this.drawBody();
    this.trail = scene.add.graphics().setDepth(5);
    const g = scene.add.graphics();
    g.fillStyle(0xb98a52, 1).fillRect(-3.5, -95, 7, 95); // 손잡이
    g.fillStyle(0xd8b176, 1).fillRoundedRect(-7, -BAT_LEN, 14, BAT_LEN - 85, 6); // 배트 머리
    g.fillStyle(0x6b4a2b, 1).fillCircle(0, 0, 5); // knob
    this.bat = scene.add.container(PIVOT.x, PIVOT.y, [g]).setDepth(6).setAngle(REST_ANGLE);
  }

  private drawBody() {
    const k = PX_PER_INCH * BODY_SCALE;
    const g = this.scene.add.graphics().setDepth(1);
    const foot = GROUND_Y + 10;
    const x = BODY_X;
    // 다리 (바닥~34인치), 어깨너비로 벌린 스탠스
    g.fillStyle(0x2c2c3a, 1)
      .fillRect(x - 46, foot - 34 * k, 34, 34 * k)
      .fillRect(x + 12, foot - 34 * k, 34, 34 * k);
    g.fillStyle(0x111111, 1).fillRect(x - 50, foot - 6, 42, 8).fillRect(x + 8, foot - 6, 42, 8); // 신발
    // 상체 (34~60인치)
    g.fillStyle(0xd9d9e0, 1).fillRect(x - 44, foot - 60 * k, 88, 26 * k);
    g.fillStyle(0x16224a, 1).fillRect(x - 44, foot - 36 * k, 88, 4 * k); // 허리띠
    // 팔: 어깨에서 손(배트 축)까지
    g.lineStyle(26, 0xd9d9e0, 1).lineBetween(x + 34, foot - 56 * k, PIVOT.x, PIVOT.y);
    g.fillStyle(0x222222, 1).fillCircle(PIVOT.x, PIVOT.y, 14); // 장갑
    // 목, 얼굴, 헬멧
    g.fillStyle(0xe6b88f, 1).fillRect(x - 10, foot - 66 * k, 20, 7 * k);
    const headY = foot - 69 * k;
    g.fillStyle(0xe6b88f, 1).fillCircle(x, headY, 30);
    g.fillStyle(0x16224a, 1).fillRect(x - 32, headY - 32, 64, 28).fillRect(x - 32, headY - 10, 24, 12); // 헬멧과 챙
  }

  reset() {
    this.tweens.forEach((t) => t.stop());
    this.tweens = [];
    this.bat.setAngle(REST_ANGLE);
    this.trail.clear().setAlpha(1);
    this.trailPts = [];
  }

  /** 공이 도착할 위치(화면 좌표)를 향해 스윙한다. 배트는 SWING_CONTACT_MS 뒤에 그 높이를 지난다 */
  swing(target: { x: number; y: number }) {
    this.reset();
    const contact = (Math.atan2(target.x - PIVOT.x, PIVOT.y - target.y) * 180) / Math.PI;
    const state = { a: REST_ANGLE };
    const onUpdate = () => {
      this.bat.setAngle(state.a);
      const r = (state.a * Math.PI) / 180;
      this.trailPts.push({ x: PIVOT.x + Math.sin(r) * BAT_LEN, y: PIVOT.y - Math.cos(r) * BAT_LEN });
      this.trail.clear().lineStyle(10, 0xffffff, 0.3).strokePoints(this.trailPts, false);
    };
    const t1 = this.scene.tweens.add({
      targets: state,
      a: contact,
      duration: SWING_CONTACT_MS,
      ease: 'Quad.easeIn',
      onUpdate,
      onComplete: () => {
        const t2 = this.scene.tweens.add({
          targets: state,
          a: contact + 45,
          duration: FOLLOW_THROUGH_MS,
          ease: 'Quad.easeOut',
          onUpdate,
          onComplete: () => this.scene.tweens.add({ targets: this.trail, alpha: 0, duration: 200 }),
        });
        this.tweens.push(t2);
      },
    });
    this.tweens.push(t1);
  }
}
