import Phaser from 'phaser';
import { battingTeam, type GameState, type Team } from '@baseball/core';
import { ko } from '../i18n/ko';

/** 화면 위쪽에 겹쳐 보이는 작은 중계 스코어보드 */
export class Scoreboard {
  private scoreText: Record<Team, Phaser.GameObjects.Text>;
  private inning: Phaser.GameObjects.Text;
  private count: Phaser.GameObjects.Text;
  private bases: Phaser.GameObjects.Rectangle[] = [];
  private battingMark: Record<Team, Phaser.GameObjects.Rectangle>;

  constructor(scene: Phaser.Scene) {
    scene.add.rectangle(270, 0, 540, 104, 0x000000, 0.5).setOrigin(0.5, 0).setDepth(20);
    const rows: [Team, number, number][] = [
      ['away', 10, 0x1d2f6b],
      ['home', 54, 0xa11d22],
    ];
    this.scoreText = {} as Record<Team, Phaser.GameObjects.Text>;
    this.battingMark = {} as Record<Team, Phaser.GameObjects.Rectangle>;
    for (const [team, y, color] of rows) {
      scene.add.rectangle(10, y, 170, 38, color).setOrigin(0).setDepth(21);
      this.battingMark[team] = scene.add.rectangle(10, y, 6, 38, 0xffd23f).setOrigin(0).setDepth(22).setVisible(false);
      scene.add.text(26, y + 19, ko.team[team], { fontSize: '22px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(22);
      scene.add.rectangle(130, y, 50, 38, 0xf2f2f2).setOrigin(0).setDepth(21);
      this.scoreText[team] = scene.add
        .text(155, y + 19, '0', { fontSize: '28px', color: '#111111', fontStyle: 'bold' })
        .setOrigin(0.5)
        .setDepth(22);
    }
    this.inning = scene.add
      .text(262, 14, '', { fontSize: '22px', color: '#ffe066', fontStyle: 'bold' })
      .setOrigin(0.5, 0)
      .setDepth(22);
    // 베이스 다이아몬드
    const cx = 262;
    const cy = 70;
    const d = 17;
    for (const [x, y] of [[cx + d, cy], [cx, cy - d], [cx - d, cy]] as const) {
      this.bases.push(scene.add.rectangle(x, y, 13, 13, 0x555555).setAngle(45).setStrokeStyle(1, 0xaaaaaa).setDepth(22));
    }
    this.count = scene.add
      .text(400, 10, '', { fontSize: '19px', color: '#ffffff', lineSpacing: 3 })
      .setOrigin(0, 0)
      .setDepth(22);
  }

  update(s: GameState) {
    this.scoreText.away.setText(String(s.score.away));
    this.scoreText.home.setText(String(s.score.home));
    this.inning.setText(`${ko.inning(s.inning)} ${ko.half[s.half]}`);
    const bat = battingTeam(s);
    this.battingMark.away.setVisible(bat === 'away');
    this.battingMark.home.setVisible(bat === 'home');
    const dots = (n: number, max: number) => '●'.repeat(n) + '○'.repeat(max - n);
    this.count.setText(`B ${dots(s.balls, 3)}\nS ${dots(s.strikes, 2)}\nO ${dots(s.outs, 2)}`);
    this.bases.forEach((b, i) => b.setFillStyle(s.bases[i] ? 0xffcc00 : 0x555555));
  }
}
