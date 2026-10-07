import Phaser from 'phaser';
import { FOUL_LINE_DEG, fenceDistance, type BattedBallTrace } from '@baseball/core';
import { ko } from '../i18n/ko';

/** 타구 연출용 위에서 본 구장. 홈플레이트가 아래, 외야가 위 */
const HOME = { x: 270, y: 790 };
/** 1m당 픽셀 */
const SCALE = 3.2;
/** 공 높이 1m당 화면 위로 띄우는 픽셀 */
const HEIGHT_PX = 2.2;
const TOP = 200;

export const toField = (angleDeg: number, distM: number) => {
  const a = (angleDeg * Math.PI) / 180;
  return { x: HOME.x + Math.sin(a) * distM * SCALE, y: HOME.y - Math.cos(a) * distM * SCALE };
};

export class FieldView {
  private container: Phaser.GameObjects.Container;
  private shadow: Phaser.GameObjects.Ellipse;
  private ball: Phaser.GameObjects.Arc;
  private marker: Phaser.GameObjects.Graphics;
  private distText: Phaser.GameObjects.Text;
  private tween: Phaser.Tweens.Tween | null = null;

  constructor(private scene: Phaser.Scene) {
    const c = scene.add.container(0, 0).setDepth(40).setVisible(false);
    c.add(this.drawField());
    this.shadow = scene.add.ellipse(0, 0, 14, 7, 0x000000, 0.45);
    this.ball = scene.add.circle(0, 0, 6, 0xffffff).setStrokeStyle(2, 0xcc3333);
    this.marker = scene.add.graphics();
    this.distText = scene.add
      .text(0, 0, '', { fontSize: '34px', color: '#ffe066', fontStyle: 'bold', stroke: '#000000', strokeThickness: 6 })
      .setOrigin(0.5);
    c.add([this.marker, this.shadow, this.ball, this.distText]);
    this.container = c;
  }

  private drawField() {
    const g = this.scene.add.graphics();
    g.fillStyle(0x16331f, 1).fillRect(0, TOP, 540, 960 - TOP);

    // 페어 지역 잔디: 홈 → 좌측 파울라인 → 펜스 → 우측 파울라인
    const pts: { x: number; y: number }[] = [HOME];
    for (let a = -FOUL_LINE_DEG; a <= FOUL_LINE_DEG; a += 3) pts.push(toField(a, fenceDistance(a)));
    g.fillStyle(0x2a6a38, 1).fillPoints(pts, true);

    // 내야 흙과 다이아몬드
    const mound = toField(0, 18.4);
    g.fillStyle(0x8a6a3a, 0.9).fillCircle(mound.x, mound.y, 27 * SCALE);
    const b1 = toField(45, 27.4);
    const b2 = toField(0, 38.8);
    const b3 = toField(-45, 27.4);
    g.fillStyle(0x2a6a38, 1).fillPoints([HOME, b1, b2, b3], true);
    g.fillStyle(0x8a6a3a, 1).fillCircle(mound.x, mound.y, 2.2 * SCALE);
    g.lineStyle(2, 0xffffff, 0.8).strokePoints([HOME, b1, b2, b3, HOME], true);
    for (const b of [b1, b2, b3]) g.fillStyle(0xffffff, 1).fillRect(b.x - 5, b.y - 5, 10, 10);
    g.fillStyle(0xffffff, 1).fillCircle(HOME.x, HOME.y, 6);

    // 파울 라인
    for (const side of [-1, 1]) {
      const end = toField(side * FOUL_LINE_DEG, fenceDistance(FOUL_LINE_DEG));
      g.lineStyle(2, 0xffffff, 0.9).lineBetween(HOME.x, HOME.y, end.x, end.y);
    }

    // 거리 표시선
    const labels: Phaser.GameObjects.Text[] = [];
    for (const d of [40, 80]) {
      const arc: { x: number; y: number }[] = [];
      for (let a = -FOUL_LINE_DEG; a <= FOUL_LINE_DEG; a += 3) arc.push(toField(a, d));
      g.lineStyle(1, 0xffffff, 0.25).strokePoints(arc, false);
      const p = toField(0, d);
      labels.push(this.scene.add.text(p.x + 70, p.y - 2, ko.distance(d), { fontSize: '14px', color: '#9fc9a6' }).setOrigin(0, 1));
    }

    // 외야 펜스
    const fence: { x: number; y: number }[] = [];
    for (let a = -FOUL_LINE_DEG; a <= FOUL_LINE_DEG; a += 3) fence.push(toField(a, fenceDistance(a)));
    g.lineStyle(6, 0x2b4f8f, 1).strokePoints(fence, false);

    const holder = this.scene.add.container(0, 0, [g, ...labels]);
    return holder;
  }

  /** 타구를 날려 보낸다. 착지(포구) 후 onLanded 호출 */
  show(trace: BattedBallTrace, onLanded: () => void) {
    this.hideTween();
    this.container.setVisible(true);
    this.marker.clear();
    this.distText.setText('');
    const dur = trace.durationMs;
    const state = { p: 0 };
    this.place(trace, 0);
    this.tween = this.scene.tweens.add({
      targets: state,
      p: 1,
      duration: dur,
      ease: 'Linear',
      onUpdate: () => this.place(trace, state.p),
      onComplete: () => {
        this.land(trace);
        onLanded();
      },
    });
  }

  hide() {
    this.hideTween();
    this.container.setVisible(false);
  }

  private hideTween() {
    this.tween?.stop();
    this.tween = null;
  }

  private place(trace: BattedBallTrace, p: number) {
    const ground = trace.kind === 'ground';
    // 땅볼은 감속하며 굴러가고, 나머지는 일정한 속도로 날아간다
    const travel = ground ? 1 - Math.pow(1 - p, 2) : p;
    const g = toField(trace.angleDeg, trace.distanceM * travel);
    const height = ground ? trace.apexM * Math.abs(Math.sin(p * Math.PI * 4)) * (1 - p) : trace.apexM * 4 * p * (1 - p);
    this.shadow.setPosition(g.x, g.y).setScale(1 + height * 0.01);
    this.ball.setPosition(g.x, g.y - height * HEIGHT_PX).setRadius(5 + height * 0.08);
  }

  private land(trace: BattedBallTrace) {
    const g = toField(trace.angleDeg, trace.distanceM);
    this.shadow.setPosition(g.x, g.y);
    this.ball.setPosition(g.x, g.y).setRadius(5);
    this.marker.lineStyle(3, 0xffe066, 1).strokeCircle(g.x, g.y, 14);
    const tx = Math.min(480, Math.max(60, g.x));
    const ty = Math.max(TOP + 30, g.y - 38);
    this.distText.setPosition(tx, ty).setText(ko.distance(trace.distanceM));
  }
}
