// Static level editor for Tim the Time Traveller.
// Paints onto a grid and exports the same JSON format the game consumes.

import { T, DIRS, DIR_NAMES, COLORS, key, VOID_DROP } from './constants.js';
import { TEST_LEVEL } from './level.js';

const canvas = document.getElementById('ed');
const ctx = canvas.getContext('2d');

// --- editor state --------------------------------------------------------
// Reopen where you left off: pull the last saved level from browser storage,
// falling back to the built-in test level if nothing is stored (or it's bad).
let level = loadSavedLevel() || clone(TEST_LEVEL);
let grid = buildGrid(level);            // sparse Map "x,y" -> cell (unbounded)
let view = { x: -1, y: -1, scale: 28 }; // camera (cell coords) + px per cell
let dir = 1;                             // current direction for piston/not
let painting = 0;                        // 0 none, 1 paint, 2 erase
let panning = false; let spaceDown = false;
let lastMouse = { x: 0, y: 0 };

// Tool palette. kind: cell | spawn | vortex | erase.
const TOOLS = [
  { id: 'wall0',  label: 'Wall',    kind: 'cell', t: T.WALL, variant: 0, color: COLORS.wall },
  { id: 'wall1',  label: 'Bolted',  kind: 'cell', t: T.WALL, variant: 1, color: '#454f66' },
  { id: 'wall2',  label: 'Caution', kind: 'cell', t: T.WALL, variant: 2, color: COLORS.caution },
  { id: 'wire',   label: 'Wire',    kind: 'cell', t: T.WIRE, color: COLORS.metal },
  { id: 'button', label: 'Button',  kind: 'cell', t: T.BUTTON, color: COLORS.button },
  { id: 'piston', label: 'Piston',  kind: 'cell', t: T.PISTON, dirful: true, color: COLORS.piston },
  { id: 'not',    label: 'NOT',     kind: 'cell', t: T.NOT, dirful: true, color: COLORS.chipEtch },
  { id: 'delay',  label: 'Delay',   kind: 'cell', t: T.DELAY, dirful: true, color: COLORS.delayEtch },
  { id: 'coin',   label: 'Coin',    kind: 'cell', t: T.COIN, color: COLORS.coinFace },
  { id: 'info',   label: 'Info',    kind: 'cell', t: T.INFO, color: COLORS.infoScreen },
  { id: 'temple0',label: 'Stone',   kind: 'cell', t: T.TEMPLE, variant: 0, color: COLORS.temple },
  { id: 'temple1',label: 'Glyph',   kind: 'cell', t: T.TEMPLE, variant: 1, color: COLORS.templeHi },
  { id: 'temple2',label: 'Cracked', kind: 'cell', t: T.TEMPLE, variant: 2, color: COLORS.templeDark },
  { id: 'table',  label: 'Table',   kind: 'cell', t: T.TABLE, color: COLORS.tableTop },
  { id: 'light',  label: 'Light',   kind: 'cell', t: T.LIGHT, color: COLORS.lamp },
  { id: 'torch',  label: 'Torch',   kind: 'cell', t: T.TORCH, color: COLORS.flameHot },
  { id: 'green',  label: 'Energy',  kind: 'vortex', color: COLORS.vGreen },
  { id: 'red',    label: 'Red vortex', kind: 'vortex', color: COLORS.vRed },
  { id: 'spawn',  label: 'Spawn',   kind: 'spawn', color: COLORS.tim },
  { id: 'erase',  label: 'Erase',   kind: 'erase', color: '#333a4d' },
];
let tool = TOOLS[0];

// --- helpers -------------------------------------------------------------
function clone(o) { return JSON.parse(JSON.stringify(o)); }

// The level last written by the Save button, or null if absent/corrupt.
function loadSavedLevel() {
  try {
    const raw = localStorage.getItem('ttt_saved_level');
    if (!raw) return null;
    const lv = JSON.parse(raw);
    lv.vortices = lv.vortices || [];   // tolerate older saves without vortices
    return lv;
  } catch {
    return null;
  }
}

function buildGrid(lv) {
  const g = new Map();
  for (const c of (lv.cells || [])) {
    g.set(key(c.x, c.y), { x: c.x, y: c.y, t: c.t, dir: c.dir ?? 0, variant: c.variant ?? 0, text: c.text ?? '' });
  }
  return g;
}

