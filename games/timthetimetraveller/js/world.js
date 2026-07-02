// World simulation: Tims, vortices, time travel, circuit interaction.

import {
  T, DIRS, CELL, GRAVITY, MOVE_SPEED, JUMP_VELOCITY, MAX_FALL,
  TIM_W, TIM_H, COYOTE, VORTEX_R, WIN_ENERGY, TT_WARMUP, PISTON_WARMUP,
  SOLID, PUSHABLE, key, VOID_DROP,
} from './constants.js';
import { makeGrid, cellAt } from './level.js';
import { Circuit } from './circuit.js';
import { moveAndCollide, overlap } from './physics.js';

let TIM_ID = 0;

function makeTim(x, y) {
  return {
    id: ++TIM_ID, x, y, w: TIM_W, h: TIM_H,
    px: x, py: y,               // position at the previous sim step (render lerp)
    vx: 0, vy: 0, onGround: false, airJumps: 0, facing: 1,
    coyote: 0, walk: 0,
  };
}

export class World {
  constructor(level) {
    this.level = level;
    this.reset();
  }

  reset() {
    const lv = this.level;
    this.grid = makeGrid(lv);
    // The world is unbounded, so "the void" (falling = death) is the kill line
    // saved with the level, or -- if absent -- a margin below the lowest cell.
    let maxY = lv.spawn.y;
    for (const c of this.grid.values()) if (c.y > maxY) maxY = c.y;
    this.fallY = (typeof lv.voidY === 'number') ? lv.voidY : maxY + VOID_DROP;
    this.circuit = new Circuit(this.grid);
    // Buttons and info panels never move (only walls/wires get shoved), so
    // gather them once here instead of re-scanning the whole grid every frame.
    this.buttonCells = [];
    this.infoCells = [];
    for (const c of this.grid.values()) {
      if (c.t === T.BUTTON) this.buttonCells.push(c);
      else if (c.t === T.INFO && c.text) this.infoCells.push(c);
    }
    const t = makeTim(lv.spawn.x, lv.spawn.y - TIM_H);
    this.tims = [t];
    this.focus = 0;
    this.vortices = lv.vortices.map((v) => ({ ...v, alive: true }));
    this.energy = 0;
    this.timeTravels = [];      // active sequences
    this.blueVortex = null;     // {x,y} while a TT is warming up
    this.status = 'play';       // 'play' | 'win' | 'dead'
    this.time = 0;
    this.particles = [];
    this.deathPos = null;
    this.activeInfo = null;     // info-panel message currently being touched
    this.events = [];           // one-shot sim events drained by the host (audio)
    this.prevPressed = new Set(); // last frame's pressed buttons (for click sfx)
  }

  get focused() { return this.tims[this.focus]; }

  // Record a one-shot event (jump, collect, death, ...). The host drains
  // `events` each frame to fire sound effects; the sim itself stays pure so it
  // still runs headless (tests, node) with no audio dependency.
  emit(name, data) { this.events.push(data ? { name, ...data } : name); }

  // Position of a world event relative to the focused Tim ("the listener"), so
  // the host can spatialise its sound: `dist` (cells) attenuates + muffles,
  // signed `dx` (cells) pans left/right. Returns null if there's no listener.
  listenerRel(cx, cy) {
    const L = this.focused;
    if (!L) return null;
    const dx = cx - (L.x + L.w / 2), dy = cy - (L.y + L.h / 2);
    return { dist: Math.hypot(dx, dy), dx };
  }

  cycleFocus() {
    if (this.tims.length < 2) return;
    this.focus = (this.focus + 1) % this.tims.length;
    this.emit('switch');
  }

  focusAtPixel(wx, wy) {
    // wx,wy in cell coords. Pick the Tim under the point.
    for (let i = 0; i < this.tims.length; i++) {
      const t = this.tims[i];
      if (wx >= t.x && wx <= t.x + t.w && wy >= t.y && wy <= t.y + t.h) {
        this.focus = i; return true;
      }
    }
    return false;
  }

  // The most recently spawned Tim (highest id) is the "live" present self.
  newestTim() {
    let n = this.tims[0];
    for (const t of this.tims) if (t.id > n.id) n = t;
    return n;
  }

