import { shadowTable, type Puzzle, type Sun } from './board';
import { shuffle, type Rng } from './rng';
import { solveAll } from './solver';

export interface GenerateOptions {
  size: number;
  suns: Sun[];
  /** Extra blankets beyond the ones needed for uniqueness, up to this total. */
  minBlankets?: number;
  maxAttempts?: number;
}

/**
 * Builds a puzzle with exactly one solution. Picks a hidden tree layout, grows
 * one region around each tree, then adds blankets until every other layout
 * that obeys the placement rules leaves some blanket in the sun.
 */
export function generate(rng: Rng, opts: GenerateOptions): Puzzle {
  const { size, suns, minBlankets = 2, maxAttempts = 2000 } = opts;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const solution = shuffle(rng, [...Array(size).keys()]);
    const trees = solution.map((c, r) => r * size + c);
    const regions = growRegions(rng, size, trees);
    if (!regions) continue;

    const shadows = shadowTable(size, regions, suns);
    const shaded = new Set(trees.flatMap((t) => shadows[t]));
    if (trees.some((t) => shaded.has(t))) continue;

    const all = solveAll(size, regions, suns, [], 20000);
    if (all.length >= 20000) continue;
    const key = solution.join();
    let rivals = all.filter((s) => s.join() !== key).map((s) => new Set(s.flatMap((c, r) => shadows[r * size + c])));
    // Blankets should matter: without them the board must be ambiguous.
    if (rivals.length === 0) continue;

    const candidates = shuffle(rng, [...shaded]);
    const blankets: number[] = [];
    while (rivals.length > 0) {
      let best = -1;
      let bestGain = 0;
      for (const cell of candidates) {
        if (blankets.includes(cell)) continue;
        const gain = rivals.filter((s) => !s.has(cell)).length;
        if (gain > bestGain) [best, bestGain] = [cell, gain];
      }
      if (best < 0) break;
      blankets.push(best);
      rivals = rivals.filter((s) => s.has(best));
    }
    if (rivals.length > 0) continue;

    for (const cell of candidates) {
      if (blankets.length >= minBlankets) break;
      if (!blankets.includes(cell)) blankets.push(cell);
    }
    blankets.sort((a, b) => a - b);
    return { size, regions, blankets, suns, solution };
  }
  throw new Error(`No puzzle found after ${maxAttempts} attempts`);
}

/** Random flood fill from one seed per region, favouring smaller regions. */
function growRegions(rng: Rng, size: number, seeds: number[]): number[] | null {
  const regions = new Array<number>(size * size).fill(-1);
  const sizes = new Array<number>(seeds.length).fill(1);
  seeds.forEach((cell, id) => (regions[cell] = id));
  let unassigned = size * size - seeds.length;

  while (unassigned > 0) {
    const frontier: [number, number, number][] = [];
    for (let cell = 0; cell < regions.length; cell++) {
      if (regions[cell] !== -1) continue;
      for (const nb of neighbours(size, cell)) {
        const id = regions[nb];
        if (id !== -1) frontier.push([cell, id, 1 / sizes[id] ** 1.5]);
      }
    }
    let pick = rng() * frontier.reduce((s, f) => s + f[2], 0);
    const [cell, id] = frontier.find((f) => (pick -= f[2]) <= 0) ?? frontier[frontier.length - 1];
    regions[cell] = id;
    sizes[id]++;
    unassigned--;
  }
  // One single-cell region is a fine starting foothold; more makes it trivial.
  return sizes.filter((s) => s === 1).length > 1 ? null : regions;
}

function neighbours(size: number, cell: number): number[] {
  const r = Math.floor(cell / size);
  const c = cell % size;
  const out: number[] = [];
  if (r > 0) out.push(cell - size);
  if (r < size - 1) out.push(cell + size);
  if (c > 0) out.push(cell - 1);
  if (c < size - 1) out.push(cell + 1);
  return out;
}
