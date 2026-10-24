import './style.css';
import { evaluate, shadowTable, type Puzzle, type Sun } from './core/board';
import { dailyPuzzle, dateKey } from './core/daily';
import { generate } from './core/generator';
import { mulberry32 } from './core/rng';

const EMPTY = 0;
const MARK = 1;
const TREE = 2;

interface Saved {
  cells: number[];
  elapsed: number;
  solved: boolean;
}

const SUN_NAMES: Record<Sun, string> = {
  TL: 'top-left',
  TR: 'top-right',
  BR: 'bottom-right',
  BL: 'bottom-left',
};
const SHADOW_ARROWS: Record<Sun, string> = { TL: '↘', TR: '↙', BR: '↖', BL: '↗' };
const SUN_CORNER: Record<Sun, string> = { TL: '0% 0%', TR: '100% 0%', BR: '100% 100%', BL: '0% 100%' };
// Hatching runs along the shadow's direction.
const HATCH: Record<Sun, string> = { TL: '45deg', BR: '45deg', TR: '-45deg', BL: '-45deg' };

// Drawn for the top-left corner; CSS flips it for the others.
const SUN_SVG = `<svg viewBox="0 0 40 40" fill="none" stroke-linecap="round" aria-hidden="true">
  <g class="rays" stroke-width="2.4">
    <path d="M14 1.5v3M14 23.5v3M1.5 14h3M23.5 14h3M5.2 5.2l2.1 2.1M20.7 20.7l2.1 2.1M5.2 22.8l2.1-2.1M20.7 7.3l2.1-2.1"/>
  </g>
  <circle class="core" cx="14" cy="14" r="6.5"/>
  <path class="arrow" d="M27 27l9 9M36 30v6h-6" stroke-width="2.2" stroke-linejoin="round"/>
</svg>`;
const TREE_SVG = `<svg class="tree" viewBox="0 0 40 40" aria-hidden="true">
  <ellipse class="ground" cx="20" cy="36.5" rx="8" ry="2"/>
  <path class="trunk" d="M18 23h4l1 13h-6z"/>
  <circle class="leaf-dark" cx="12.5" cy="19.5" r="8"/>
  <circle class="leaf-dark" cx="27.5" cy="19.5" r="8"/>
  <circle class="leaf" cx="20" cy="13" r="10.5"/>
  <circle class="hi" cx="16" cy="9.5" r="3.5"/>
</svg>`;
const MARK_SVG = `<svg class="mark" viewBox="0 0 10 10" aria-hidden="true">
  <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
</svg>`;
const CHIP_TREE = `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M18 23h4l1 13h-6z" fill="var(--trunk)"/><circle cx="12.5" cy="19.5" r="8" fill="var(--leaf-dark)"/><circle cx="27.5" cy="19.5" r="8" fill="var(--leaf-dark)"/><circle cx="20" cy="13" r="10.5" fill="var(--leaf)"/></svg>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const board = $('board');
const wrap = $('board-wrap');
const timerEl = $('timer');
const statusEl = $('status');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let mode: 'daily' | 'practice' = 'daily';
let puzzle!: Puzzle;
let shadows: number[][];
let storageKey: string;
let cells: number[] = [];
let history: number[][] = [];
let solved = false;
let elapsed = 0;
let runningSince: number | null = null;
let cellEls: HTMLButtonElement[] = [];
// Previous render's state, so only changes trigger animations.
let prevShaded = new Set<number>();
let prevBad = new Set<number>();
let prevTreeCount = 0;

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable (private mode); progress just won't persist.
  }
}

function save() {
  store(storageKey, { cells, elapsed: currentElapsed(), solved } satisfies Saved);
}

function currentElapsed() {
  return elapsed + (runningSince === null ? 0 : performance.now() - runningSince);
}

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const row = (i: number) => Math.floor(i / puzzle.size);
const col = (i: number) => i % puzzle.size;

function startPuzzle(p: Puzzle, key: string, subtitle: string) {
  if (puzzle && runningSince !== null) {
    elapsed = currentElapsed();
    runningSince = null;
    save();
  }
  puzzle = p;
  shadows = shadowTable(p.size, p.regions, p.suns);
  storageKey = key;
  const saved = load<Saved>(key);
  cells = saved?.cells?.length === p.size * p.size ? saved.cells : new Array(p.size * p.size).fill(EMPTY);
  elapsed = saved?.elapsed ?? 0;
  solved = saved?.solved ?? false;
  runningSince = solved ? null : performance.now();
  history = [];
  prevShaded = new Set();
  prevBad = new Set();
  prevTreeCount = cells.filter((v) => v === TREE).length;
  $('subtitle').textContent = subtitle;
  buildBoard();
  render();
}

function buildBoard() {
  const n = puzzle.size;
  board.classList.remove('won', 'nope');
  board.style.gridTemplateColumns = `repeat(${n}, minmax(0, 1fr))`;
  board.style.gridTemplateRows = `repeat(${n}, minmax(0, 1fr))`;
  board.style.setProperty('--hatch', HATCH[puzzle.suns[0]]);
  board.replaceChildren();

  wrap.querySelectorAll('.sun').forEach((s) => s.remove());
  for (const sun of puzzle.suns) {
    const el = document.createElement('div');
    el.className = `sun ${sun}`;
    el.innerHTML = SUN_SVG;
    el.title = `Sun in the ${SUN_NAMES[sun]} corner`;
    wrap.append(el);
  }
  $('light').style.setProperty(
    '--glow',
    puzzle.suns.map((s) => `radial-gradient(circle at ${SUN_CORNER[s]}, var(--sunlight), transparent 65%)`).join(','),
  );

  cellEls = [];
  for (let i = 0; i < n * n; i++) {
    const r = row(i);
    const c = col(i);
    const reg = puzzle.regions[i];
    const el = document.createElement('button');
    el.className = 'cell';
    el.dataset.i = String(i);
    el.style.setProperty('--c', `var(--r${reg % 9})`);
    // Win wave starts at the sun's corner (the first sun on two-sun days).
    const sun = puzzle.suns[0];
    const fromTop = sun[0] === 'T' ? r : n - 1 - r;
    const fromLeft = sun[1] === 'L' ? c : n - 1 - c;
    el.style.setProperty('--w', `${(fromTop + fromLeft) * 70}ms`);
    const edge = (other: boolean) => (other ? '2.5px' : '0');
    el.style.borderTopWidth = edge(r > 0 && puzzle.regions[i - n] !== reg);
    el.style.borderLeftWidth = edge(c > 0 && puzzle.regions[i - 1] !== reg);
    if (puzzle.blankets.includes(i)) el.insertAdjacentHTML('beforeend', '<span class="blanket"></span>');
    el.insertAdjacentHTML('beforeend', '<span class="content"></span>');
    board.append(el);
    cellEls.push(el);
  }
}

function render() {
  const trees = cells.flatMap((v, i) => (v === TREE ? [i] : []));
  const ev = evaluate(puzzle, trees, shadows);
  const full = trees.length === puzzle.size;

  cellEls.forEach((el, i) => {
    const content = el.querySelector('.content')!;
    const kind = cells[i] === TREE ? 'tree' : cells[i] === MARK ? 'mark' : '';
    if (content.getAttribute('data-kind') !== kind) {
      content.setAttribute('data-kind', kind);
      content.innerHTML = kind === 'tree' ? TREE_SVG : kind === 'mark' ? MARK_SVG : '';
    }

    const shaded = ev.shaded.has(i);
    if (shaded && !prevShaded.has(i)) {
      // Let new shadow creep outward from the tree that casts it.
      const dist = Math.min(...trees.filter((t) => shadows[t].includes(i)).map((t) => Math.abs(row(t) - row(i))));
      el.style.setProperty('--d', `${(dist - 1) * 70}ms`);
    }
    el.classList.toggle('shaded', shaded);
    el.classList.toggle('bad', ev.badTrees.has(i));
    if (ev.badTrees.has(i) && !prevBad.has(i)) shake(el);
    el.querySelector('.blanket')?.classList.toggle('exposed', full && !shaded && !solved);

    const what = kind === 'tree' ? 'tree' : kind === 'mark' ? 'marked empty' : 'empty';
    const extras = [puzzle.blankets.includes(i) && 'blanket', shaded && 'in shade'].filter(Boolean);
    el.setAttribute('aria-label', `Row ${row(i) + 1}, column ${col(i) + 1}, ${what}${extras.length ? ', ' + extras.join(', ') : ''}`);
  });

  const newlyBad = [...ev.badTrees].some((t) => !prevBad.has(t));
  if (newlyBad) buzz(40);

  if (ev.solved && !solved) {
    solved = true;
    elapsed = currentElapsed();
    runningSince = null;
    celebrate();
  } else if (full && !ev.solved && prevTreeCount < puzzle.size && !newlyBad) {
    board.classList.remove('nope');
    void board.offsetWidth;
    board.classList.add('nope');
    buzz([30, 60, 30]);
  }

  const exposed = puzzle.blankets.length - ev.shadedBlankets.size;
  statusEl.innerHTML = solved
    ? `<span class="chip good">Solved in ${formatTime(elapsed)}</span>`
    : [
        `<span class="chip">${CHIP_TREE}${trees.length} / ${puzzle.size}</span>`,
        `<span class="chip"><span class="swatch"></span>${exposed} in the sun</span>`,
        ev.badTrees.size ? `<span class="chip warn">${ev.badTrees.size} tree${ev.badTrees.size > 1 ? 's' : ''} breaking a rule</span>` : '',
      ].join('');

  prevShaded = ev.shaded;
  prevBad = ev.badTrees;
  prevTreeCount = trees.length;
  tick();
  save();
}

function shake(el: HTMLElement) {
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  el.addEventListener('animationend', () => el.classList.remove('shake'), { once: true });
}

function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Vibration isn't supported everywhere.
  }
}

function celebrate() {
  if (mode === 'daily') bumpStreak();
  buzz([20, 40, 20, 40, 60]);
  board.classList.add('won');
  if (!reducedMotion) dropLeaves();
  const n = puzzle.size;
  setTimeout(showWin, reducedMotion ? 0 : 2 * n * 70 + 700);
}

function dropLeaves() {
  const fx = $('fx');
  const colors = ['var(--leaf)', 'var(--leaf-dark)', 'var(--sun)', '#e9893b', 'var(--r2)'];
  for (let k = 0; k < 46; k++) {
    const leaf = document.createElement('i');
    leaf.style.left = `${Math.random() * 100}%`;
    leaf.style.background = colors[k % colors.length];
    leaf.style.setProperty('--t', `${2.4 + Math.random() * 2}s`);
    leaf.style.setProperty('--delay', `${Math.random() * 0.9}s`);
    leaf.style.setProperty('--dx', `${(Math.random() - 0.5) * 160}px`);
    leaf.style.setProperty('--rot', `${(Math.random() - 0.5) * 1080}deg`);
    leaf.style.transform = `rotate(${Math.random() * 360}deg)`;
    fx.append(leaf);
  }
  setTimeout(() => fx.replaceChildren(), 5000);
}

function streak(): { last: string; count: number } {
  return load<{ last: string; count: number }>('shade:streak') ?? { last: '', count: 0 };
}

function bumpStreak() {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const s = streak();
  if (s.last === dateKey(today)) return;
  store('shade:streak', { last: dateKey(today), count: s.last === dateKey(yesterday) ? s.count + 1 : 1 });
}

function showWin() {
  const stat = (value: string, label: string) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`;
  $('win-stats').innerHTML = [
    stat(formatTime(elapsed), 'Time'),
    stat(`${puzzle.size}×${puzzle.size}`, 'Board'),
    mode === 'daily' ? stat(String(streak().count), 'Day streak') : stat(String(puzzle.blankets.length), 'Blankets'),
  ].join('');
  $('win-next-btn').hidden = mode !== 'practice';
  $('win-next').textContent = mode === 'daily' ? `Next Shade in ${untilTomorrow()}. ${tomorrowHint()}` : '';
  $('win-next').hidden = mode !== 'daily';
  const dlg = $<HTMLDialogElement>('win');
  if (!dlg.open) dlg.showModal();
}

