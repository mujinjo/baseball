import Phaser from 'phaser';
import { AI_LEVELS, type AiLevel, type Team } from '@baseball/core';
import { Button } from '../ui/Button';
import { ko } from '../i18n/ko';

export interface GameOptions {
  innings: number;
  level: AiLevel;
  /** 사람이 맡는 팀 (나머지는 컴퓨터) */
  humanTeam: Team;
}

export class TitleScene extends Phaser.Scene {
  private level: AiLevel = 'normal';
  private humanTeam: Team = 'away';

  constructor() {
    super('TitleScene');
  }

  create() {
    this.add.text(270, 170, ko.title, { fontSize: '48px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5);
    this.add
      .text(270, 235, ko.subtitle, { fontSize: '20px', color: '#cfe8cf', align: 'center', wordWrap: { width: 460 } })
      .setOrigin(0.5);

    this.add.text(270, 330, ko.levelLabel, { fontSize: '18px', color: '#cfe8cf' }).setOrigin(0.5);
    const levelButtons = AI_LEVELS.map(
      (l, i) =>
        new Button(this, 110 + i * 160, 375, 140, 56, ko.level[l], () => {
          this.level = l;
          refresh();
        }, { fontSize: '22px' }),
    );

    this.add.text(270, 450, ko.sideLabel, { fontSize: '18px', color: '#cfe8cf' }).setOrigin(0.5);
    const teams: Team[] = ['away', 'home'];
    const sideButtons = teams.map(
      (t, i) =>
        new Button(this, 150 + i * 240, 495, 220, 56, ko.side[t], () => {
          this.humanTeam = t;
          refresh();
        }, { fontSize: '20px' }),
    );

    const refresh = () => {
      levelButtons.forEach((b, i) => b.setSelected(AI_LEVELS[i] === this.level));
      sideButtons.forEach((b, i) => b.setSelected(teams[i] === this.humanTeam));
    };
    refresh();

    for (const [i, innings] of [3, 9].entries()) {
      new Button(this, 270, 620 + i * 90, 320, 70, ko.start(innings), () => this.begin(innings), {
        fontSize: '26px',
        fill: 0x8a4b12,
      });
    }
  }

  private begin(innings: number) {
    const opts: GameOptions = { innings, level: this.level, humanTeam: this.humanTeam };
    this.scene.start('GameScene', opts);
  }
}
