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

// Drawn for the top-left corner; CSS flips it for the others.
const SUN_SVG = `<svg viewBox="0 0 34 34" fill="currentColor" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
  <circle cx="12" cy="12" r="6.5" stroke="none"/>
  <path d="M12 1.5v2.5M12 20v2.5M1.5 12h2.5M20 12h2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8" fill="none"/>
  <path d="M23 23l8 8M31 26v5h-5" fill="none" stroke-width="2"/>
</svg>`;
const TREE_SVG = `<svg class="tree" viewBox="0 0 32 32" aria-hidden="true">
  <rect class="trunk" x="13.5" y="18" width="5" height="11" rx="1.5"/>
  <circle class="canopy" cx="16" cy="13" r="10"/>
</svg>`;
const MARK_SVG = `<svg class="mark" viewBox="0 0 10 10" aria-hidden="true">
  <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
</svg>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const board = $('board');
const wrap = $('board-wrap');
const timerEl = $('timer');
const statusEl = $('status');

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

function load(key: string): Saved | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ cells, elapsed: currentElapsed(), solved }));
  } catch {
    // Storage may be unavailable (private mode); progress just won't persist.
  }
}

function currentElapsed() {
  return elapsed + (runningSince === null ? 0 : performance.now() - runningSince);
}

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function startPuzzle(p: Puzzle, key: string, subtitle: string) {
  if (puzzle && runningSince !== null) {
    elapsed = currentElapsed();
    runningSince = null;
    save();
  }
  puzzle = p;
  shadows = shadowTable(p.size, p.regions, p.suns);
  storageKey = key;
  const saved = load(key);
  cells = saved?.cells?.length === p.size * p.size ? saved.cells : new Array(p.size * p.size).fill(EMPTY);
  elapsed = saved?.elapsed ?? 0;
  solved = saved?.solved ?? false;
  runningSince = solved ? null : performance.now();
  history = [];
  $('subtitle').textContent = subtitle;
  buildBoard();
  render();
}

function buildBoard() {
  const n = puzzle.size;
  board.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  board.replaceChildren();
  wrap.querySelectorAll('.sun').forEach((s) => s.remove());
  for (const sun of puzzle.suns) {
    const el = document.createElement('div');
    el.className = `sun ${sun}`;
    el.innerHTML = SUN_SVG;
    el.title = `Sun in the ${SUN_NAMES[sun]} corner`;
    wrap.append(el);
  }

  cellEls = [];
  for (let i = 0; i < n * n; i++) {
    const r = Math.floor(i / n);
    const c = i % n;
    const reg = puzzle.regions[i];
    const el = document.createElement('button');
    el.className = 'cell';
    el.dataset.i = String(i);
    el.style.setProperty('--c', `var(--r${reg % 9})`);
    const edge = (other: boolean) => (other ? '2px' : '0');
    el.style.borderTopWidth = edge(r > 0 && puzzle.regions[i - n] !== reg);
    el.style.borderLeftWidth = edge(c > 0 && puzzle.regions[i - 1] !== reg);
    if (puzzle.blankets.includes(i)) {
      el.classList.add('blanket-cell');
      el.insertAdjacentHTML('beforeend', '<span class="blanket"></span>');
    }
    el.insertAdjacentHTML('beforeend', '<span class="content"></span>');
    board.append(el);
    cellEls.push(el);
  }
}

function render() {
  const trees = cells.flatMap((v, i) => (v === TREE ? [i] : []));
  const ev = evaluate(puzzle, trees, shadows);
  cellEls.forEach((el, i) => {
    const content = el.querySelector('.content')!;
    const want = cells[i] === TREE ? 'tree' : cells[i] === MARK ? 'mark' : '';
    if (content.getAttribute('data-kind') !== want) {
      content.setAttribute('data-kind', want);
      content.innerHTML = want === 'tree' ? TREE_SVG : want === 'mark' ? MARK_SVG : '';
    }
    el.classList.toggle('shaded', ev.shaded.has(i));
    el.classList.toggle('bad', ev.badTrees.has(i));
    const r = Math.floor(i / puzzle.size) + 1;
    const c = (i % puzzle.size) + 1;
    const what = want === 'tree' ? 'tree' : want === 'mark' ? 'marked empty' : 'empty';
    const extras = [puzzle.blankets.includes(i) && 'blanket', ev.shaded.has(i) && 'in shade'].filter(Boolean);
    el.setAttribute('aria-label', `Row ${r}, column ${c}, ${what}${extras.length ? ', ' + extras.join(', ') : ''}`);
  });

  if (ev.solved && !solved) {
    solved = true;
    elapsed = currentElapsed();
    runningSince = null;
    showWin();
  }
  const left = puzzle.blankets.length - ev.shadedBlankets.size;
  statusEl.classList.toggle('solved', solved);
  statusEl.textContent = solved
    ? `Solved in ${formatTime(elapsed)}`
    : ev.badTrees.size > 0
      ? 'Some trees break the rules'
      : `${trees.length} of ${puzzle.size} trees · ${left} blanket${left === 1 ? '' : 's'} in the sun`;
  board.classList.toggle('done', solved);
  tick();
  save();
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

const endPointer = () => {
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
};
board.addEventListener('pointerup', endPointer);
board.addEventListener('pointercancel', () => {
  pointerStart = null;
  dragging = false;
});

// Keyboard: buttons are focusable; Enter/Space cycles like a tap.
board.addEventListener('keydown', (e) => {
  const i = Number((e.target as HTMLElement).dataset.i);
  if (Number.isNaN(i)) return;
  const n = puzzle.size;
  const moves: Record<string, number> = { ArrowUp: -n, ArrowDown: n, ArrowLeft: -1, ArrowRight: 1 };
  if (e.key in moves) {
    const j = i + moves[e.key];
    if (j >= 0 && j < n * n && (Math.abs(moves[e.key]) === n || Math.floor(j / n) === Math.floor(i / n))) cellEls[j].focus();
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
    ? `Two suns · shadows fall ${suns.map((s) => SHADOW_ARROWS[s]).join(' ')}`
    : `Sun ${SUN_NAMES[suns[0]]} · shadows fall ${SHADOW_ARROWS[suns[0]]}`;
}

function showWin() {
  $('win-text').textContent = `You shaded every blanket in ${formatTime(elapsed)}.`;
  const dlg = $<HTMLDialogElement>('win');
  if (!dlg.open) dlg.showModal();
}

$('share').addEventListener('click', async () => {
  const label = mode === 'daily' ? `Shade ${dateKey(new Date())}` : `Shade practice ${puzzle.size}×${puzzle.size}`;
  const text = `${label}\n${puzzle.suns.map((s) => '☀️' + SHADOW_ARROWS[s]).join(' ')} 🌳×${puzzle.size} 🧺×${puzzle.blankets.length}\n⏱ ${formatTime(elapsed)}`;
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
  const day = today.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const p = dailyPuzzle(today);
  startPuzzle(p, `shade:daily:${dateKey(today)}`, `${day} · ${describeSuns(p.suns)}`);
}

function openPractice(seed: number) {
  const suns = ($<HTMLSelectElement>('practice-sun').value.split(',') as Sun[]);
  const size = Number($<HTMLSelectElement>('practice-size').value);
  const p = generate(mulberry32(seed), { size, suns });
  startPuzzle(p, `shade:practice:${size}:${suns}:${seed}`, describeSuns(p.suns));
  try {
    localStorage.setItem('shade:practice:last', JSON.stringify({ seed, suns, size }));
  } catch {
    // Not critical.
  }
}

function lastPractice(): { seed: number; suns: string[]; size: number } | null {
  try {
    return JSON.parse(localStorage.getItem('shade:practice:last') ?? 'null');
  } catch {
    return null;
  }
}

function setMode(next: 'daily' | 'practice') {
  mode = next;
  $('tab-daily').setAttribute('aria-selected', String(next === 'daily'));
  $('tab-practice').setAttribute('aria-selected', String(next === 'practice'));
  $('practice-bar').hidden = next !== 'practice';
  if (next === 'daily') openDaily();
  else {
    const last = lastPractice();
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
$('rules-btn').addEventListener('click', () => $<HTMLDialogElement>('rules').showModal());

setMode('daily');

// Dev-only: #reveal=k places the first k solution trees, plus #bad adds a broken one.
if (import.meta.env.DEV && location.hash.startsWith('#reveal')) {
  const k = Number(location.hash.split('=')[1] ?? puzzle.size);
  const next = new Array(puzzle.size * puzzle.size).fill(EMPTY);
  puzzle.solution.slice(0, k).forEach((c, r) => (next[r * puzzle.size + c] = TREE));
  if (k < puzzle.size) next[next.length - 1] = TREE;
  commit(next);
}
try {
  if (!localStorage.getItem('shade:seen-rules')) {
    $<HTMLDialogElement>('rules').showModal();
    localStorage.setItem('shade:seen-rules', '1');
  }
} catch {
  $<HTMLDialogElement>('rules').showModal();
}