function untilTomorrow() {
  const now = new Date();
  const mins = Math.ceil((new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime()) / 60000);
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function tomorrowHint() {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  const p = dailyPuzzle(t);
  return p.suns.length > 1 ? 'Tomorrow has two suns.' : `Tomorrow the sun rises ${SUN_NAMES[p.suns[0]]}.`;
}

function tick() {
  timerEl.textContent = formatTime(currentElapsed());
}
setInterval(tick, 500);

document.addEventListener('visibilitychange', () => {
  if (solved) return;
  if (document.hidden && runningSince !== null) {
    elapsed = currentElapsed();
    runningSince = null;
    save();
  } else if (!document.hidden && runningSince === null) {
    runningSince = performance.now();
  }
});

function commit(next: number[]) {
  if (solved || next.every((v, i) => v === cells[i])) return;
  history.push(cells);
  cells = next;
  render();
}

// Tap cycles empty → mark → tree. Dragging from a cell marks every empty cell it passes.
let pointerStart: number | null = null;
let dragging = false;
let dragCells: number[] | null = null;

function cellAt(x: number, y: number): number | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.cell');
  return el && board.contains(el) ? Number(el.dataset.i) : null;
}

board.addEventListener('pointerdown', (e) => {
  const i = cellAt(e.clientX, e.clientY);
  if (i === null || solved) return;
  pointerStart = i;
  dragging = false;
  dragCells = null;
  board.setPointerCapture(e.pointerId);
});

