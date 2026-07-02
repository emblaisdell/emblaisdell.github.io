// Level format + grid construction.
//
// A level is plain JSON so it can be produced by the editor and embedded
// statically:
//   { name, cols, rows, spawn:{x,y}, cells:[{x,y,t,...props}], vortices:[{x,y,color}] }
// Grid coordinates are integer cells. spawn/vortices use cell coordinates
// (floats allowed) measured from each cell's top-left.

import { key } from './constants.js';

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

// A blank canvas: no blocks, just a spawn point. Used as the editor's starting
// state when nothing is saved, and as the game's last-ditch fallback if the
// bundled map fails to load. Returns a fresh object each call so callers can
// mutate it freely.
export function emptyLevel() {
  return { name: 'Untitled', spawn: { x: 1, y: 1 }, cells: [], vortices: [] };
}
