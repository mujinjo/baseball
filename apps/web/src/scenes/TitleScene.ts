import Phaser from 'phaser';
import { Button } from '../ui/Button';
import { ko } from '../i18n/ko';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('TitleScene');
  }

  create() {
    this.add.text(270, 260, ko.title, { fontSize: '48px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5);
    this.add
      .text(270, 330, ko.subtitle, { fontSize: '20px', color: '#cfe8cf', align: 'center', wordWrap: { width: 460 } })
      .setOrigin(0.5);
    new Button(this, 270, 500, 300, 70, ko.innings(3), () => this.scene.start('GameScene', { innings: 3 }), {
      fontSize: '28px',
    });
    new Button(this, 270, 590, 300, 70, ko.innings(9), () => this.scene.start('GameScene', { innings: 9 }), {
      fontSize: '28px',
    });
  }
}