board.addEventListener('pointermove', (e) => {
  if (pointerStart === null) return;
  const i = cellAt(e.clientX, e.clientY);
  if (i === null || (i === pointerStart && !dragging)) return;
  if (!dragging) {
    dragging = true;
    dragCells = [...cells];
    history.push(cells);
    if (dragCells[pointerStart] === EMPTY) dragCells[pointerStart] = MARK;
  }
  if (dragCells![i] === EMPTY) dragCells![i] = MARK;
  cells = [...dragCells!];
  render();
});

board.addEventListener('pointerup', () => {
  if (pointerStart !== null && !dragging) {
    const next = [...cells];
    next[pointerStart] = (next[pointerStart] + 1) % 3;
    commit(next);
  } else if (dragging && history.length && history[history.length - 1].every((v, i) => v === cells[i])) {
    history.pop();
  }
  pointerStart = null;
  dragging = false;
  dragCells = null;
});
board.addEventListener('pointercancel', () => {
  pointerStart = null;
  dragging = false;
});

// Keyboard: arrows move between cells; Enter/Space cycles like a tap.
board.addEventListener('keydown', (e) => {
  const i = Number((e.target as HTMLElement).dataset.i);
  if (Number.isNaN(i)) return;
  const n = puzzle.size;
  const moves: Record<string, number> = { ArrowUp: -n, ArrowDown: n, ArrowLeft: -1, ArrowRight: 1 };
  if (e.key in moves) {
    const j = i + moves[e.key];
    if (j >= 0 && j < n * n && (Math.abs(moves[e.key]) === n || row(j) === row(i))) cellEls[j].focus();
    e.preventDefault();
  } else if (e.key === 'Enter' || e.key === ' ') {
    const next = [...cells];
    next[i] = (next[i] + 1) % 3;
    commit(next);
    e.preventDefault();
  }
});