function serialize() {
  const cells = [];
  for (const c of grid.values()) {
    const o = { x: c.x, y: c.y, t: c.t };
    if (c.dir) o.dir = c.dir;
    if (c.variant) o.variant = c.variant;
    if (c.text) o.text = c.text;
    cells.push(o);
  }
  cells.sort((a, b) => a.y - b.y || a.x - b.x);   // stable, readable output
  return { name: level.name || 'Untitled', spawn: level.spawn,
           voidY: voidLine(), cells, vortices: level.vortices };
}

// The kill line: a few cells below the lowest block. Saved with the level so
// the (infinite) world still has a "fall into the void" death.
function voidLine() {
  let maxY = level.spawn.y;
  for (const c of grid.values()) if (c.y > maxY) maxY = c.y;
  return maxY + VOID_DROP;
}

// --- palette UI ----------------------------------------------------------
const paletteEl = document.getElementById('palette');
for (const tdef of TOOLS) {
  const b = document.createElement('button');
  b.appendChild(toolSwatch(tdef));
  const lab = document.createElement('small');
  lab.textContent = tdef.label;
  b.appendChild(lab);
  b.onclick = () => { tool = tdef; refreshPalette(); };
  b._tool = tdef;
  paletteEl.appendChild(b);
}

// Render a tool's preview using the SAME drawing code the game/editor canvas
// uses, so the palette block matches what gets painted into the level.
function toolSwatch(tdef) {
  const SW = 22, dpr = 2;
  const cv = document.createElement('canvas');
  cv.className = 'sw';
  cv.width = SW * dpr; cv.height = SW * dpr;
  const c2 = cv.getContext('2d');
  c2.scale(dpr, dpr);
  // dark backdrop, like the in-game scene behind a block
  c2.fillStyle = COLORS.bg1; c2.fillRect(0, 0, SW, SW);

  if (tdef.kind === 'cell') {
    // dir 'right' for dirful tools, lit face for coins (active preview)
    drawCell(c2, { t: tdef.t, x: 0, y: 0, dir: tdef.dirful ? 1 : 0,
                   variant: tdef.variant ?? 0, active: true, text: 'i' }, 0, 0, SW);
  } else if (tdef.kind === 'vortex') {
    const col = tdef.id === 'red' ? COLORS.vRed : COLORS.vGreen;
    const m = SW / 2, r = SW * 0.32;
    c2.fillStyle = col;
    c2.beginPath(); c2.arc(m, m, r, 0, 7); c2.fill();
    c2.fillStyle = 'rgba(255,255,255,0.85)';
    c2.beginPath(); c2.arc(m, m, r * 0.4, 0, 7); c2.fill();
  } else if (tdef.kind === 'spawn') {
    c2.fillStyle = COLORS.tim;
    c2.fillRect(SW * 0.3, SW * 0.22, SW * 0.4, SW * 0.58);
    c2.strokeStyle = COLORS.vBlue; c2.lineWidth = 1.5;
    c2.strokeRect(SW * 0.3, SW * 0.22, SW * 0.4, SW * 0.58);
  } else { // erase
    c2.strokeStyle = '#c0566a'; c2.lineWidth = 2.5; c2.lineCap = 'round';
    c2.beginPath();
    c2.moveTo(6, 6); c2.lineTo(SW - 6, SW - 6);
    c2.moveTo(SW - 6, 6); c2.lineTo(6, SW - 6);
    c2.stroke();
  }
  return cv;
}
function refreshPalette() {
  for (const b of paletteEl.children) b.classList.toggle('active', b._tool === tool);
  document.getElementById('dirLabel').textContent = ['↑', '→', '↓', '←'][dir];
}
refreshPalette();

// --- coordinate mapping --------------------------------------------------
function screenToCell(px, py) {
  return { x: Math.floor(px / view.scale + view.x), y: Math.floor(py / view.scale + view.y) };
}
function sx(x) { return (x - view.x) * view.scale; }
function sy(y) { return (y - view.y) * view.scale; }