  // Initiate time travel from the focused Tim (Space). Only the newest Tim may
  // launch a trip -- an older self doing so would fork the timeline.
  startTimeTravel() {
    if (this.status !== 'play') return;
    if (this.blueVortex) return; // one warming-up portal at a time
    if (this.focused !== this.newestTim()) return;
    const t = this.focused;
    const pos = { x: t.x, y: t.y };
    this.blueVortex = { x: pos.x, y: pos.y };
    // World-time at which this self vanishes -- render eases him out (spin +
    // shrink to nothing) over the last moment before this instant.
    t.vanishAt = this.time + TT_WARMUP;
    this.timeTravels.push({
      t: 0, energy: this.energy, pos,
      spawnAt: TT_WARMUP - this.energy, vanishAt: TT_WARMUP,
      oldTim: t, spawned: false,
    });
    this.emit('timeTravel');
  }

  // --- solids ------------------------------------------------------------
  solidCellRect(c) { return { x: c.x, y: c.y, w: 1, h: 1 }; }

  pistonExtensionRects() {
    const rects = [];
    for (const p of this.circuit.pistons) {
      if (!p.on) continue;
      const [dx, dy] = DIRS[p.dir];
      rects.push({ x: p.x + dx, y: p.y + dy, w: 1, h: 1, piston: p });
    }
    return rects;
  }

