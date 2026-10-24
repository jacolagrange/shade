import { shadowTable, type Sun } from './board';

/**
 * Every tree placement (column per row) that satisfies the row, column, region
 * and shadow rules and shades every blanket. Stops after `cap` solutions.
 */
export function solveAll(
  size: number,
  regions: number[],
  suns: Sun[],
  blankets: number[],
  cap = Infinity,
): number[][] {
  const shadows = shadowTable(size, regions, suns);
  const cells = size * size;
  // blocks[a * cells + b]: trees on a and b can't coexist because one shades the other.
  const blocks = new Uint8Array(cells * cells);
  for (let a = 0; a < cells; a++) {
    for (const b of shadows[a]) {
      blocks[a * cells + b] = 1;
      blocks[b * cells + a] = 1;
    }
  }

  const solutions: number[][] = [];
  const cols = new Array<number>(size);
  const placed: number[] = [];
  const usedCol = new Uint8Array(size);
  const usedRegion = new Uint8Array(size);

  const blanketsCovered = () => {
    for (const b of blankets) {
      if (!placed.some((t) => shadows[t].includes(b))) return false;
    }
    return true;
  };

  const place = (row: number): boolean => {
    if (row === size) {
      if (blanketsCovered()) solutions.push([...cols]);
      return solutions.length >= cap;
    }
    for (let c = 0; c < size; c++) {
      const cell = row * size + c;
      const reg = regions[cell];
      if (usedCol[c] || usedRegion[reg]) continue;
      if (placed.some((t) => blocks[t * cells + cell])) continue;
      usedCol[c] = usedRegion[reg] = 1;
      cols[row] = c;
      placed.push(cell);
      const done = place(row + 1);
      placed.pop();
      usedCol[c] = usedRegion[reg] = 0;
      if (done) return true;
    }
    return false;
  };

  place(0);
  return solutions;
}