// --- painting ------------------------------------------------------------
function applyAt(px, py, erase) {
  const { x, y } = screenToCell(px, py);   // any (even negative) cell -- world is infinite
  if (tool.kind === 'spawn' && !erase) {
    level.spawn = { x: x + 0.1, y: y };  // feet rest on top edge of this cell
    return;
  }
  if (tool.kind === 'vortex') {
    const cx = x + 0.5, cy = y + 0.5;
    // remove any existing vortex in this cell first
    level.vortices = level.vortices.filter((v) => Math.floor(v.x) !== x || Math.floor(v.y) !== y);
    if (!erase) level.vortices.push({ x: cx, y: cy, color: tool.id });
    return;
  }
  if (tool.kind === 'erase' || erase) {
    grid.delete(key(x, y));
    // also clear any vortex (energy / red) sitting in this cell
    level.vortices = level.vortices.filter((v) => Math.floor(v.x) !== x || Math.floor(v.y) !== y);
    return;
  }
  // Info panels carry author text entered in a modal (works in embedded webviews,
  // unlike prompt()). Opening it pre-fills with any existing message for editing.
  if (tool.id === 'info') {
    const cur = grid.get(key(x, y));
    openInfoModal(x, y, cur && cur.t === T.INFO ? cur.text : '');
    return;
  }
  // cell tools
  grid.set(key(x, y), { x, y, t: tool.t, dir: tool.dirful ? dir : 0, variant: tool.variant ?? 0 });
}

// --- rendering -----------------------------------------------------------
function render() {
  ctx.fillStyle = COLORS.bg0;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const s = view.scale;
  // Visible cell window (the world is infinite; we only touch what's on screen).
  const x0 = Math.floor(view.x) - 1, x1 = Math.ceil(view.x + canvas.width / s) + 1;
  const y0 = Math.floor(view.y) - 1, y1 = Math.ceil(view.y + canvas.height / s) + 1;

  // Background grid across the whole viewport.
  ctx.strokeStyle = 'rgba(120,140,180,0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = x0; x <= x1; x++) { ctx.moveTo(sx(x), 0); ctx.lineTo(sx(x), canvas.height); }
  for (let y = y0; y <= y1; y++) { ctx.moveTo(0, sy(y)); ctx.lineTo(canvas.width, sy(y)); }
  ctx.stroke();
  // Emphasize the origin axes so you can orient yourself in the infinite plane.
  ctx.strokeStyle = 'rgba(120,150,200,0.32)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(sx(0), 0); ctx.lineTo(sx(0), canvas.height);
  ctx.moveTo(0, sy(0)); ctx.lineTo(canvas.width, sy(0));
  ctx.stroke();

  // Cells (only those inside the visible window).
  for (const c of grid.values()) {
    if (c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1) continue;
    drawCell(ctx, c, sx(c.x), sy(c.y), s);
  }

  // vortices
  for (const v of level.vortices) drawVortex(v, s);
  // spawn marker
  drawSpawn(s);

  // void line: Tim dies if he falls below this (saved with the level as voidY).
  const vy = sy(voidLine());
  ctx.save();
  ctx.strokeStyle = 'rgba(255,90,110,0.55)'; ctx.lineWidth = 1.5;
  ctx.setLineDash([7, 5]);
  ctx.beginPath(); ctx.moveTo(0, vy); ctx.lineTo(canvas.width, vy); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,130,150,0.9)'; ctx.font = '11px system-ui';
  ctx.fillText('void — fall below here = death', 10, vy - 5);
  ctx.restore();
}

