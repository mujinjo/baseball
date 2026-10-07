import Phaser from 'phaser';
import { GRID_EDGES, gridCells, type GridCell, type Location } from '@baseball/core';
import { toScreen } from '../game/geometry';

/** 포수 시점 스트라이크존 5×5 격자. 안쪽 9칸=스트라이크, 바깥 한 겹=볼존 */
export class ZoneGrid {
  private cells = gridCells();
  private rects: Phaser.GameObjects.Rectangle[] = [];
  private selected: GridCell | null = null;
  private enabled = false;
  private selectedColor = 0xffcc00;

  constructor(
    private scene: Phaser.Scene,
    private onSelect: (cell: GridCell) => void,
  ) {
    for (const cell of this.cells) {
      const x0 = GRID_EDGES[cell.col]!;
      const x1 = GRID_EDGES[cell.col + 1]!;
      const y0 = -GRID_EDGES[cell.row]!;
      const y1 = -GRID_EDGES[cell.row + 1]!;
      const a = toScreen({ x: x0, y: y0 });
      const b = toScreen({ x: x1, y: y1 });
      const r = scene.add
        .rectangle((a.x + b.x) / 2, (a.y + b.y) / 2, b.x - a.x, b.y - a.y, 0xffffff, 0)
        .setStrokeStyle(cell.inZone ? 2 : 1, cell.inZone ? 0xffffff : 0x667766, cell.inZone ? 0.8 : 0.5)
        .setInteractive({ useHandCursor: true });
      r.on('pointerdown', () => {
        if (!this.enabled) return;
        this.select(cell);
        this.onSelect(cell);
      });
      this.rects.push(r);
    }
    this.render();
  }

  setEnabled(v: boolean, selectedColor = 0xffcc00) {
    this.enabled = v;
    this.selectedColor = selectedColor;
    this.render();
  }

  select(cell: GridCell | null) {
    this.selected = cell;
    this.render();
  }

  clear() {
    this.select(null);
  }

  getSelected(): Location | null {
    return this.selected?.center ?? null;
  }

  private render() {
    // 타자 화면에서는 격자를 숨기고 존 테두리만 보이게 한다
    const visible = this.enabled || this.selected !== null;
    this.rects.forEach((r) => r.setVisible(visible));
    this.cells.forEach((cell, i) => {
      const isSel = this.selected === cell;
      const base = cell.inZone ? 0.12 : 0.04;
      this.rects[i]!
        .setFillStyle(isSel ? this.selectedColor : 0xffffff, isSel ? 0.55 : this.enabled ? base : 0.03);
    });
  }
}