  // Gather solid rects relevant to `actor`, excluding the actor itself.
  solidsFor(actor, pistonRects) {
    const solids = [];
    const x0 = Math.floor(actor.x) - 2, x1 = Math.floor(actor.x + actor.w) + 2;
    const y0 = Math.floor(actor.y) - 2, y1 = Math.floor(actor.y + actor.h) + 2;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const c = cellAt(this.grid, x, y);
        if (c && SOLID.has(c.t)) solids.push({ x, y, w: 1, h: 1 });
      }
    }
    for (const r of pistonRects) solids.push(r);
    for (const other of this.tims) {
      if (other === actor) continue;
      solids.push({ x: other.x, y: other.y, w: other.w, h: other.h });
    }
    return solids;
  }

  // Freeze every Tim that shares space with another. Overlaps only arise when a
  // time-travelling Tim materializes inside an existing one; both stay locked
  // until the overlap resolves (the older self vanishes), then they unfreeze on
  // their own the next frame.
  updateFrozen() {
    for (const t of this.tims) t.frozen = false;
    for (let i = 0; i < this.tims.length; i++) {
      for (let j = i + 1; j < this.tims.length; j++) {
        if (overlap(this.tims[i], this.tims[j])) {
          this.tims[i].frozen = true;
          this.tims[j].frozen = true;
        }
      }
    }
  }

  // --- main step ---------------------------------------------------------
  step(dt, input) {
    if (this.status !== 'play') {
      // Round is over, but keep visual effects (explosion debris, the vortex
      // being absorbed) animating instead of freezing on the last frame.
      this.stepVortexCollect(dt);
      this.stepParticles(dt);
      return;
    }
    this.time += dt;

    // Snapshot each Tim's position before this step so the renderer can smoothly
    // interpolate between the previous and current sim states (decouples render
    // smoothness from the 60Hz sim rate -- otherwise motion aliases on displays
    // that don't run at exactly 60Hz, e.g. 120Hz phones).
    for (const t of this.tims) { t.px = t.x; t.py = t.y; }

    // 1. Buttons pressed by any Tim, and info panels any Tim is touching. Both
    //    lists are precomputed (they never move), so this is just a small scan.
    const pressed = new Set();
    let activeInfo = null;
    for (const c of this.buttonCells) {
      // Tim is inside the button cell, resting on the solid below it.
      const pad = { x: c.x + 0.1, y: c.y + 0.45, w: 0.8, h: 0.6 };
      if (this.tims.some((t) => overlap(t, pad))) pressed.add(key(c.x, c.y));
    }
    for (const c of this.infoCells) {
      // Any Tim overlapping the panel surfaces its message.
      const box = { x: c.x, y: c.y, w: 1, h: 1 };
      if (this.tims.some((t) => overlap(t, box))) { activeInfo = c.text; break; }
    }
    this.pressedNow = pressed; // for rendering button state
    this.activeInfo = activeInfo; // message to show, or null
    // Click sound the moment a button goes down (edge, not while held).
    for (const k of pressed) if (!this.prevPressed.has(k)) this.emit('button');
    this.prevPressed = pressed;

    // 2. Circuit (also resolves piston on/off and triggers crush/push).
    const prevPiston = this.circuit.pistons.map((p) => p.on);
    this.circuit.update(dt, pressed);
    this.handlePistonEdges(prevPiston);
    // A piston crush is resolved before physics, so bail out now -- otherwise
    // this frame's movement would slide Tim before the death registers.
    if (this.status !== 'play') return;

    // 3. Physics for every Tim; only the focused one reads input.
    // First, lock any Tims that are overlapping. Normal collision keeps Tims
    // apart, so the only way two occupy the same space is when one time-travels
    // in on top of another -- and then neither may move until the overlap clears
    // (i.e. until the older self disappears back into time).
    this.updateFrozen();
    const pistonRects = this.pistonExtensionRects();
    for (const t of this.tims) {
      if (t.frozen) { t.vx = 0; t.vy = 0; t.walk = 0; continue; }
      const ctrl = (t === this.focused);
      let ax = 0;
      if (ctrl) {
        if (input.left) ax -= 1;
        if (input.right) ax += 1;
      }
      t.vx = ax * MOVE_SPEED;
      if (ax !== 0) t.facing = ax > 0 ? 1 : -1;

      t.vy += GRAVITY * dt;
      if (t.vy > MAX_FALL) t.vy = MAX_FALL;

      if (t.onGround) t.coyote = COYOTE; else t.coyote = Math.max(0, t.coyote - dt);

      if (ctrl && input.jumpPressed) {
        if (t.onGround || t.coyote > 0) {
          // Ground jump: still leaves the one banked air jump (full double jump).
          t.vy = -JUMP_VELOCITY; t.airJumps = 1; t.coyote = 0;
          this.emit('jump');
        } else if (t.airJumps > 0) {
          t.vy = -JUMP_VELOCITY; t.airJumps -= 1; t.coyote = 0;
          this.emit('jump2');   // the airborne (double) jump has its own note
        }
      }

      const wasAir = !t.onGround;
      const solids = this.solidsFor(t, pistonRects);
      const r = moveAndCollide(t, t.vx, t.vy, dt, solids);
      // Landing banks ONE air jump. So a ground jump gives two jumps total, but
      // simply walking off a ledge still leaves you one mid-air jump (not two).
      if (r.landed) {
        if (wasAir && t.vy > 4) this.emit('land');  // only a real fall thuds
        t.onGround = true; t.vy = 0; t.airJumps = 1;
      } else { t.onGround = false; }
      if (r.head && t.vy < 0) t.vy = 0;
      if (ctrl && Math.abs(t.vx) > 0.1) t.walk += dt * 10; else t.walk = 0;
    }
    input.jumpPressed = false; // consume edge

    // Falling out of the world is lethal (below the built area's void line).
    for (const t of this.tims) {
      if (t.y > this.fallY) { this.kill(t, 'fall'); return; }
    }

    // 4. Live-wire contact is lethal -- unless a button caps the wire (the
    //    button insulates Tim, so a wire directly under a button is safe).
    //    Wires are solid, so Tim is stopped flush against them (touching, with
    //    zero overlap). We inflate his box by a hair and test real overlap so a
    //    touch from ANY side counts -- otherwise float rounding made side
    //    contact miss the wire cell.
    const EPS = 0.07;
    for (const t of this.tims) {
      const box = { x: t.x - EPS, y: t.y - EPS, w: t.w + 2 * EPS, h: t.h + 2 * EPS };
      for (let yy = Math.floor(box.y); yy <= Math.floor(box.y + box.h); yy++) {
        for (let xx = Math.floor(box.x); xx <= Math.floor(box.x + box.w); xx++) {
          const c = cellAt(this.grid, xx, yy);
          if (!c || c.t !== T.WIRE || !this.circuit.isWireLive(xx, yy)) continue;
          if (!overlap(box, { x: xx, y: yy, w: 1, h: 1 })) continue;
          const above = cellAt(this.grid, xx, yy - 1);
          if (above && above.t === T.BUTTON) continue; // insulated
          this.kill(t, 'wire'); return;
        }
      }
    }

    // 5. Vortex interactions.
    for (const v of this.vortices) {
      if (!v.alive || v.collecting) continue;
      for (const t of this.tims) {
        const tcx = t.x + t.w / 2, tcy = t.y + t.h / 2;
        const dx = tcx - v.x, dy = tcy - v.y;
        if (dx * dx + dy * dy <= (VORTEX_R + 0.35) ** 2) {
          if (v.color === 'red') { this.kill(t, 'red'); return; }
          if (v.color === 'green') {
            // Start the "absorbed" animation: the vortex shrinks and homes into
            // the Tim that touched it. Energy is banked immediately.
            v.collecting = true; v.ct = 0; v.scale = 1; v.by = t;
            this.energy = Math.min(WIN_ENERGY, this.energy + 1);
            this.emit('collect');
            if (this.energy >= WIN_ENERGY) { this.status = 'win'; this.emit('win'); }
          }
          break;
        }
      }
    }

    // 6. Time-travel sequencing.
    this.stepTimeTravel(dt);

    // 7. Visual animations.
    this.stepVortexCollect(dt);
    this.stepParticles(dt);
  }

  // Shrink each collecting vortex and pull it into the Tim that grabbed it.
  stepVortexCollect(dt) {
    const DUR = 0.34;
    for (const v of this.vortices) {
      if (!v.collecting) continue;
      v.ct += dt;
      const t = v.by;
      if (t) {
        const tx = t.x + t.w / 2, ty = t.y + t.h / 2;
        const k = Math.min(1, dt * 13);   // ease toward Tim
        v.x += (tx - v.x) * k;
        v.y += (ty - v.y) * k;
      }
      v.scale = Math.max(0, 1 - v.ct / DUR);
      if (v.ct >= DUR) { v.alive = false; v.collecting = false; }
    }
  }

  handlePistonEdges(prevOn) {
    const ps = this.circuit.pistons;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.on && !prevOn[i]) {
        const [dx, dy] = DIRS[p.dir];
        const ex = p.x + dx, ey = p.y + dy;
        // Mechanical clunk, spatialised so distant pistons are quieter + duller.
        if (this.time >= PISTON_WARMUP)
          this.emit('piston', this.listenerRel(p.x + 0.5, p.y + 0.5));
        // Crush any Tim occupying the extension cell.
        const head = { x: ex, y: ey, w: 1, h: 1 };
        for (const t of this.tims) {
          if (overlap(t, head)) {
            this.kill(t, 'piston');
            // Topple over, away from the piston's shove.
            t.topple = true;
            t.toppleDir = dx !== 0 ? Math.sign(dx) : (t.facing || 1);
            return;
          }
        }
        // Shove the run of pushable blocks ahead of the head one cell along.
        this.pushBlocks(ex, ey, dx, dy);
      }
    }
  }

  // Push a contiguous line of PUSHABLE cells starting at (ex,ey) one step in
  // (dx,dy). The whole run only moves if the cell just past its far end is
  // empty, and never during the start-of-run settling window. Cells are moved
  // (not copied) so a wire keeps its identity/power in the circuit as it slides
  // -- the circuit re-floods from the new positions next frame.
  pushBlocks(ex, ey, dx, dy) {
    if (this.time < PISTON_WARMUP) return;      // circuits still stabilizing
    const MAX = 12;                             // sanity cap on run length
    const run = [];
    let x = ex, y = ey;
    for (let i = 0; i < MAX; i++) {
      const c = cellAt(this.grid, x, y);
      if (!c) break;                            // reached open space to push into
      if (!PUSHABLE.has(c.t)) return;           // immovable block -> jammed, no push
      run.push(c);
      x += dx; y += dy;
    }
    if (!run.length) return;                    // extension cell was already empty
    if (cellAt(this.grid, x, y)) return;        // no free cell at the far end
    // Shift far end first so we never clobber a not-yet-moved cell.
    let movedWire = false;
    for (let k = run.length - 1; k >= 0; k--) {
      const c = run[k];
      if (c.t === T.WIRE) movedWire = true;
      this.grid.delete(key(c.x, c.y));
      c.x += dx; c.y += dy;
      this.grid.set(key(c.x, c.y), c);
    }
    // Wire moved -> adjacency changed, so the circuit must regroup next frame.
    if (movedWire) this.circuit.groupsDirty = true;
  }

  stepTimeTravel(dt) {
    for (let i = this.timeTravels.length - 1; i >= 0; i--) {
      const tt = this.timeTravels[i];
      tt.t += dt;
      if (!tt.spawned && tt.t >= tt.spawnAt) {
        const nt = makeTim(tt.pos.x, tt.pos.y);
        nt.appearAt = this.time;   // render spins + scales him up from nothing
        this.tims.push(nt);
        // Focus stays on whichever Tim the player is currently controlling --
        // a newly-arrived Tim does not steal the camera/control.
        tt.spawned = true;
        this.blueVortex = null;
        this.emit('spawn');
      }
      if (tt.t >= tt.vanishAt) {
        const idx = this.tims.indexOf(tt.oldTim);
        if (idx >= 0) {
          this.tims.splice(idx, 1);
          if (this.focus >= this.tims.length) this.focus = this.tims.length - 1;
          else if (idx < this.focus) this.focus--;
          this.emit('vanish');
        }
        this.timeTravels.splice(i, 1);
      }
    }
    if (this.focus < 0 && this.tims.length) this.focus = 0;
  }

  kill(t, cause = 'generic') {
    this.deathPos = { x: t.x + t.w / 2, y: t.y + t.h / 2 };
    if (cause === 'red') {
      this.spawnExplosion(this.deathPos.x, this.deathPos.y);
    } else {
      const color = cause === 'wire' ? '#ffe05a' : '#9aa3b5';
      this.spawnBurst(this.deathPos.x, this.deathPos.y, color, 26);
    }
    // Every death makes Tim keel over (piston deaths refine the direction).
    t.topple = true;
    t.toppleDir = t.facing || 1;
    this.deathMsg = World.DEATH_MESSAGES[cause] || World.DEATH_MESSAGES.generic;
    this.status = 'dead';
    this.emit('death:' + cause);
  }

  // --- particles ---------------------------------------------------------
  // A big fiery explosion with debris -- the red-vortex death.
  spawnExplosion(x, y) {
    const colors = ['#ff4d5e', '#ff8a3d', '#ffd166', '#ffffff'];
    for (let i = 0; i < 42; i++) {
      const a = (i / 42) * Math.PI * 2 + (i % 7);
      const sp = 3 + (i % 8);
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2,
        life: 0.5 + (i % 5) * 0.14, t: 0, color: colors[i % colors.length], big: i % 3 === 0 });
    }
  }

  // An outward burst -- used for other deaths.
  spawnBurst(x, y, color, n = 14) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (i % 3);
      const sp = 2 + (i % 5);
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1,
        life: 0.5 + (i % 4) * 0.12, t: 0, color });
    }
  }

  stepParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 18 * dt;
      if (p.t >= p.life) this.particles.splice(i, 1);
    }
    // Spark particles on live wires for atmosphere.
    if ((this.time * 60 | 0) % 4 === 0) {
      const live = this.circuit.wires.filter((w) => w.powered);
      if (live.length) {
        const c = live[(this.time * 7 | 0) % live.length];
        this.particles.push({ x: c.x + 0.5 + (Math.sin(this.time * 53) * 0.4),
          y: c.y + 0.5 + (Math.cos(this.time * 37) * 0.4),
          vx: (this.time * 13 % 2) - 1, vy: -1 - (this.time * 11 % 1),
          life: 0.2, t: 0, color: '#fff6c0' });
      }
    }
  }
}

World.DEATH_MESSAGES = {
  red: "Don't touch the red ones.",
  wire: 'Zap! That was a live wire.',
  piston: 'Squish. You were slapped silly by a piston.',
  fall: 'Mind the gap — you fell into the void.',
  generic: 'You died.',
};
