import { describe, expect, it } from 'vitest';
import { evaluate, shadowOf, type Sun } from './board';
import { dailyPuzzle } from './daily';
import { generate } from './generator';
import { mulberry32 } from './rng';
import { solveAll } from './solver';

// 5x5: region 0 is the main diagonal strip's top-left, region 1 the middle, 2 the rest.
// prettier-ignore
const REGIONS = [
  0, 0, 2, 2, 2,
  0, 0, 2, 2, 2,
  2, 2, 1, 2, 2,
  2, 2, 2, 1, 2,
  2, 2, 2, 2, 2,
];

describe('shadowOf', () => {
  it('crosses its own region, spills into the next and stops at that edge', () => {
    // Tree at (0,0) in region 0: (1,1) is region 0, (2,2) and (3,3) region 1, (4,4) region 2.
    expect(shadowOf(5, REGIONS, ['TL'], 0)).toEqual([6, 12, 18]);
  });

  it('runs to the board edge when nothing stops it', () => {
    expect(shadowOf(5, REGIONS, ['TL'], 18)).toEqual([24]);
    expect(shadowOf(5, REGIONS, ['TL'], 24)).toEqual([]);
  });

  it('casts one shadow per sun', () => {
    const suns: Sun[] = ['TL', 'TR'];
    expect(shadowOf(5, REGIONS, suns, 12).sort((a, b) => a - b)).toEqual([16, 18, 20, 24]);
  });
});

describe('generate', () => {
  for (const [size, suns] of [
    [6, ['TL']],
    [7, ['BR']],
    [7, ['TL', 'TR']],
    [8, ['BL']],
  ] as [number, Sun[]][]) {
    it(`makes a uniquely solvable ${size}x${size} puzzle with ${suns.join('+')} sun`, () => {
      const p = generate(mulberry32(size * 31 + suns.length), { size, suns });
      const sols = solveAll(p.size, p.regions, p.suns, p.blankets, 2);
      expect(sols).toEqual([p.solution]);
      const trees = p.solution.map((c, r) => r * size + c);
      expect(evaluate(p, trees).solved).toBe(true);
    });
  }

  it('gives the same daily puzzle for the same date', () => {
    const d = new Date(2026, 9, 26);
    expect(dailyPuzzle(d)).toEqual(dailyPuzzle(new Date(2026, 9, 26, 18)));
  });
});

describe('evaluate', () => {
  it('flags a tree standing in another tree’s shadow', () => {
    const p = { size: 5, regions: REGIONS, blankets: [], suns: ['TL'] as Sun[], solution: [] };
    const ev = evaluate(p, [0, 12]);
    expect([...ev.badTrees]).toEqual([12]);
    expect(ev.solved).toBe(false);
  });
});
