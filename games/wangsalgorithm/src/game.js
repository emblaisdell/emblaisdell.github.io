/*
 * game.js — wires logic + engine + render to the canvas, input and UI.
 */
(function (root) {
  'use strict';
  var L = root.logic, E = root.engine, R = root.render;
  function A() { return root.audio; }   // resolved late; audio.js may load after

  var MARGIN = 28;
  var BAR_FADE = 380;         // ms for the bar joining a split's halves to fade
  // Annihilation, as fractions of the animation: the two halves rush together
  // and meet at ANN_MEET, finish swelling to ANN_GROW times their size at
  // ANN_FULL, hold there a beat, and the whole circle fades out from ANN_FADE.
  var LONG_PRESS = 450;       // ms of holding before a tap becomes a weakening
  var PRESS_SLOP = 12;        // px of drift that cancels that hold
  var TAP_MIN = 44;           // CSS px we try to keep every tap target above
  var COMPACT = [1, 0.86, 0.72, 0.6, 0.5];  // metric ladder, roomiest first

  var ANN_GROW = 3;
  var ANN_MEET = 0.45;
  var ANN_FULL = 0.60;
  var ANN_FADE = 0.70;
  var MODE_LABEL = { standard: 'Standard', zen: 'Zen', tautological: 'Tautological' };

  function Game(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;
    this.mode = 'standard';
    this.level = 1;
    this.state = null;
    this.hits = [];
    this.centers = {};
    this.hover = null;
    this.anims = [];          // {type, rowId, ...} ; annihilate is blocking
    this.transform = { s: 1, ox: 0, oy: 0 };
    this.onChange = null;     // UI callback(state)
    this.particles = makeParticles(110); // drifting background flourishes
    this.field = new root.float.Field();  // where the molecules actually are
    this.layout = null;                   // where they would ideally be
    this.view = null;                     // the layout->screen transform in use
    this.pan = { x: 0, y: 0 };            // how far the player has dragged the board
    this.panning = null;                  // an in-progress drag
    this.canPan = false;                  // is the board bigger than the screen?
    this.lastT = null;

    var self = this;
    window.addEventListener('resize', function () { self.resize(); });
    // A real gesture is the only thing that can start audio, so the first tap
    // on the board doubles as the unlock.
    canvas.addEventListener('pointerdown', function () {
      if (A()) A().unlock();
    }, { passive: true });
    canvas.addEventListener('pointerdown', function (e) { self.onDown(e); });
    canvas.addEventListener('pointermove', function (e) { self.onMove(e); });
    canvas.addEventListener('pointerup', function (e) { self.onUp(e); });
    canvas.addEventListener('pointercancel', function (e) {
      if (self.press && self.press.id !== e.pointerId) return;
      if (self.panning && self.panning.id !== e.pointerId) return;
      self.endPress(); self.panning = null; self.hover = null;
    });
    canvas.addEventListener('pointerleave', function () { if (!self.press) self.hover = null; });
    // Suppress the context menu across the whole play area — not just the
    // canvas — so it never appears on a right-click delete even when an overlay
    // (e.g. the lose screen) has popped up under the cursor by the time the
    // contextmenu event fires.
    (canvas.closest('main') || document).addEventListener('contextmenu',
      function (e) { e.preventDefault(); });

    this.resize();
    this.newGame();
    requestAnimationFrame(function loop(t) { self.frame(t); requestAnimationFrame(loop); });
  }

  Game.prototype.now = function () { return performance.now(); };

  Game.prototype.resize = function () {
    var c = this.canvas;
    this.dpr = window.devicePixelRatio || 1;
    var w = c.clientWidth, h = c.clientHeight;
    c.width = Math.max(1, Math.round(w * this.dpr));
    c.height = Math.max(1, Math.round(h * this.dpr));
  };

  Game.prototype.newGame = function () {
    this.endGesture();
    this.field.clear();
    this.view = null;
    this.pan.x = this.pan.y = 0;
    this.lastT = null;
    this.wonAnnounced = false;
    this.state = E.newGame(this.mode, this.level, this.now());
    // remember the exact generated puzzle so Replay restores *this* level
    this.snapshot = this.state.rows.map(function (r) {
      return r.mols.map(function (e) { return L.clone(e.m); });
    });
    this.anims = [];
    this.hover = null;
    if (this.onChange) this.onChange(this.state);
  };

  // Replay the exact same puzzle that was last generated (not a fresh roll).
  Game.prototype.replay = function () {
    if (!this.snapshot) { this.newGame(); return; }
    this.endGesture();
    this.field.clear();
    this.view = null;
    this.pan.x = this.pan.y = 0;
    this.lastT = null;
    this.wonAnnounced = false;
    var now = this.now();
    var rows = this.snapshot.map(function (mols) {
      return E.makeRow(mols.map(L.clone), now);
    });
    this.state = { mode: this.mode, level: this.level, moves: 0, solved: false, rows: rows };
    this.anims = [];
    this.hover = null;
    if (this.onChange) this.onChange(this.state);
  };

  Game.prototype.setMode = function (mode) {
    this.mode = mode;
    this.level = 1;
    this.newGame();
  };

  Game.prototype.nextLevel = function () { this.level++; this.newGame(); };
  Game.prototype.reset = function () { this.newGame(); };

  Game.prototype.blocking = function () {
    for (var i = 0; i < this.anims.length; i++) if (this.anims[i].blocking) return true;
    return false;
  };

  // ----- coordinate mapping -------------------------------------------------
  Game.prototype.toDesign = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    var px = e.clientX - rect.left, py = e.clientY - rect.top;
    var t = this.transform;
    return { x: (px - t.ox) / t.s, y: (py - t.oy) / t.s };
  };

  Game.prototype.hitAt = function (p) {
    // every molecule's hitbox is the circle containing it; pick the nearest
    // centre among the circles the point falls inside (handles overlaps).
    var best = null, bestD = Infinity;
    for (var i = 0; i < this.hits.length; i++) {
      var h = this.hits[i];
      var dx = p.x - h.cx, dy = p.y - h.cy, d = dx * dx + dy * dy;
      if (d <= h.hr * h.hr && d < bestD) { best = h; bestD = d; }
    }
    return best;
  };

  // ----- input --------------------------------------------------------------
  Game.prototype.onHover = function (e) {
    if (this.blocking()) { this.hover = null; return; }
    var h = this.hitAt(this.toDesign(e));
    this.hover = h ? { rowIndex: h.rowIndex, molId: h.molId, kind: h.kind } : null;
    this.canvas.style.cursor = h ? 'pointer' : 'default';
  };

  // A mouse acts the instant it is pressed, and right-click weakens.  Touch has
  // no second button, so the two moves are separated in time instead: a tap
  // plays the molecule, holding it weakens.  The molecule under a held finger
  // is highlighted the whole time, so the hold is visibly doing something
  // rather than feeling like a tap that failed to register.
  Game.prototype.onDown = function (e) {
    if (this.state.solved || this.state.lost) return;
    // One gesture at a time.  A second finger must not take over a hold the
    // first one started, or lifting either of them plays the other's molecule.
    if (this.press || this.panning) return;
    var h = this.blocking() ? null : this.hitAt(this.toDesign(e));
    if (!h) { this.startPan(e); return; }   // empty space: drag to look around

    if (e.pointerType === 'mouse') {
      if (e.button === 2) this.weaken(h.molId); else this.act(h.molId);
      return;
    }

    var self = this;
    this.press = { id: e.pointerId, x: e.clientX, y: e.clientY, molId: h.molId, fired: false };
    this.hover = { rowIndex: h.rowIndex, molId: h.molId, kind: h.kind };
    this.press.timer = setTimeout(function () {
      if (!self.press) return;
      self.press.fired = true;
      if (navigator.vibrate) { try { navigator.vibrate(18); } catch (err) {} }
      self.weaken(self.press.molId);
    }, LONG_PRESS);
  };

  Game.prototype.onMove = function (e) {
    if (this.panning) {
      if (e.pointerId !== this.panning.id) return;
      this.pan.x = this.panning.px + (e.clientX - this.panning.x);
      this.pan.y = this.panning.py + (e.clientY - this.panning.y);
      return;
    }
    if (this.press) {
      if (e.pointerId !== this.press.id) return;
      // A finger that wanders was not trying to hold still.  On a board too
      // big for the screen it was trying to drag it, so hand the gesture over
      // to a pan rather than just dropping it.
      if (Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > PRESS_SLOP) {
        this.endPress();
        this.hover = null;
        this.startPan(e);
      }
      return;
    }
    this.onHover(e);
  };

  // Anchored at the pointer's position *now*, so handing a hold over to a pan
  // does not jerk the board by the slop distance first.
  Game.prototype.startPan = function (e) {
    if (!this.canPan) return;
    this.panning = { id: e.pointerId, x: e.clientX, y: e.clientY, px: this.pan.x, py: this.pan.y };
    this.hover = null;
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) {}
  };

  Game.prototype.onUp = function (e) {
    if (this.panning) {
      if (e.pointerId !== this.panning.id) return;
      this.panning = null;
      try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) {}
      return;
    }
    var p = this.press;
    if (!p || e.pointerId !== p.id) return;
    this.endPress();
    this.hover = null;                 // touch has no hover; do not leave one behind
    if (!p.fired) this.act(p.molId);
  };

  Game.prototype.endPress = function () {
    if (this.press) { clearTimeout(this.press.timer); this.press = null; }
  };

  // Drop any gesture in flight.  Rebuilding the board while a finger is still
  // down would otherwise let a pending hold fire against the new one.
  Game.prototype.endGesture = function () {
    this.endPress();
    this.panning = null;
    this.hover = null;
  };

  // Where a molecule is *now*.  A hold is resolved when the finger lifts, and
  // the board may have been rebuilt in between, so a move is addressed by the
  // molecule's id and never by the position it happened to occupy on press.
  Game.prototype.locate = function (molId) {
    var rows = this.state.rows;
    for (var ri = 0; ri < rows.length; ri++) {
      var mols = rows[ri].mols;
      for (var mi = 0; mi < mols.length; mi++) {
        if (mols[mi].id === molId) return { ri: ri, mi: mi, m: mols[mi].m };
      }
    }
    return null;                       // it is gone; the move goes with it
  };

  Game.prototype.act = function (molId) {
    if (this.blocking() || this.state.solved || this.state.lost) return;
    var at = this.locate(molId);
    if (!at) return;
    if (at.m.t === 'or') {
      this.doDissolve(at.ri, at.mi);
    } else if (at.m.t === 'and') {
      this.doSplit(at.ri, at.mi);
    } else {
      var partner = E.findAnnihilationPartner(this.state, at.ri, at.mi);
      if (partner < 0) { this.shake(at.ri); }
      else { this.startAnnihilation(at.ri, at.mi, partner); return; }
    }
    this.hover = null;
    this.afterMove();
  };

  Game.prototype.weaken = function (molId) {
    if (this.blocking() || this.state.solved || this.state.lost) return;
    var at = this.locate(molId);
    if (!at) return;
    this.deleteMolecule(at.ri, at.mi);
    this.hover = null;
  };

  Game.prototype.afterMove = function () {
    E.rowSolved(this.state);
    if (this.state.solved && !this.wonAnnounced) {
      this.wonAnnounced = true;        // the flourish plays once, not per frame
      if (A()) A().win();
    }
    if (this.onChange) this.onChange(this.state);
  };

  Game.prototype.shake = function (rowIndex) {
    var row = this.state.rows[rowIndex];
    if (row) this.anims.push({ type: 'shake', rowId: row.id, t0: this.now(), dur: 260 });
  };

  Game.prototype.startAnnihilation = function (rowIndex, iA, iB) {
    var row = this.state.rows[rowIndex];
    var idA = row.mols[iA].id, idB = row.mols[iB].id;
    var cA = this.centers[idA], cB = this.centers[idB];
    if (!cA || !cB) { // no layout info yet; just close the row
      E.annihilateRow(this.state, rowIndex); this.afterMove(); return;
    }
    row.dying = true;
    if (A()) A().merge();
    this.anims.push({
      type: 'annihilate', blocking: true, rowId: row.id,
      idA: idA, idB: idB, cA: cA, cB: cB,
      t0: this.now(), dur: 520
    });
  };

  // ----- main frame ---------------------------------------------------------
  Game.prototype.frame = function (t) {
    this.update(t);
    this.draw(t);
  };

  Game.prototype.update = function (t) {
    var keep = [];
    for (var i = 0; i < this.anims.length; i++) {
      var a = this.anims[i];
      if (t - a.t0 >= a.dur) {
        if (a.type === 'annihilate') {
          var idx = this.indexOfRow(a.rowId);
          if (idx >= 0) this.closeRow(idx);
          this.afterMove();
        }
      } else keep.push(a);
    }
    this.anims = keep;

    // The layout is the perfect board every molecule is drawn toward; the
    // field integrates where they actually are.  Targets are set before the
    // step so a move that just rewrote the board takes effect this frame.
    this.layout = this.computeLayout();
    this.clampPan(this.layout);
    this.rebase(this.layout);
    this.syncTargets();
    var dt = this.lastT == null ? 0 : (t - this.lastT) / 1000;
    this.lastT = t;
    this.field.advance(dt);
  };

  Game.prototype.indexOfRow = function (id) {
    var rows = this.state.rows;
    for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return i;
    return -1;
  };

  Game.prototype.animFor = function (rowId, type) {
    for (var i = 0; i < this.anims.length; i++)
      if (this.anims[i].rowId === rowId && this.anims[i].type === type) return this.anims[i];
    return null;
  };

  function easeOut(p) { return 1 - Math.pow(1 - p, 3); }

  // ----- background flourishes (drifting motes / stars in the "liquid") -----
  function makeParticles(n) {
    var a = [];
    for (var i = 0; i < n; i++) {
      a.push({
        x: Math.random(), y: Math.random(),          // normalised position
        r: 0.6 + Math.random() * 1.7,                 // px radius
        spd: 0.004 + Math.random() * 0.02,            // upward drift / sec
        sway: 0.2 + Math.random() * 0.6,              // horizontal sway freq
        twk: 0.4 + Math.random() * 1.4,               // twinkle freq
        phase: Math.random() * Math.PI * 2,
        base: 0.08 + Math.random() * 0.36,            // peak opacity
        star: Math.random() < 0.12                    // a few are sparkly stars
      });
    }
    return a;
  }

  Game.prototype.drawBackground = function (ctx, t, w, h) {
    var ps = this.particles, s = t / 1000;
    ctx.save();
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      var yy = (((p.y - s * p.spd) % 1) + 1) % 1;
      var xx = (((p.x + Math.sin(s * p.sway + p.phase) * 0.01) % 1) + 1) % 1;
      var px = xx * w, py = yy * h;
      var tw = 0.45 + 0.55 * Math.sin(s * p.twk + p.phase);
      ctx.globalAlpha = Math.max(0, p.base * tw);
      ctx.fillStyle = p.star ? '#bcd2f5' : '#ffffff';
      ctx.beginPath();
      ctx.arc(px, py, p.r, 0, Math.PI * 2);
      ctx.fill();
      if (p.star && tw > 0.86) { // brief sparkle cross at peak
        ctx.globalAlpha = p.base * ((tw - 0.86) / 0.14) * 0.7;
        ctx.fillRect(px - p.r * 2.6, py - 0.4, p.r * 5.2, 0.8);
        ctx.fillRect(px - 0.4, py - p.r * 2.6, 0.8, p.r * 5.2);
      }
    }
    ctx.restore();
  };

  // ----- layout -------------------------------------------------------------
  // Measure every row and the fit-to-canvas transform.  Shared by draw() and
  // by the split-origin capture so both agree on positions exactly.
  // Measure the board at whatever metrics render.js is currently set to, and
  // report the smallest exclusive tap width that would result on screen.
  Game.prototype.measureLayout = function (cssW, cssH, minS) {
    var rows = this.state.rows;
    var sizes = rows.map(function (r) { return R.rowSize(r); });
    var totalW = 0, totalH = 0;
    for (var i = 0; i < sizes.length; i++) {
      totalW = Math.max(totalW, sizes[i].w);
      totalH += sizes[i].h;
      if (i > 0) totalH += R.ROW_GAP;
    }
    var availW = cssW - 2 * MARGIN, availH = cssH - 2 * MARGIN;
    var s = Math.min(1, totalW > 0 ? availW / totalW : 1, totalH > 0 ? availH / totalH : 1);
    s = Math.max(s, 0.0001, minS || 0);
    var ox = (cssW - s * totalW) / 2;
    var oy = Math.max(MARGIN, (cssH - s * totalH) / 2);
    var naturalY = [], cum = 0;
    for (i = 0; i < sizes.length; i++) { naturalY[i] = cum; cum += sizes[i].h + R.ROW_GAP; }
    // An atom's hitbox may reach past its neighbours' — taps resolve to the
    // nearest centre — so what a player actually owns is the smaller of the
    // hitbox and the spacing between adjacent molecules.
    var tap = Math.min(R.ATOM + 2 * R.HIT_PAD_BASE, R.ATOM + R.MOL_GAP) * s;
    return { s: s, ox: ox, oy: oy, sizes: sizes, naturalY: naturalY,
             totalW: totalW, totalH: totalH, tap: tap };
  };

  // Measure every row and the fit-to-canvas transform.  Shared by draw() and
  // by the float field so both agree on positions exactly.
  //
  // A board with room to breathe uses the roomy metrics and nothing here has
  // any effect.  A cramped one — a phone, or a board that has branched a long
  // way — steps down the ladder until the smallest molecule is tappable again,
  // trading spacing (which carries no information) for atoms (which do).
  Game.prototype.computeLayout = function () {
    var c = this.canvas, cssW = c.clientWidth, cssH = c.clientHeight, L;
    for (var i = 0; i < COMPACT.length; i++) {
      R.setScale(COMPACT[i]);
      L = this.measureLayout(cssW, cssH);
      L.compact = COMPACT[i];
      if (L.tap >= TAP_MIN) return L;
    }
    // Compaction is spent and the board still will not fit.  Stop shrinking —
    // below this the molecules stop being tappable at all — and let the player
    // drag around a board that is now bigger than the screen.
    var floor = TAP_MIN / Math.min(R.ATOM + 2 * R.HIT_PAD, R.ATOM + R.MOL_GAP);
    if (L.s < floor) {
      L = this.measureLayout(cssW, cssH, floor);
      L.compact = COMPACT[COMPACT.length - 1];
    }
    return L;
  };

  // Keep the board from being dragged off the screen: while it is bigger than
  // the viewport you may pan to its edges and no further, and when it fits
  // there is nothing to pan and it sits centred as before.
  Game.prototype.clampPan = function (L) {
    var cssW = this.canvas.clientWidth, cssH = this.canvas.clientHeight;
    var w = L.s * L.totalW, h = L.s * L.totalH, p = this.pan;
    var wide = w > cssW - 2 * MARGIN, tall = h > cssH - 2 * MARGIN;
    if (!wide) p.x = 0;
    else p.x = Math.min(MARGIN - L.ox, Math.max((cssW - MARGIN) - (L.ox + w), p.x));
    if (!tall) p.y = 0;
    else p.y = Math.min(MARGIN - L.oy, Math.max((cssH - MARGIN) - (L.oy + h), p.y));
    this.canPan = wide || tall;
  };

  // Walk the board in layout order, handing each molecule the exact spot the
  // layout wants it in.  One definition of "where a molecule belongs", shared
  // by the float field and the renderer, so they can never disagree.
  Game.prototype.eachSlot = function (L, fn) {
    var rows = this.state.rows;
    for (var ri = 0; ri < rows.length; ri++) {
      var row = rows[ri];
      var rowX = (L.totalW - L.sizes[ri].w) / 2, rowY = L.naturalY[ri];
      var contentH = L.sizes[ri].h - 2 * R.ROW_PAD;
      var cy = rowY + R.ROW_PAD + contentH / 2;
      var cursor = rowX + R.ROW_PAD;
      for (var mi = 0; mi < row.mols.length; mi++) {
        var entry = row.mols[mi], msz = R.measure(entry.m, 1);
        fn(entry, ri, mi, cursor + msz.w / 2, cy, msz, row);
        cursor += msz.w + R.MOL_GAP;
      }
    }
  };

  // The layout->screen transform (fit scale, and the centring of the board)
  // changes whenever the board does: dissolving a molecule widens its row, so
  // every row re-centres.  The float field works in layout space, so a molecule
  // that has not moved at all would still land on a different pixel — the whole
  // board would snap sideways the instant a bar was dissolved.
  //
  // So when the transform changes, re-express every particle in the new space
  // at the same screen position and the same screen size.  Nothing moves this
  // frame; the springs then carry everything to the new layout as usual.
  Game.prototype.rebase = function (L) {
    var v = this.view;
    if (v && (v.s !== L.s || v.ox !== L.ox || v.oy !== L.oy)) {
      var f = this.field, k = v.s / L.s;
      for (var id in f.p) {
        var p = f.p[id];
        p.x = (v.ox - L.ox + v.s * p.x) / L.s;
        p.y = (v.oy - L.oy + v.s * p.y) / L.s;
        p.vx *= k; p.vy *= k;      // same speed on screen, too
        p.sc *= k; p.vsc *= k;     // and the same size, which springs back to 1
      }
    }
    this.view = { s: L.s, ox: L.ox, oy: L.oy };
  };

  // Anchor every molecule to its ideal spot and forget the ones that have left
  // the board, so removed rows do not keep being simulated.
  Game.prototype.syncTargets = function () {
    var field = this.field, live = {};
    this.eachSlot(this.layout, function (entry, ri, mi, cx, cy) {
      field.aim(entry.id, cx, cy);
      live[entry.id] = 1;
    });
    field.retain(live);
  };

  // ----- drawing ------------------------------------------------------------
  Game.prototype.draw = function (t) {
    var ctx = this.ctx, c = this.canvas;
    var cssW = c.clientWidth, cssH = c.clientHeight;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    this.drawBackground(ctx, t, cssW, cssH); // screen-space, behind molecules

    var rows = this.state.rows;
    this.hits = [];
    this.centers = {};

    var L = this.layout || (this.layout = this.computeLayout());
    var tr = this.transform = { s: L.s, ox: L.ox + this.pan.x, oy: L.oy + this.pan.y };
    ctx.setTransform(this.dpr * L.s, 0, 0, this.dpr * L.s, this.dpr * tr.ox, this.dpr * tr.oy);

    // Per-row decoration: the birth fade-in, the annihilation dim (and which
    // two atoms the annihilation overlay has taken over), and the shake nudge.
    var fx = [];
    for (var ri = 0; ri < rows.length; ri++) {
      var row = rows[ri];
      var f = { birth: easeOut(Math.min(1, (t - row.birth) / 320)),
                ann: null, skip: {}, shakeX: 0 };
      var ann = this.animFor(row.id, 'annihilate');
      if (ann) {
        var ap = easeOut(Math.min(1, (t - ann.t0) / ann.dur));
        f.ann = 1 - ap * 0.85;
        f.skip[ann.idA] = true; f.skip[ann.idB] = true;
      }
      var sh = this.animFor(row.id, 'shake');
      if (sh) { var sp = (t - sh.t0) / sh.dur; f.shakeX = Math.sin(sp * Math.PI * 6) * 8 * (1 - sp); }
      fx.push(f);
    }

    // --- phase 1: read every molecule's live position out of the float field.
    // Done globally so a split's two halves — which land in different rows —
    // can still be joined by one fading connector bar.
    var placements = [], byId = {}, field = this.field;
    this.eachSlot(L, function (entry, ri2, mi, destCx, destCy, msz) {
      var d = fx[ri2];
      if (d.skip[entry.id]) return;
      var q = field.at(entry.id);
      // `carried` molecules continue one that was already on the board, so
      // they must not fade in again with their (brand new) row.
      var pl = { entry: entry, ri: ri2, mi: mi,
                 cx: q.x + d.shakeX, cy: q.y, rot: q.rot, scl: q.scale,
                 alpha: d.ann != null ? d.ann : (entry.carried ? 1 : d.birth),
                 msz: msz };
      placements.push(pl);
      byId[entry.id] = pl;
    });

    // --- phase 2: the bar joining a split's two halves (behind the atoms).
    // It spans their live positions, so it stretches as they drift apart and
    // dissolves rather than simply vanishing.
    for (var k = 0; k < this.anims.length; k++) {
      var ba = this.anims[k];
      if (ba.type !== 'bar') continue;
      var pa = byId[ba.idA], pb = byId[ba.idB];
      if (!pa || !pb) continue;
      var fade = 1 - Math.min(1, (t - ba.t0) / ba.dur);
      if (fade <= 0) continue;
      ctx.globalAlpha = fade;
      R.drawBar(ctx, pa.cx, pa.cy, pb.cx, pb.cy, ba.vertical, false, ba.width * pa.scl);
    }

    // --- phase 3: molecules (atoms drawn over the bars)
    for (k = 0; k < placements.length; k++) {
      var p3 = placements[k], e3 = p3.entry;
      ctx.globalAlpha = p3.alpha;
      var sz3 = p3.scl !== 1 ? R.measure(e3.m, p3.scl) : p3.msz;
      var box = { x: p3.cx - sz3.w / 2, y: p3.cy - sz3.h / 2, w: sz3.w, h: sz3.h };
      // Register hits even while a molecule is animating — its circular hitbox
      // is centred on the live position, so taps land on the moving molecule.
      ctx.save();
      ctx.translate(p3.cx, p3.cy); ctx.rotate(p3.rot); ctx.translate(-p3.cx, -p3.cy);
      R.drawMolecule(ctx, e3.m, box, true,
        { rowIndex: p3.ri, molIndex: p3.mi, molId: e3.id, alpha: p3.alpha,
          hover: this.hover, hits: this.hits, centers: this.centers }, p3.scl);
      ctx.restore();
    }

    // --- phase 4: annihilation overlays (the two atoms merging into a circle)
    ctx.globalAlpha = 1;
    for (k = 0; k < this.anims.length; k++) {
      if (this.anims[k].type === 'annihilate') this.drawAnnihilation(ctx, this.anims[k], t);
    }
  };

  // ----- moves --------------------------------------------------------------
  // None of these animate anything themselves.  They rewrite the board, hand
  // the molecules they create the motion of the ones they replace, and let the
  // float field carry everything to wherever the new layout puts it.  Moving a
  // molecule means moving what it is attracted to.

  // Remove a closed row; the survivors are pulled to their new spots.
  Game.prototype.closeRow = function (rowIndex) {
    E.annihilateRow(this.state, rowIndex);
  };

  // Right-click: delete a single molecule.  This is weakening — it can make a
  // level unwinnable — so it never declares a win.
  Game.prototype.deleteMolecule = function (rowIndex, molIndex) {
    if (!E.deleteMolecule(this.state, rowIndex, molIndex)) return;
    if (this.onChange) this.onChange(this.state);
  };

  // Put a newly created molecule exactly where its sub-formula already was, at
  // the size it was drawn and moving the way its parent was moving, so it
  // grows out of the parent rather than appearing beside it.
  Game.prototype.birth = function (entry, off, scale, src) {
    entry.carried = true;              // a continuation: it does not fade in
    if (!src) return;                  // no parent motion yet; it settles in
    this.field.spawn(entry.id,
      src.x + off.dx * src.scale, src.y + off.dy * src.scale,
      scale * src.scale, src.vx, src.vy);
  };

  Game.prototype.joinBar = function (idA, idB, off) {
    this.anims.push({ type: 'bar', t0: this.now(), dur: BAR_FADE, idA: idA, idB: idB,
                      vertical: off.barVertical, width: off.barWidth });
  };

  // Horizontal-bar split: the molecule's two halves are born at the sub-
  // positions they occupied inside it and drift apart within the row.
  Game.prototype.doDissolve = function (rowIndex, molIndex) {
    var row = this.state.rows[rowIndex];
    var parent = row.mols[molIndex];
    var off = R.childOffsets(parent.m);
    var src = this.field.state(parent.id);
    if (!off || !E.dissolveOr(this.state, rowIndex, molIndex)) return;
    var a = row.mols[molIndex], b = row.mols[molIndex + 1];
    this.birth(a, off.a, off.scale, src);
    this.birth(b, off.b, off.scale, src);
    this.joinBar(a.id, b.id, off);
    if (A()) A().pop();
  };

  // Vertical-bar split: the row is duplicated, so the engine reissues *every*
  // molecule in it with a fresh id.  Each copy inherits the motion of the one
  // it copies, so the two rows start superimposed and spring apart.
  Game.prototype.doSplit = function (rowIndex, molIndex) {
    var row = this.state.rows[rowIndex];
    var parent = row.mols[molIndex];
    var off = R.childOffsets(parent.m);
    if (!off) return;
    var field = this.field;
    var prev = row.mols.map(function (e) { return field.state(e.id); });
    if (!E.splitAnd(this.state, rowIndex, molIndex, this.now())) return;
    var top = this.state.rows[rowIndex], bot = this.state.rows[rowIndex + 1];
    for (var j = 0; j < top.mols.length; j++) {
      if (j === molIndex) {                       // the two halves of the ∧
        this.birth(top.mols[j], off.a, off.scale, prev[j]);
        this.birth(bot.mols[j], off.b, off.scale, prev[j]);
      } else {                                    // context: one copy per row
        field.carry(top.mols[j].id, prev[j]);
        field.carry(bot.mols[j].id, prev[j]);
        top.mols[j].carried = true;
        bot.mols[j].carried = true;
      }
    }
    this.joinBar(top.mols[molIndex].id, bot.mols[molIndex].id, off);
    if (A()) A().pop();
  };

  Game.prototype.drawAnnihilation = function (ctx, ann, t) {
    // The two opposing-wedge atoms rush together, swelling as they go; their
    // complementary wedges tile into a full circle once they coincide.  No
    // separate disc is ever drawn — the circle is purely the two halves
    // meeting.  Each stage is eased against the raw progress rather than
    // against an already-eased one, or the whole thing lands in the first
    // third and the rest of the animation is nothing but a fade.
    var raw = Math.min(1, (t - ann.t0) / ann.dur);
    var merge = easeOut(Math.min(1, raw / ANN_MEET));
    var grow = 1 + (ANN_GROW - 1) * easeOut(Math.min(1, raw / ANN_FULL));
    var mx = (ann.cA.cx + ann.cB.cx) / 2, my = (ann.cA.cy + ann.cB.cy) / 2;
    var ax = ann.cA.cx + (mx - ann.cA.cx) * merge, ay = ann.cA.cy + (my - ann.cA.cy) * merge;
    var bx = ann.cB.cx + (mx - ann.cB.cx) * merge, by = ann.cB.cy + (my - ann.cB.cy) * merge;
    var r = ann.cA.r * grow;

    var a = raw < ANN_FADE ? 1 : Math.max(0, 1 - (raw - ANN_FADE) / (1 - ANN_FADE));
    ctx.save();
    R.drawAtom(ctx, ax, ay, r, ann.cA.color, ann.cA.pol, { alpha: a });
    R.drawAtom(ctx, bx, by, r, ann.cB.color, ann.cB.pol, { alpha: a });
    ctx.restore();
  };

  root.Game = Game;
  root.MODE_LABEL = MODE_LABEL;
})(window.Wang = window.Wang || {});
