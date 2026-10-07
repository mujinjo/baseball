import type { Location } from './pitch';

/** 5×5 코스 격자의 경계: 안쪽 3×3이 스트라이크존, 바깥 한 겹이 볼존 (존 좌표계) */
export const GRID_EDGES = [-1.7, -1, -1 / 3, 1 / 3, 1, 1.7] as const;

export interface GridCell {
  col: number;
  /** 0 = 맨 위(높은 공) */
  row: number;
  center: Location;
  inZone: boolean;
}

export function gridCells(): GridCell[] {
  const cells: GridCell[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const x0 = GRID_EDGES[col]!;
      const x1 = GRID_EDGES[col + 1]!;
      const yTop = -GRID_EDGES[row]!;
      const yBottom = -GRID_EDGES[row + 1]!;
      cells.push({
        col,
        row,
        center: { x: (x0 + x1) / 2, y: (yTop + yBottom) / 2 },
        inZone: col >= 1 && col <= 3 && row >= 1 && row <= 3,
      });
    }
  }
  return cells;
}
