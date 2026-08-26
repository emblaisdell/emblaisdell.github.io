/*
 * render.js — pure-ish canvas rendering & layout for molecules.
 *
 * Layout is recursive.  A molecule occupies a box; an 'or' lays its children
 * left|right joined by a horizontal bar, an 'and' lays them top/bottom joined
 * by a vertical bar.  Only the *root* connective of each molecule is
 * interactive (that is the connective a sequent rule may act on), so only the
 * root produces a hit region.
 */
(function (root) {
  'use strict';

  // Roomy metrics, used whenever the board has space for them.
  var BASE = {
    ATOM: 50,        // atom diameter
    BAR: 34,         // bar length (gap between joined sub-molecules)
    BAR_W: 8.4,      // bar thickness
    MOL_GAP: 46,     // gap between molecules in a row
    ROW_GAP: 40,     // gap between rows
    ROW_PAD: 10,     // inner vertical breathing room per row
    HIT_PAD: 8,      // how far an atom's hitbox reaches past the atom
    TOUCH_PAD: 5     // ...and how much further again for a fingertip
  };
  var ATOM, BAR, BAR_W, MOL_GAP, ROW_GAP, ROW_PAD, HIT_PAD, HIT_PAD_BASE;

  // A fingertip is a blunter instrument than a cursor, so it gets a little more
  // room around every atom.  Keyed off the pointer rather than the screen size:
  // what matters is what is doing the pointing, not how wide the window is, so
  // a touchscreen laptop gets the bigger targets and a narrow desktop window
  // does not.  Overridable for tests.
  var TOUCH = false;
  try {
    TOUCH = !!(root.matchMedia && root.matchMedia('(pointer: coarse)').matches);
  } catch (e) { TOUCH = false; }

  function setTouch(on) { TOUCH = !!on; setScale(CUR_K); }

  // Tighten the drawing metrics for a cramped board.  `k` runs from 1 (roomy)
  // down to about 0.5.  Spacing gives way much faster than the atoms do — a
  // gap carries no information, an atom is the thing you have to see and hit —
  // and the hit padding grows back as the art shrinks, so what you tap stays
  // tappable on a board that has tightened right up.  game.js picks `k`.
  var CUR_K = 1;
  function setScale(k) {
    CUR_K = k;
    ATOM    = BASE.ATOM * (0.55 + 0.45 * k);
    BAR     = BASE.BAR * k;
    MOL_GAP = BASE.MOL_GAP * k;
    ROW_GAP = BASE.ROW_GAP * k;
    ROW_PAD = BASE.ROW_PAD * k;
    BAR_W   = BASE.BAR_W * (0.6 + 0.4 * k);
    // Two pads: the real one, which a fingertip enlarges, and the base one the
    // layout is judged against.  If the layout were judged against the enlarged
    // pad, a touch device would simply compact less and the molecules you tap
    // would end up no bigger — the bonus has to sit on top of the same layout,
    // not licence a roomier one.
    HIT_PAD_BASE = BASE.HIT_PAD / Math.max(0.5, k);
    HIT_PAD = HIT_PAD_BASE + (TOUCH ? BASE.TOUCH_PAD / Math.max(0.5, k) : 0);
    var R = root.render;
    if (R) {
      R.ATOM = ATOM; R.BAR = BAR; R.BAR_W = BAR_W;
      R.MOL_GAP = MOL_GAP; R.ROW_GAP = ROW_GAP; R.ROW_PAD = ROW_PAD;
      R.HIT_PAD = HIT_PAD; R.HIT_PAD_BASE = HIT_PAD_BASE;
    }
  }
  setScale(1);

  var COLOR_HEX = ['#e84b40', '#37c46b', '#4488ee'];   // red green blue
  var COLOR_DIM = ['#7a2a26', '#1f6e3f', '#274d80'];
  var BAR_COLOR = '#9fb7d8';                            // shared bar colour

  var SHRINK = 0.78;   // each level deeper is drawn this much smaller
  var MIN_SCALE = 0.4; // floor so deep subformulas don't vanish

  function childScale(scale) { return Math.max(scale * SHRINK, MIN_SCALE); }

  // ----- measurement --------------------------------------------------------
  // `scale` shrinks with formula depth, so nested parts are drawn smaller and
  // the actionable top-level structure reads largest.
  function measure(m, scale) {
    scale = scale || 1;
    if (m.t === 'lit') return { w: ATOM * scale, h: ATOM * scale };
    var cs = childScale(scale);
    var a = measure(m.a, cs), b = measure(m.b, cs);
    if (m.t === 'or') return { w: a.w + BAR * scale + b.w, h: Math.max(a.h, b.h) };
    return { w: Math.max(a.w, b.w), h: a.h + BAR * scale + b.h }; // and
  }

  function rowSize(row) {
    var w = 0, h = 0;
    for (var i = 0; i < row.mols.length; i++) {
      var s = measure(row.mols[i].m);
      w += s.w;
      if (i > 0) w += MOL_GAP;
      if (s.h > h) h = s.h;
    }
    return { w: w + ROW_PAD * 2, h: h + ROW_PAD * 2 };
  }

  // Where a connective's two children sit relative to the *parent's* centre,
  // at the parent's own scale, plus the bar that joins them.  A split births
  // its halves at these offsets, so each one grows out of exactly the
  // sub-position it already occupied inside the molecule.
  function childOffsets(m) {
    if (m.t === 'lit') return null;
    var sz = measure(m, 1), cs = childScale(1), gap = BAR;
    if (m.t === 'or') {
      var aw = measure(m.a, cs).w;
      return { a: { dx: (aw - sz.w) / 2, dy: 0 },
               b: { dx: (aw + gap) / 2, dy: 0 },
               scale: cs, barVertical: false, barWidth: BAR_W };
    }
    var ah = measure(m.a, cs).h;
    return { a: { dx: 0, dy: (ah - sz.h) / 2 },
             b: { dx: 0, dy: (ah + gap) / 2 },
             scale: cs, barVertical: true, barWidth: BAR_W };
  }

  // ----- atom: two opposing quarter-wedges (a colored "bowtie") ------------
  // Positive literal -> East+West wedges (horizontal bowtie).
  // Negative literal -> North+South wedges (vertical bowtie) == a 90deg turn.
  // A literal and its negation overlaid fill the whole disc.
  var Q = Math.PI / 4;

  // The angle pairs of the two wedges an atom is made of.  One definition,
  // used both to fill the atom and to trace its outline, so the highlight can
  // never drift from the shape it is highlighting.
  function wedges(pol) {
    return pol ? [[-Q, Q], [Math.PI - Q, Math.PI + Q]]              // E + W
               : [[Q, Math.PI - Q], [Math.PI + Q, 2 * Math.PI - Q]]; // S + N
  }

  function wedgePath(ctx, cx, cy, r, a0, a1) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a0, a1);
    ctx.closePath();
  }

  var HALF = Math.PI / 2;
  var HL_GAP = 4;   // clearance between an atom and its highlight outline

  // Where the offsets of two adjacent edges meet, given the edges' outward
  // normals: the point that is `gap` clear of both.
  function notch(cx, cy, m1, m2, gap) {
    var k = gap / (1 + Math.cos(m1 - m2));
    return { x: cx + k * (Math.cos(m1) + Math.cos(m2)),
             y: cy + k * (Math.sin(m1) + Math.sin(m2)) };
  }

  // Trace an atom's bowtie pushed outward by `gap` at every point: the arcs
  // swell to r+gap, each straight edge slides out along its own normal, the
  // corners where they meet round off, and the two wedges' offsets close up in
  // a notch either side of the centre.  Stroking the wedges themselves would
  // only move the arc — their straight edges would lie flat on the shape — so
  // the outline is built as a genuine offset instead.
  function atomOutlinePath(ctx, cx, cy, r, pol, gap) {
    var ws = wedges(pol), n = ws.length;
    var start = notch(cx, cy, ws[n - 1][1] + HALF, ws[0][0] - HALF, gap);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    for (var k = 0; k < n; k++) {
      var a0 = ws[k][0], a1 = ws[k][1], n0 = a0 - HALF, n1 = a1 + HALF;
      var p0x = cx + r * Math.cos(a0), p0y = cy + r * Math.sin(a0);
      var p1x = cx + r * Math.cos(a1), p1y = cy + r * Math.sin(a1);
      ctx.lineTo(p0x + gap * Math.cos(n0), p0y + gap * Math.sin(n0));
      ctx.arc(p0x, p0y, gap, n0, a0);     // corner where the edge meets the arc
      ctx.arc(cx, cy, r + gap, a0, a1);   // the outer arc
      ctx.arc(p1x, p1y, gap, a1, n1);     // the corner at the far end
      var nx = notch(cx, cy, n1, ws[(k + 1) % n][0] - HALF, gap);
      ctx.lineTo(nx.x, nx.y);             // in to the notch between the wedges
    }
    ctx.closePath();
  }
  function drawAtom(ctx, cx, cy, r, color, pol, opts) {
    opts = opts || {};
    var alpha = opts.alpha == null ? 1 : opts.alpha;
    ctx.save();
    ctx.globalAlpha = alpha;

    // An atom is two opposing quarter-wedges.  A literal and its negation
    // (same colour, opposite polarity) have complementary wedges, so when they
    // are brought to the same centre they tile into a full circle on their own
    // — no separate disc is ever drawn.
    var ws = wedges(pol), i;
    ctx.fillStyle = COLOR_HEX[color];
    for (i = 0; i < ws.length; i++) {
      wedgePath(ctx, cx, cy, r, ws[i][0], ws[i][1]);
      ctx.fill();
    }

    // The highlight follows the bowtie, not the circle it is cut from — a full
    // ring would outline empty space — and keeps the same gap all the way
    // around rather than only along the arcs.
    if (opts.highlight) {
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      atomOutlinePath(ctx, cx, cy, r, pol, HL_GAP);
      ctx.stroke();
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBar(ctx, x0, y0, x1, y1, vertical, highlight, width) {
    width = width || BAR_W;
    ctx.save();
    var x = Math.min(x0, x1) - (vertical ? width / 2 : 0);
    var y = Math.min(y0, y1) - (vertical ? 0 : width / 2);
    var w = vertical ? width : Math.abs(x1 - x0);
    var h = vertical ? Math.abs(y1 - y0) : width;
    roundRect(ctx, x, y, w, h, width / 2);
    ctx.fillStyle = BAR_COLOR; // both ∨ and ∧ bars share one colour
    ctx.fill();
    if (highlight) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();
    }
    ctx.restore();
  }

  // Recursively position a molecule within `box`, collecting bars and atoms
  // into info.bars / info.atoms (so we can paint all bars first, then atoms on
  // top).  Returns the molecule's *anchor* — the point a parent bar connects
  // to: a leaf's atom centre, or a connective's bar midpoint.  Bars run anchor
  // to anchor, so they continue all the way into the centre of the atoms (or
  // the centre of the nested bar) they join.
  function place(m, box, isRoot, info, scale) {
    scale = scale || 1;
    var sz = measure(m, scale);
    var x = box.x + (box.w - sz.w) / 2;
    var y = box.y + (box.h - sz.h) / 2;
    var hov = info.hover;
    var rootMatch = isRoot && hov && hov.rowIndex === info.rowIndex && hov.molId === info.molId;

    if (m.t === 'lit') {
      var d = ATOM * scale;
      var cx = x + d / 2, cy = y + d / 2, r = d / 2 - 4 * scale;
      info.atoms.push({ cx: cx, cy: cy, r: r, color: m.color, pol: m.pol,
                        highlight: rootMatch && hov.kind === 'lit' });
      if (isRoot) {
        info.centers[info.molId] = { cx: cx, cy: cy, r: r, color: m.color, pol: m.pol };
        // hitbox = a circle a little larger than the atom, for easier tapping
        info.hits.push({ kind: 'lit', rowIndex: info.rowIndex, molIndex: info.molIndex,
                         molId: info.molId, cx: cx, cy: cy, hr: d / 2 + HIT_PAD });
      }
      return { ax: cx, ay: cy };
    }

    var cs = childScale(scale), bw = BAR_W * scale;

    if (m.t === 'or') {
      var a = measure(m.a, cs), gap = BAR * scale;
      var aL = place(m.a, { x: x, y: y, w: a.w, h: sz.h }, false, info, cs);
      var aR = place(m.b, { x: x + a.w + gap, y: y, w: sz.w - a.w - gap, h: sz.h }, false, info, cs);
      var barY = y + sz.h / 2; // == aL.ay == aR.ay (children are centred)
      info.bars.push({ vertical: false, x0: aL.ax, y0: barY, x1: aR.ax, y1: barY,
                       width: bw, highlight: rootMatch && hov.kind === 'or' });
      if (isRoot) {
        // hitbox = the circle containing the whole molecule's bounding box
        info.hits.push({ kind: 'or', rowIndex: info.rowIndex, molIndex: info.molIndex,
                         molId: info.molId, cx: x + sz.w / 2, cy: y + sz.h / 2,
                         hr: 0.5 * Math.sqrt(sz.w * sz.w + sz.h * sz.h) });
      }
      return { ax: (aL.ax + aR.ax) / 2, ay: barY };
    }

    // and
    var t = measure(m.a, cs), vgap = BAR * scale;
    var aT = place(m.a, { x: x, y: y, w: sz.w, h: t.h }, false, info, cs);
    var aB = place(m.b, { x: x, y: y + t.h + vgap, w: sz.w, h: sz.h - t.h - vgap }, false, info, cs);
    var barX = x + sz.w / 2; // == aT.ax == aB.ax (children are centred)
    info.bars.push({ vertical: true, x0: barX, y0: aT.ay, x1: barX, y1: aB.ay,
                     width: bw, highlight: rootMatch && hov.kind === 'and' });
    if (isRoot) {
      // hitbox = the circle containing the whole molecule's bounding box
      info.hits.push({ kind: 'and', rowIndex: info.rowIndex, molIndex: info.molIndex,
                       molId: info.molId, cx: x + sz.w / 2, cy: y + sz.h / 2,
                       hr: 0.5 * Math.sqrt(sz.w * sz.w + sz.h * sz.h) });
    }
    return { ax: barX, ay: (aT.ay + aB.ay) / 2 };
  }

  // Draw one molecule: place it, then paint bars (behind) and atoms (on top)
  // so each bar visibly tucks into the centre of the element it connects.
  function drawMolecule(ctx, m, box, isRoot, info, scale) {
    var bars = [], atoms = [];
    var local = {
      rowIndex: info.rowIndex, molIndex: info.molIndex, molId: info.molId,
      alpha: info.alpha, hover: info.hover, hits: info.hits, centers: info.centers,
      bars: bars, atoms: atoms
    };
    place(m, box, isRoot, local, scale || 1);
    var i, b, a;
    for (i = 0; i < bars.length; i++) {
      b = bars[i];
      drawBar(ctx, b.x0, b.y0, b.x1, b.y1, b.vertical, b.highlight, b.width);
    }
    for (i = 0; i < atoms.length; i++) {
      a = atoms[i];
      drawAtom(ctx, a.cx, a.cy, a.r, a.color, a.pol, { alpha: info.alpha, highlight: a.highlight });
    }
  }

  root.render = {
    ATOM: ATOM, BAR: BAR, BAR_W: BAR_W, MOL_GAP: MOL_GAP, ROW_GAP: ROW_GAP, ROW_PAD: ROW_PAD,
    HIT_PAD: HIT_PAD, HIT_PAD_BASE: HIT_PAD_BASE,
    BASE: BASE, setScale: setScale, setTouch: setTouch,
    COLOR_HEX: COLOR_HEX, COLOR_DIM: COLOR_DIM,
    measure: measure, rowSize: rowSize, childScale: childScale,
    childOffsets: childOffsets,
    drawAtom: drawAtom, drawBar: drawBar, roundRect: roundRect,
    drawMolecule: drawMolecule
  };
})(window.Wang = window.Wang || {});
