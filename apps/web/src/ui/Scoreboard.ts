import Phaser from 'phaser';
import { battingTeam, type GameState } from '@baseball/core';
import { ko } from '../i18n/ko';

export class Scoreboard {
  private head: Phaser.GameObjects.Text;
  private score: Phaser.GameObjects.Text;
  private count: Phaser.GameObjects.Text;
  private bases: Phaser.GameObjects.Rectangle[] = [];

  constructor(scene: Phaser.Scene) {
    this.head = scene.add.text(270, 18, '', { fontSize: '24px', color: '#ffe066' }).setOrigin(0.5, 0);
    this.score = scene.add.text(270, 52, '', { fontSize: '34px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5, 0);
    this.count = scene.add.text(110, 112, '', { fontSize: '22px', color: '#cfe8cf', lineSpacing: 6 }).setOrigin(0.5, 0);
    const cx = 430;
    const cy = 135;
    const d = 28;
    for (const [x, y] of [[cx + d, cy], [cx, cy - d], [cx - d, cy]] as const) {
      this.bases.push(scene.add.rectangle(x, y, 20, 20, 0x444444).setAngle(45).setStrokeStyle(1, 0x88aa88));
    }
  }

  update(s: GameState) {
    this.head.setText(`${ko.inning(s.inning)} ${ko.half[s.half]} · ${ko.team[battingTeam(s)]} 공격`);
    this.score.setText(`${ko.team.away} ${s.score.away} : ${s.score.home} ${ko.team.home}`);
    const dots = (n: number, max: number) => '●'.repeat(n) + '○'.repeat(max - n);
    this.count.setText(`B ${dots(s.balls, 3)}\nS ${dots(s.strikes, 2)}\nO ${dots(s.outs, 2)}`);
    this.bases.forEach((b, i) => b.setFillStyle(s.bases[i] ? 0xffcc00 : 0x444444));
  }
}
