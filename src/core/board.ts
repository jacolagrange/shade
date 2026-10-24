// A sun sits in one corner of the board; shadows fall diagonally away from it.
export type Sun = 'TL' | 'TR' | 'BR' | 'BL';

export interface Puzzle {
  size: number;
  /** Region id for each cell, row-major. */
  regions: number[];
  /** Cell indices holding a picnic blanket. */
  blankets: number[];
  suns: Sun[];
  /** Column of the tree in each row. */
  solution: number[];
}

const SHADOW_STEP: Record<Sun, [number, number]> = {
  TL: [1, 1],
  TR: [1, -1],
  BR: [-1, -1],
  BL: [-1, 1],
};

/**
 * Cells shaded by a tree at `cell`, for every sun. The shadow runs through the
 * rest of the tree's own region, spills into the next region it reaches, and
 * stops at that region's edge (or the board's edge).
 */
export function shadowOf(size: number, regions: number[], suns: Sun[], cell: number): number[] {
  const out: number[] = [];
  const home = regions[cell];
  for (const sun of suns) {
    const [dr, dc] = SHADOW_STEP[sun];
    let r = Math.floor(cell / size) + dr;
    let c = (cell % size) + dc;
    let current = home;
    let spilled = false;
    while (r >= 0 && r < size && c >= 0 && c < size) {
      const reg = regions[r * size + c];
      if (reg !== current) {
        if (spilled) break;
        spilled = true;
        current = reg;
      }
      out.push(r * size + c);
      r += dr;
      c += dc;
    }
  }
  return out;
}

/** shadows[cell] = cells shaded by a tree standing on `cell`. */
export function shadowTable(size: number, regions: number[], suns: Sun[]): number[][] {
  return Array.from({ length: size * size }, (_, i) => shadowOf(size, regions, suns, i));
}

export interface Evaluation {
  /** Union of all placed trees' shadows. */
  shaded: Set<number>;
  /** Trees breaking a rule (duplicate row/col/region, or standing in shade). */
  badTrees: Set<number>;
  /** Rows, columns and regions holding more than one tree. */
  badRows: Set<number>;
  badCols: Set<number>;
  badRegions: Set<number>;
  shadedBlankets: Set<number>;
  solved: boolean;
}

export function evaluate(p: Puzzle, trees: Iterable<number>, shadows = shadowTable(p.size, p.regions, p.suns)): Evaluation {
  const list = [...trees];
  const n = p.size;
  const shaded = new Set<number>();
  for (const t of list) for (const s of shadows[t]) shaded.add(s);

  const count = (key: (t: number) => number) => {
    const m = new Map<number, number>();
    for (const t of list) m.set(key(t), (m.get(key(t)) ?? 0) + 1);
    return new Set([...m].filter(([, v]) => v > 1).map(([k]) => k));
  };
  const row = (t: number) => Math.floor(t / n);
  const col = (t: number) => t % n;
  const reg = (t: number) => p.regions[t];
  const badRows = count(row);
  const badCols = count(col);
  const badRegions = count(reg);

  const badTrees = new Set(
    list.filter((t) => shaded.has(t) || badRows.has(row(t)) || badCols.has(col(t)) || badRegions.has(reg(t))),
  );
  const shadedBlankets = new Set(p.blankets.filter((b) => shaded.has(b)));
  const solved = list.length === n && badTrees.size === 0 && shadedBlankets.size === p.blankets.length;
  return { shaded, badTrees, badRows, badCols, badRegions, shadedBlankets, solved };
}