function drawCell(ctx, c, px, py, s) {
  switch (c.t) {
    case T.WALL: {
      if (c.variant === 2) { // caution stripes, anchored to the grid so groups tile
        ctx.save();
        ctx.beginPath(); ctx.rect(px + 1, py + 1, s - 2, s - 2); ctx.clip();
        ctx.fillStyle = COLORS.caution; ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
        ctx.fillStyle = COLORS.cautionDark;
        const bw = Math.max(5, s * 0.28), P = bw * 2;
        const base = -(view.x + view.y) * s;   // shared band lattice (see render.js)
        const k0 = Math.floor((px + py - base) / P) - 1;
        const k1 = Math.ceil((px + py + 2 * s - base) / P) + 1;
        for (let k = k0; k <= k1; k++) {
          const xTop = base + k * P - py;
          ctx.beginPath();
          ctx.moveTo(xTop, py); ctx.lineTo(xTop + bw, py);
          ctx.lineTo(xTop + bw - s, py + s); ctx.lineTo(xTop - s, py + s);
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      } else {
        ctx.fillStyle = c.variant === 1 ? '#454f66' : COLORS.wall;
        ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
      }
      break;
    }
    case T.WIRE: {
      // solid bare-metal block
      ctx.fillStyle = COLORS.metal; ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
      ctx.fillStyle = COLORS.metalLight; ctx.fillRect(px + 1, py + 1, s - 2, 2);
      ctx.fillStyle = COLORS.metalDark; ctx.fillRect(px + 1, py + s - 3, s - 2, 2);
      ctx.fillStyle = COLORS.rivet;
      for (const [bx, by] of [[5, 5], [s - 5, 5], [5, s - 5], [s - 5, s - 5]]) {
        ctx.beginPath(); ctx.arc(px + bx, py + by, 1.5, 0, 7); ctx.fill();
      }
      break;
    }
    case T.BUTTON: {
      // walk-through: only a housing + cap at the bottom of the cell
      ctx.fillStyle = COLORS.metalDark; ctx.fillRect(px + 4, py + s - 5, s - 8, 5);
      ctx.fillStyle = COLORS.button; ctx.fillRect(px + 6, py + s - 11, s - 12, 7);
      break;
    }
    case T.COIN: {
      ctx.fillStyle = COLORS.piston; ctx.fillRect(px + 3, py + 3, s - 6, s - 6);
      const m = s * 0.2;
      ctx.fillStyle = COLORS.coinFace;
      ctx.fillRect(px + m, py + m, s - m * 2, s - m * 2);
      ctx.fillStyle = COLORS.coinPip;
      const fw = s - m * 2, fx = px + m, fy = py + m, p = fw * 0.1;
      for (const [qx, qy] of [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]]) {
        ctx.beginPath(); ctx.arc(fx + fw * qx, fy + fw * qy, p, 0, 7); ctx.fill();
      }
      break;
    }
    case T.INFO: {
      ctx.fillStyle = COLORS.infoFrame;
      ctx.fillRect(px + 3, py + 3, s - 6, s - 6);
      ctx.fillStyle = COLORS.infoScreen;
      ctx.fillRect(px + 6, py + 6, s - 12, s - 14);
      ctx.fillStyle = COLORS.infoText;
      ctx.font = `bold ${Math.round(s * 0.4)}px Georgia, serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('i', px + s / 2, py + s * 0.42);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      break;
    }
    case T.PISTON: {
      ctx.fillStyle = COLORS.piston; ctx.fillRect(px + 3, py + 3, s - 6, s - 6);
      drawArrow(ctx, px + s / 2, py + s / 2, c.dir, '#1b1f2b', s * 0.28); break;
    }
    case T.NOT: {
      ctx.fillStyle = COLORS.chip; ctx.fillRect(px + 2, py + 2, s - 4, s - 4);
      drawArrow(ctx, px + s / 2, py + s / 2, c.dir, COLORS.chipEtch, s * 0.26, true); break;
    }
    case T.DELAY: {
      ctx.fillStyle = COLORS.delay; ctx.fillRect(px + 2, py + 2, s - 4, s - 4);
      const cx = px + s / 2, cy = py + s / 2, r = s * 0.34;
      // clock dial
      ctx.fillStyle = '#162033';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
      ctx.strokeStyle = COLORS.delayEtch; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
      ctx.lineWidth = 1;
      for (let k = 0; k < 12; k++) {
        const a = k * Math.PI / 6, r1 = r * (k % 3 === 0 ? 0.7 : 0.84), r2 = r * 0.95;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke();
      }
      // hands (classic ~10:10) + center pin
      ctx.lineCap = 'round'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - r * 0.34, cy - r * 0.3); ctx.stroke();
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + r * 0.42, cy - r * 0.5); ctx.stroke();
      ctx.fillStyle = COLORS.delayEtch;
      ctx.beginPath(); ctx.arc(cx, cy, 1.4, 0, 7); ctx.fill();
      // out-direction marker
      const [dx, dy] = DIRS[c.dir];
      ctx.save();
      ctx.translate(cx + dx * (r + 2.5), cy + dy * (r + 2.5)); ctx.rotate(Math.atan2(dy, dx));
      ctx.beginPath(); ctx.moveTo(-2.5, -3); ctx.lineTo(2.5, 0); ctx.lineTo(-2.5, 3); ctx.closePath(); ctx.fill();
      ctx.restore();
      break;
    }
    case T.TEMPLE: {
      ctx.fillStyle = COLORS.temple; ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
      ctx.strokeStyle = COLORS.templeLine; ctx.lineWidth = 1.5;
      const m = s / 2;
      if (c.variant === 1) {            // Mayan glyph: cartouche + bar-and-dot
        ctx.strokeRect(px + 4.5, py + 4.5, s - 9, s - 9);
        const cx = px + m;
        ctx.fillStyle = COLORS.glyph; ctx.strokeStyle = COLORS.glyph; ctx.lineWidth = 2;
        const dotR = Math.max(1.5, s * 0.06);
        ctx.beginPath(); ctx.arc(cx - s * 0.12, py + s * 0.30, dotR, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + s * 0.12, py + s * 0.30, dotR, 0, 7); ctx.fill();
        ctx.fillRect(cx - s * 0.20, py + s * 0.45, s * 0.40, Math.max(2, s * 0.09));
        ctx.beginPath();
        ctx.arc(cx, py + s * 0.66, s * 0.15, 0.12 * Math.PI, 0.88 * Math.PI);
        ctx.stroke();
      } else if (c.variant === 2) {     // cracked
        ctx.beginPath();
        ctx.moveTo(px + s * 0.25, py + 2); ctx.lineTo(px + s * 0.35, py + m); ctx.lineTo(px + s * 0.28, py + s - 2);
        ctx.stroke();
      } else {                          // brick
        ctx.beginPath();
        ctx.moveTo(px + 1, py + m); ctx.lineTo(px + s - 1, py + m);
        ctx.moveTo(px + m, py + 1); ctx.lineTo(px + m, py + m);
        ctx.stroke();
      }
      break;
    }
    case T.TABLE: {
      ctx.fillStyle = COLORS.tableLeg;
      ctx.fillRect(px + 3, py + s * 0.35, 4, s * 0.6);
      ctx.fillRect(px + s - 7, py + s * 0.35, 4, s * 0.6);
      ctx.fillStyle = COLORS.tableTop;
      ctx.fillRect(px + 1, py + s * 0.28, s - 2, s * 0.14);
      break;
    }
    case T.LIGHT: {
      ctx.fillStyle = COLORS.metalDark; ctx.fillRect(px + s * 0.2, py + 2, s * 0.6, 4);
      ctx.fillStyle = COLORS.lamp;
      ctx.beginPath(); ctx.ellipse(px + s / 2, py + s * 0.3, s * 0.2, s * 0.15, 0, 0, 7); ctx.fill();
      break;
    }
    case T.TORCH: {
      const cx2 = px + s / 2;
      ctx.fillStyle = COLORS.torchWood; ctx.fillRect(cx2 - 2, py + s * 0.45, 4, s * 0.4);
      ctx.fillStyle = COLORS.flameHot;
      ctx.beginPath();
      ctx.moveTo(cx2 - s * 0.12, py + s * 0.46);
      ctx.lineTo(cx2, py + s * 0.14);
      ctx.lineTo(cx2 + s * 0.12, py + s * 0.46);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = COLORS.flame;
      ctx.beginPath();
      ctx.moveTo(cx2 - s * 0.06, py + s * 0.46);
      ctx.lineTo(cx2, py + s * 0.26);
      ctx.lineTo(cx2 + s * 0.06, py + s * 0.46);
      ctx.closePath(); ctx.fill();
      break;
    }
  }
}

function drawArrow(ctx, cx, cy, d, color, len, bubble = false) {
  const [dx, dy] = DIRS[d];
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.atan2(dy, dx));
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-len, -len * 0.8); ctx.lineTo(len * 0.7, 0); ctx.lineTo(-len, len * 0.8); ctx.closePath();
  ctx.fill();
  if (bubble) { ctx.beginPath(); ctx.arc(len * 0.9, 0, len * 0.3, 0, 7); ctx.fill(); }
  ctx.restore();
}

function drawVortex(v, s) {
  const col = v.color === 'red' ? COLORS.vRed : v.color === 'green' ? COLORS.vGreen : COLORS.vBlue;
  const cx = sx(v.x), cy = sy(v.y);
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(cx, cy, s * 0.34, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath(); ctx.arc(cx, cy, s * 0.12, 0, 7); ctx.fill();
}

function drawSpawn(s) {
  const cx = sx(level.spawn.x + 0.4), cy = sy(level.spawn.y - 0.45);
  ctx.fillStyle = COLORS.tim;
  ctx.fillRect(sx(level.spawn.x), sy(level.spawn.y - 0.9), 0.8 * s, 0.9 * s);
  ctx.strokeStyle = '#4db5ff'; ctx.lineWidth = 2;
  ctx.strokeRect(sx(level.spawn.x) - 2, sy(level.spawn.y - 0.9) - 2, 0.8 * s + 4, 0.9 * s + 4);
  ctx.fillStyle = '#4db5ff'; ctx.font = '10px system-ui';
  ctx.fillText('spawn', sx(level.spawn.x) - 2, sy(level.spawn.y) + 11);
}

// --- input ---------------------------------------------------------------
function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', resize); resize();

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  lastMouse = { x: e.clientX, y: e.clientY };
  if (spaceDown || e.button === 1) { panning = true; return; }
  painting = e.button === 2 ? 2 : 1;
  applyAt(e.clientX, e.clientY, painting === 2);
  // Info is click-to-stamp (one panel per click); don't drag a whole line of them.
  if (tool.id === 'info' && painting === 1) painting = 0;
});
window.addEventListener('mousemove', (e) => {
  if (panning) {
    view.x -= (e.clientX - lastMouse.x) / view.scale;
    view.y -= (e.clientY - lastMouse.y) / view.scale;
  } else if (painting) {
    applyAt(e.clientX, e.clientY, painting === 2);
  }
  lastMouse = { x: e.clientX, y: e.clientY };
});
window.addEventListener('mouseup', () => { painting = 0; panning = false; });

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const before = screenToCell(e.clientX, e.clientY);
  view.scale = Math.max(10, Math.min(64, view.scale * (e.deltaY < 0 ? 1.1 : 0.9)));
  const after = screenToCell(e.clientX, e.clientY);
  view.x += before.x - after.x; view.y += before.y - after.y;
}, { passive: false });

window.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;   // let fields receive keys
  if (e.key === ' ') { spaceDown = true; e.preventDefault(); }
  else if (e.key === 'r' || e.key === 'R') { dir = (dir + 1) % 4; refreshPalette(); }
});
window.addEventListener('keyup', (e) => { if (e.key === ' ') spaceDown = false; });

// --- toolbar buttons -----------------------------------------------------
document.getElementById('rotate').onclick = () => { dir = (dir + 1) % 4; refreshPalette(); };
document.getElementById('clear').onclick = () => {
  if (!confirm('Clear the whole level?')) return;
  grid = new Map();
  level.vortices = [];
};
document.getElementById('play').onclick = () => {
  localStorage.setItem('ttt_play_level', JSON.stringify(serialize()));
  window.location.href = 'index.html';
};
document.getElementById('save').onclick = () => {
  localStorage.setItem('ttt_saved_level', JSON.stringify(serialize()));
  flash('Saved to browser storage');
};
document.getElementById('load').onclick = () => {
  const raw = localStorage.getItem('ttt_saved_level');
  if (!raw) return flash('Nothing saved');
  level = JSON.parse(raw); grid = buildGrid(level);
  flash('Loaded');
};
document.getElementById('export').onclick = () => {
  const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (level.name || 'level') + '.json';
  a.click();
};
document.getElementById('import').onclick = () => document.getElementById('file').click();
document.getElementById('file').onchange = (e) => {
  const f = e.target.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    level = JSON.parse(reader.result); grid = buildGrid(level);
  };
  reader.readAsText(f);
};

// --- info panel modal ----------------------------------------------------
const infoModal = document.getElementById('infoModal');
const infoModalText = document.getElementById('infoModalText');
let infoTarget = null;                    // {x,y} cell awaiting a message
function openInfoModal(x, y, prev) {
  infoTarget = { x, y };
  infoModalText.value = prev || '';
  infoModal.hidden = false;
  infoModalText.focus(); infoModalText.select();
}
function closeInfoModal() { infoModal.hidden = true; infoTarget = null; }
function commitInfoModal() {
  if (infoTarget) {
    const { x, y } = infoTarget;
    grid.set(key(x, y), { x, y, t: T.INFO, dir: 0, variant: 0, text: infoModalText.value });
  }
  closeInfoModal();
}
document.getElementById('infoModalOk').onclick = commitInfoModal;
document.getElementById('infoModalCancel').onclick = closeInfoModal;
infoModal.addEventListener('mousedown', (e) => { if (e.target === infoModal) closeInfoModal(); });
infoModalText.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closeInfoModal(); }
  else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitInfoModal(); }
});

let flashMsg = '', flashT = 0;
function flash(m) { flashMsg = m; flashT = performance.now(); }

// --- loop ----------------------------------------------------------------
function loop() {
  render();
  if (performance.now() - flashT < 1500) {
    ctx.fillStyle = '#4db5ff'; ctx.font = 'bold 14px system-ui';
    ctx.fillText(flashMsg, 14, canvas.height - 36);
  }
  requestAnimationFrame(loop);
}
loop();
