// Electronics simulation.
//
// Model:
//  * WIRE cells conduct with NO delay. Connected wires are grouped ONCE (a
//    flood over adjacency at build time) into electrical nodes; the flood is not
//    repeated per frame. Each frame we just mark which groups a source touches
//    -- a pressed button's wire, an active coin, a true NOT-gate output, a fired
//    delay-line output -- and copy that single bit onto the group's cells. A
//    group therefore switches SIMULTANEOUSLY: every cell is live this frame iff
//    the group is driven this frame. (A piston that slides a wire changes
//    adjacency, so it flags the groups dirty and they are rebuilt next frame.)
//  * Timing lives in components, not in wires. A DELAY line is a directional
//    buffer whose output copies its input but lagged by DELAY_TIME seconds (on
//    both the rising and falling edge). Drop one into a NOT feedback loop to get
//    a bounded oscillator (a blinker with period ~2*DELAY_TIME).
//  * Gates/delays read the wire states settled at the END of the previous frame
//    (held on each cell's `powered`), so a 0-delay combinational loop can't form
//    within a single frame. Everything is recomputed from scratch each frame, so
//    grid mutation (a piston-shoved wire) needs no special handling.

import { T, DIRS, opposite, key, DELAY_TIME } from './constants.js';

export class Circuit {
  constructor(grid) {
    this.grid = grid;
    this.rebuild();
  }

  rebuild() {
    const grid = this.grid;
    this.time = 0;
    this.wires = [];     // [cell] for each WIRE cell (state lives on the cell)
    this.buttons = [];   // {x,y}
    this.nots = [];      // {x,y, inX,inY, outX,outY, output}
    this.pistons = [];   // {x,y, dir, on}
    this.coins = [];     // [cell] for each COIN cell (.active rolled once here)
    this.delays = [];    // {cell, inX,inY, outX,outY, output}; history on cell.delayHist

    // The grid is a sparse Map (the world is unbounded), so walk the cells that
    // exist rather than scanning a fixed rectangle.
    for (const c of grid.values()) {
      const x = c.x, y = c.y;
      if (c.t === T.WIRE) {
        c.powered = false;
        this.wires.push(c);
      } else if (c.t === T.BUTTON) {
        this.buttons.push({ x, y });
      } else if (c.t === T.NOT) {
        const out = c.dir, ind = opposite(out);
        this.nots.push({ x, y, output: false,
          inX: x + DIRS[ind][0], inY: y + DIRS[ind][1],
          outX: x + DIRS[out][0], outY: y + DIRS[out][1] });
      } else if (c.t === T.DELAY) {
        const out = c.dir, ind = opposite(out);
        c.delayOn = false;                     // current output (for rendering)
        c.delayHist = [{ t: 0, v: false }];    // input change-points -> output + viz
        this.delays.push({ cell: c, output: false,
          inX: x + DIRS[ind][0], inY: y + DIRS[ind][1],
          outX: x + DIRS[out][0], outY: y + DIRS[out][1] });
      } else if (c.t === T.PISTON) {
        this.pistons.push({ x, y, dir: c.dir, on: false });
      } else if (c.t === T.COIN) {
        // Flip the coin once, now, for the whole run.
        c.active = Math.random() < 0.5;
        this.coins.push(c);
      }
    }

    this.rebuildGroups();
  }

  // Precompute connected wire groups (flood adjacency ONCE, not every frame).
  // Every wire in a group is electrically the same node, so it switches as a
  // unit and instantaneously: per frame we only decide which groups are driven,
  // then copy that one bit onto their member cells. A piston that slides a wire
  // changes adjacency, so it flags `groupsDirty` and we regroup next update.
  rebuildGroups() {
    this.wireGroups = [];
    for (const w of this.wires) w.group = -1;
    for (const seed of this.wires) {
      if (seed.group !== -1) continue;
      const gid = this.wireGroups.length;
      const group = [];
      const stack = [seed];
      seed.group = gid;
      while (stack.length) {
        const cur = stack.pop();
        group.push(cur);
        for (const [dx, dy] of DIRS) {
          const n = this.wireAt(cur.x + dx, cur.y + dy);
          if (n && n.group === -1) { n.group = gid; stack.push(n); }
        }
      }
      this.wireGroups.push(group);
    }
    this.groupDriven = new Array(this.wireGroups.length).fill(false);
    this.groupsDirty = false;
  }

  wireAt(x, y) {
    const c = this.grid.get(key(x, y)) ?? null;
    return (c && c.t === T.WIRE) ? c : null;
  }

  isWireLive(x, y) {
    const c = this.wireAt(x, y);
    return !!(c && c.powered);
  }

  update(dt, pressedButtons) {
    this.time += dt;
    // A piston shoved a wire since last frame -> adjacency changed, regroup.
    if (this.groupsDirty) this.rebuildGroups();

    // 1. Component outputs, read from last frame's settled wire states.
    for (const n of this.nots) {
      const inW = this.wireAt(n.inX, n.inY);
      n.output = !(inW && inW.powered);
    }
    for (const d of this.delays) {
      const inW = this.wireAt(d.inX, d.inY);
      const desired = !!(inW && inW.powered);
      const hist = d.cell.delayHist;
      if (desired !== hist[hist.length - 1].v) hist.push({ t: this.time, v: desired });
      // A true delay line: the output is the input as it was DELAY_TIME ago, so
      // the whole on/off pattern is reproduced (even short pulses survive), just
      // shifted later in time.
      const past = this.time - DELAY_TIME;
      let val = hist[0].v, keep = 0;
      for (let k = 0; k < hist.length; k++) {
        if (hist[k].t <= past) { val = hist[k].v; keep = k; } else break;
      }
      if (keep > 0) hist.splice(0, keep);   // drop change-points fully past the window
      d.output = val;
      d.cell.delayOn = val;
    }

    // 2. Decide which wire GROUPS are driven this frame. A source touching any
    //    cell of a group lights the whole group -- no flooding needed, the group
    //    membership was precomputed.
    const driven = this.groupDriven;
    driven.fill(false);
    const drive = (x, y) => {
      const w = this.wireAt(x, y);
      if (w) driven[w.group] = true;
    };
    for (const b of this.buttons) if (pressedButtons.has(key(b.x, b.y))) drive(b.x, b.y + 1);
    for (const n of this.nots) if (n.output) drive(n.outX, n.outY);
    for (const d of this.delays) if (d.output) drive(d.outX, d.outY);
    for (const coin of this.coins) {
      if (!coin.active) continue;
      for (const [dx, dy] of DIRS) drive(coin.x + dx, coin.y + dy);
    }

    // 3. Every wire in a driven group goes live simultaneously.
    for (const w of this.wires) w.powered = driven[w.group];

    // 4. Pistons follow the wires touching their body (delayed states irrelevant
    //    now -- wires are instant).
    for (const p of this.pistons) {
      p.on = DIRS.some(([dx, dy]) => this.isWireLive(p.x + dx, p.y + dy));
    }
  }
}
