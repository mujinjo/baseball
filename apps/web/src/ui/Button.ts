import Phaser from 'phaser';

export interface ButtonStyle {
  fill?: number;
  selectedFill?: number;
  fontSize?: string;
}

export class Button extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Rectangle;
  private label: Phaser.GameObjects.Text;
  private fill: number;
  private selectedFill: number;
  private selected = false;
  private enabled = true;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    onClick: () => void,
    style: ButtonStyle = {},
  ) {
    super(scene, x, y);
    this.fill = style.fill ?? 0x2d4a35;
    this.selectedFill = style.selectedFill ?? 0xc9a227;
    this.bg = scene.add.rectangle(0, 0, w, h, this.fill).setStrokeStyle(2, 0x88aa88);
    this.label = scene.add
      .text(0, 0, text, { fontSize: style.fontSize ?? '22px', color: '#ffffff', align: 'center', wordWrap: { width: w - 12 } })
      .setOrigin(0.5);
    this.add([this.bg, this.label]);
    this.bg.setInteractive({ useHandCursor: true });
    this.bg.on('pointerdown', () => {
      if (this.enabled) onClick();
    });
    scene.add.existing(this);
  }

  setText(text: string) {
    this.label.setText(text);
    return this;
  }

  setSelected(v: boolean) {
    this.selected = v;
    this.bg.setFillStyle(v ? this.selectedFill : this.fill);
    this.label.setColor(v ? '#102010' : '#ffffff');
    return this;
  }

  setEnabled(v: boolean) {
    this.enabled = v;
    this.setAlpha(v ? 1 : 0.4);
    return this;
  }

  isSelected() {
    return this.selected;
  }
}
