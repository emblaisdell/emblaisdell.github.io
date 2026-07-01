// Level format + grid construction.
//
// A level is plain JSON so it can be produced by the editor and embedded
// statically:
//   { name, cols, rows, spawn:{x,y}, cells:[{x,y,t,...props}], vortices:[{x,y,color}] }
// Grid coordinates are integer cells. spawn/vortices use cell coordinates
// (floats allowed) measured from each cell's top-left.

import { T, key } from './constants.js';

// The grid is a sparse, unbounded Map: "x,y" -> cell. The world is infinite, so
// there are no fixed rows/cols and cells may live at any (even negative) coords.
export function makeGrid(level) {
  const grid = new Map();
  for (const c of level.cells) {
    grid.set(key(c.x, c.y), { x: c.x, y: c.y, t: c.t, dir: c.dir ?? 0,
                              variant: c.variant ?? 0, text: c.text ?? '' });
  }
  return grid;
}

export function cellAt(grid, x, y) {
  return grid.get(key(x, y)) ?? null;
}

// --- The built-in test level ---------------------------------------------
// Showcases: double-jump platforming over bottomless pits, a piston "thumper"
// wired to a button, a red vortex hazard, green energy pickups, and a
// NOT-gate-controlled live-wire curtain that can only be passed by holding a
// button -- which you do with a *past self* via time travel.

function buildTestLevel() {
  const cols = 56, rows = 20, FLOOR = 16;
  const cells = [];
  const vortices = [];
  const seen = new Map(); // "x,y" -> index, so we can overwrite cells

  const put = (x, y, t, props = {}) => {
    const k = x + ',' + y;
    const cell = { x, y, t, ...props };
    if (seen.has(k)) cells[seen.get(k)] = cell;
    else { seen.set(k, cells.length); cells.push(cell); }
  };
  const del = (x, y) => {
    const k = x + ',' + y;
    if (seen.has(k)) { cells[seen.get(k)] = null; }
  };
  const wall = (x, y, variant = 0) => put(x, y, T.WALL, { variant });
  const rect = (x0, y0, x1, y1, v = 0) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) wall(x, y, v);
  };
  const column = (x) => { for (let y = 0; y <= rows - 1; y++) del(x, y); };
  const green = (x, y) => vortices.push({ x, y, color: 'green' });
  const red = (x, y) => vortices.push({ x, y, color: 'red' });

  // Floor + base, then side walls.
  rect(0, FLOOR, cols - 1, rows - 1, 0);
  rect(0, 0, 0, FLOOR - 1);
  rect(cols - 1, 0, cols - 1, FLOOR - 1);

  // ---- Start area ----
  green(3.5, FLOOR - 1.5);
  green(6.5, FLOOR - 1.5);
  // A walk-through info panel greets Tim with the rules.
  put(8, FLOOR - 1, T.INFO, { text:
    'Welcome, Tim! Collect 10 green energies to win. Press SPACE to send a ' +
    'copy of yourself back in time — past selves can hold buttons for you. ' +
    'Never touch a glowing live wire.' });

  // ---- Piston "thumper" demo: button (24) drives a piston (25) up ----
  // Button sits in the air just above the floor (Tim walks through it); the
  // wire it powers is the floor cell beneath it -- which it also insulates.
  put(24, FLOOR - 1, T.BUTTON);
  put(24, FLOOR, T.WIRE);               // floor-level wire under the button
  put(25, FLOOR, T.PISTON, { dir: 0 }); // sits flush in floor, extends up
  green(26.5, FLOOR - 1.5);

  // ---- Platforming: two bottomless pits with floating platforms ----
  column(11); column(12); column(13);
  wall(12, FLOOR - 4);                  // floating platform
  green(12.5, FLOOR - 4.5);

  wall(16, FLOOR - 3); wall(17, FLOOR - 3); // ledge
  green(16.5, FLOOR - 3.5);

  column(20); column(21);
  wall(20, FLOOR - 3);                  // floating platform over pit 2
  green(20.5, FLOOR - 3.5);

  // ---- A red vortex hazard hanging at head height (don't jump into it) ----
  red(28.5, FLOOR - 2.2);
  green(30.5, FLOOR - 1.5);

  // ---- Coin "random thumper": a piston fed by a coin instead of a button ----
  // The coin flips on spawn, so on roughly half of playthroughs the piston is
  // already raised here (a 1-cell block to hop) and on the other half the floor
  // is flat. Coin + feed wire sit under the floor, sealed away from Tim.
  put(34, FLOOR, T.PISTON, { dir: 0 });   // sits flush in floor, extends up
  put(34, FLOOR + 1, T.WIRE);             // feed wire below the piston
  put(35, FLOOR + 1, T.COIN);             // coin drives that wire (under-floor)

  // ---- The gate room: NOT-gate live-wire curtain at x=43 ----
  // Button (38) -> wire bus under floor -> NOT gate (42) -> curtain (43).
  // Default (button up): NOT outputs ON -> curtain LIVE -> impassable.
  // Hold button: NOT output OFF -> curtain safe to cross.
  put(38, FLOOR - 1, T.BUTTON);         // walk-through, above the floor
  put(38, FLOOR, T.WIRE);               // floor-level wire (insulated by button)
  put(38, FLOOR + 1, T.WIRE);           // drops to the under-floor bus
  put(39, FLOOR + 1, T.WIRE);
  put(40, FLOOR + 1, T.WIRE);
  put(41, FLOOR + 1, T.WIRE);           // input bus, ends at NOT-gate input
  put(42, FLOOR + 1, T.NOT, { dir: 1 }); // in = left (bus), out = right (curtain)
  // Curtain: vertical wire bar through the doorway (incl. the floor cell, which
  // is a solid wire you walk on when it's safe).
  put(43, FLOOR + 1, T.WIRE);
  put(43, FLOOR, T.WIRE);
  put(43, FLOOR - 1, T.WIRE);
  put(43, FLOOR - 2, T.WIRE);
  // Ceiling above the doorway so you can't simply hop over the curtain.
  rect(41, FLOOR - 3, 45, FLOOR - 3);

  // ---- Reward room: a small ancient-temple chamber (per the README theme) ----
  for (let x = 44; x <= 54; x++) put(x, FLOOR, T.TEMPLE, { variant: 0 }); // stone floor
  put(46, FLOOR, T.TEMPLE, { variant: 1 });   // a glyph slab
  put(50, FLOOR, T.TEMPLE, { variant: 2 });   // a cracked slab
  for (let x = 44; x <= 54; x++) put(x, FLOOR - 4, T.TEMPLE, { variant: 0 }); // stone ceiling
  put(47, FLOOR - 3, T.LIGHT);                 // hanging lamps
  put(51, FLOOR - 3, T.LIGHT);
  put(44, FLOOR - 3, T.TORCH);                 // wall torches
  put(54, FLOOR - 3, T.TORCH);
  put(53, FLOOR - 1, T.TABLE);                 // a workbench in the corner
  green(45.5, FLOOR - 1.5);
  green(47.5, FLOOR - 1.5);
  green(49.5, FLOOR - 1.5);

  return {
    name: 'Test Lab 01',
    cols, rows,
    spawn: { x: 1.6, y: FLOOR - 1.0 },
    cells: cells.filter(Boolean),
    vortices,
  };
}

export const TEST_LEVEL = buildTestLevel();
