import type { Puzzle, Sun } from './board';
import { generate } from './generator';
import { hashString, mulberry32 } from './rng';

interface DayRule {
  suns: Sun[];
  size: number;
}

// Indexed by Date.getDay(): Sunday first.
const WEEK: DayRule[] = [
  { suns: ['BL', 'BR'], size: 7 },
  { suns: ['TL'], size: 6 },
  { suns: ['TR'], size: 7 },
  { suns: ['BR'], size: 7 },
  { suns: ['BL'], size: 8 },
  { suns: ['TL'], size: 8 },
  { suns: ['TL', 'TR'], size: 7 },
];

export function dateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dailyRule(d: Date): DayRule {
  return WEEK[d.getDay()];
}

export function dailyPuzzle(d: Date): Puzzle {
  const rule = dailyRule(d);
  return generate(mulberry32(hashString(`shade:${dateKey(d)}`)), rule);
}
