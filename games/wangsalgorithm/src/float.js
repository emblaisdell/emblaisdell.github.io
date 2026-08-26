/*
 * float.js — the molecule float field.
 *
 * Every molecule has a perfect layout position in mind.  It never snaps to it:
 * it is a mass on a spring anchored there.  Per molecule, each step:
 *
 *     a  =  K * (target - pos)     attraction toward the ideal spot
 *        -  DRAG * vel             viscous drag
 *        +  jiggle                 a constantly-changing random nudge
 *
 * That one rule covers both behaviours the board needs.  At rest the jiggle
 * keeps a molecule wandering gently around its anchor; when a move rewrites
 * the layout the anchor jumps and the same spring carries the molecule to its
 * new home.  There is no separate "travel" animation to keep in sync — moving
 * a molecule means moving what it is attracted to.
 *
 * The jiggle is a random force that *wanders* (Ornstein-Uhlenbeck) rather than
 * fresh white noise each step.  White noise on a spring reads as a buzz at the
 * spring's natural frequency; a slowly-drifting force reads as liquid.  Raise
 * JIG for a livelier board, lower JIG_TAU to make it more nervous.
 *
 * Integration is a fixed timestep, so the motion is identical at 60Hz, 120Hz
 * or through a frame hitch — a variable dt makes a stiff spring explode.
 */
(function (root) {
  'use strict';

  // --- tuning ---------------------------------------------------------------
  // Stiffness sets how urgently a molecule chases its spot; drag is set from it
  // to hold a damping ratio near 0.83 — just shy of critical, so a molecule
  // arrives with one soft settle instead of either snapping or ringing.
  var K       = 16;    // spring stiffness toward the target      (1/s^2)
  var DRAG    = 6.6;   // drag on velocity (zeta ~ 0.83)          (1/s)
  var JIG     = 47;    // jiggle force intensity                  (px/s^2)
  var JIG_TAU = 0.85;  // how long a jiggle force persists        (s)

  // Rotation gets the same treatment, anchored at zero.  Kept deliberately
  // small: a couple of degrees reads as buoyancy, more reads as broken.
  var R_K = 13, R_DRAG = 6, R_JIG = 0.18, R_TAU = 1.1;

  // Scale is sprung too (a split's halves grow into place) but never jiggles —
  // molecules breathe positionally, not in size.
  var S_K = 20, S_DRAG = 8.2;

  var STEP   = 1 / 120;  // fixed physics step (s)
  var MAX_DT = 0.1;      // discard hitches longer than this (tab was hidden)
  var MAX_STEPS = 40;    // hard guard against a runaway accumulator

  // Unit-variance noise: three uniforms is smooth enough and much cheaper
  // than Box-Muller, which we would be calling six times per molecule per step.
  function gauss() {
    return (Math.random() + Math.random() + Math.random() - 1.5) * 2;
  }

  function Field() {
    this.p = {};      // molecule id -> particle
    this.acc = 0;     // leftover time owed to the fixed step
  }

  function make(x, y, scale) {
    return {
      x: x, y: y, vx: 0, vy: 0,       // position / velocity
      tx: x, ty: y,                   // the perfect spot it is drawn toward
      rot: 0, vrot: 0,
      sc: scale, vsc: 0, tsc: 1,      // scale spring (target is always full size)
      jx: 0, jy: 0, jr: 0             // wandering jiggle force
    };
  }

  // Point a molecule at its ideal spot.  A molecule seen for the first time
  // starts settled there, so a freshly dealt board is calm rather than flying
  // in from nowhere; use spawn() when it should arrive from somewhere.
  Field.prototype.aim = function (id, x, y) {
    var p = this.p[id];
    if (!p) { this.p[id] = make(x, y, 1); return; }
    p.tx = x; p.ty = y;
  };

  // Introduce a molecule at a specific place (and size) with a starting
  // velocity — how a split's halves are born out of their parent.
  Field.prototype.spawn = function (id, x, y, scale, vx, vy) {
    var p = make(x, y, scale == null ? 1 : scale);
    p.vx = vx || 0; p.vy = vy || 0;
    this.p[id] = p;
  };

  // Hand a molecule's motion to a new id.  The engine mints fresh ids for every
  // molecule in a row it rewrites, so without this a move would strand the
  // particle and the molecule would pop instead of flowing.
  Field.prototype.carry = function (id, src) {
    if (!src) return;
    var p = make(src.x, src.y, src.scale);
    p.vx = src.vx; p.vy = src.vy;
    p.rot = src.rot; p.vrot = src.vrot;
    p.jx = src.jx; p.jy = src.jy; p.jr = src.jr;
    this.p[id] = p;
  };

  // A copy of a molecule's live motion, for handing to carry()/spawn().
  Field.prototype.state = function (id) {
    var p = this.p[id];
    if (!p) return null;
    return { x: p.x, y: p.y, vx: p.vx, vy: p.vy, rot: p.rot, vrot: p.vrot,
             scale: p.sc, jx: p.jx, jy: p.jy, jr: p.jr };
  };

  // Where to draw it right now.
  Field.prototype.at = function (id) {
    var p = this.p[id];
    if (!p) return { x: 0, y: 0, rot: 0, scale: 1 };
    return { x: p.x, y: p.y, rot: p.rot, scale: p.sc };
  };

  Field.prototype.has = function (id) { return !!this.p[id]; };

  // Forget every molecule not in `live` (a set of ids), so removed rows do not
  // leak particles.
  Field.prototype.retain = function (live) {
    for (var id in this.p) if (!live[id]) delete this.p[id];
  };

  Field.prototype.clear = function () { this.p = {}; this.acc = 0; };

  Field.prototype.advance = function (dt) {
    if (!(dt > 0)) return;
    this.acc += Math.min(dt, MAX_DT);
    var n = 0;
    while (this.acc >= STEP && n++ < MAX_STEPS) { this.step(STEP); this.acc -= STEP; }
    if (n >= MAX_STEPS) this.acc = 0;
  };

  Field.prototype.step = function (h) {
    // Jiggle force decays toward zero and is re-kicked each step; the sqrt
    // keeps its steady-state strength independent of the step size.
    var decay = h / JIG_TAU, kick = JIG * Math.sqrt(2 * h / JIG_TAU);
    var rDecay = h / R_TAU, rKick = R_JIG * Math.sqrt(2 * h / R_TAU);

    for (var id in this.p) {
      var p = this.p[id];

      p.jx += -p.jx * decay + kick * gauss();
      p.jy += -p.jy * decay + kick * gauss();
      p.jr += -p.jr * rDecay + rKick * gauss();

      p.vx += (K * (p.tx - p.x) - DRAG * p.vx + p.jx) * h;
      p.vy += (K * (p.ty - p.y) - DRAG * p.vy + p.jy) * h;
      p.x += p.vx * h;
      p.y += p.vy * h;

      p.vrot += (-R_K * p.rot - R_DRAG * p.vrot + p.jr) * h;
      p.rot += p.vrot * h;

      p.vsc += (S_K * (p.tsc - p.sc) - S_DRAG * p.vsc) * h;
      p.sc += p.vsc * h;
    }
  };

  root.float = {
    Field: Field,
    STEP: STEP,
    tuning: { K: K, DRAG: DRAG, JIG: JIG, JIG_TAU: JIG_TAU }
  };
})(window.Wang = window.Wang || {});