$('undo').addEventListener('click', () => {
  if (solved) return;
  const prev = history.pop();
  if (prev) {
    cells = prev;
    render();
  }
});

$('clear').addEventListener('click', () => {
  if (solved) return;
  commit(new Array(puzzle.size * puzzle.size).fill(EMPTY));
});

function describeSuns(suns: Sun[]) {
  return suns.length > 1
    ? `Two suns ${suns.map((s) => SHADOW_ARROWS[s]).join(' ')}`
    : `Sun ${SUN_NAMES[suns[0]]} ${SHADOW_ARROWS[suns[0]]}`;
}

$('share').addEventListener('click', async () => {
  const label = mode === 'daily' ? `Shade ${dateKey(new Date())}` : `Shade practice ${puzzle.size}×${puzzle.size}`;
  const lines = [label, `${puzzle.suns.map((s) => '☀️' + SHADOW_ARROWS[s]).join(' ')} 🌳×${puzzle.size} 🧺×${puzzle.blankets.length}`, `⏱ ${formatTime(elapsed)}`];
  if (mode === 'daily') lines.push(`🔥 ${streak().count} day streak`);
  const text = lines.join('\n');
  try {
    if (navigator.share) await navigator.share({ text });
    else {
      await navigator.clipboard.writeText(text);
      $('share').textContent = 'Copied!';
      setTimeout(() => ($('share').textContent = 'Share'), 1500);
    }
  } catch {
    // User cancelled the share sheet.
  }
});

function openDaily() {
  const today = new Date();
  const day = today.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const p = dailyPuzzle(today);
  startPuzzle(p, `shade:daily:${dateKey(today)}`, `${day} · ${describeSuns(p.suns)}`);
}

function openPractice(seed: number) {
  const suns = $<HTMLSelectElement>('practice-sun').value.split(',') as Sun[];
  const size = Number($<HTMLSelectElement>('practice-size').value);
  const p = generate(mulberry32(seed), { size, suns });
  startPuzzle(p, `shade:practice:${size}:${suns}:${seed}`, describeSuns(p.suns));
  store('shade:practice:last', { seed, suns, size });
}

function setMode(next: 'daily' | 'practice') {
  mode = next;
  $('tab-daily').setAttribute('aria-selected', String(next === 'daily'));
  $('tab-practice').setAttribute('aria-selected', String(next === 'practice'));
  $('practice-bar').hidden = next !== 'practice';
  if (next === 'daily') openDaily();
  else {
    const last = load<{ seed: number; suns: string[]; size: number }>('shade:practice:last');
    if (last) {
      $<HTMLSelectElement>('practice-sun').value = last.suns.join(',');
      $<HTMLSelectElement>('practice-size').value = String(last.size);
    }
    openPractice(last?.seed ?? newSeed());
  }
}

const newSeed = () => Math.floor(Math.random() * 2 ** 31);

$('tab-daily').addEventListener('click', () => setMode('daily'));
$('tab-practice').addEventListener('click', () => setMode('practice'));
for (const id of ['practice-new', 'practice-sun', 'practice-size']) {
  $(id).addEventListener(id === 'practice-new' ? 'click' : 'change', () => openPractice(newSeed()));
}
$('win-next-btn').addEventListener('click', () => {
  $<HTMLDialogElement>('win').close();
  openPractice(newSeed());
});
$('rules-btn').addEventListener('click', () => $<HTMLDialogElement>('rules').showModal());

setMode('daily');

// Dev-only: #reveal=k places the first k solution trees, plus one rule-breaker if k < size.
if (import.meta.env.DEV && location.hash.startsWith('#reveal')) {
  const k = Number(location.hash.split('=')[1] ?? puzzle.size);
  const next = new Array(puzzle.size * puzzle.size).fill(EMPTY);
  puzzle.solution.slice(0, k).forEach((c, r) => (next[r * puzzle.size + c] = TREE));
  if (k < puzzle.size) next[next.length - 1] = TREE;
  commit(next);
}

if (!load('shade:seen-rules')) {
  $<HTMLDialogElement>('rules').showModal();
  store('shade:seen-rules', 1);
}
