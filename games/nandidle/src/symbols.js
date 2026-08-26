// symbols.js — distinctive-shape logic symbols, defined once as SVG path data
// and rendered both to the DOM (inline <svg>) and to canvas (via Path2D), so
// the bench and the panels can never drift apart.
//
// All geometry lives in a 110 x 64 viewBox. `inX`/`outX` are where input and
// output leads meet the body, so callers can draw leads out to their own pins.

export const VB = { w: 110, h: 64 };

const AND_BODY = 'M12,6 H52 A26,26 0 0 1 52,58 H12 Z';
const OR_BODY = 'M8,6 Q30,32 8,58 Q52,58 80,32 Q52,6 8,6 Z';
const XOR_BODY = 'M16,6 Q38,32 16,58 Q60,58 88,32 Q60,6 16,6 Z';
const XOR_ARC = 'M6,6 Q28,32 6,58';

const SPECS = {
  and: { body: AND_BODY, inX: 12, outX: 78 },
  nand: { body: AND_BODY, bubble: [84, 32, 6], inX: 12, outX: 90 },
  or: { body: OR_BODY, inX: 18, outX: 80 },
  nor: { body: OR_BODY, bubble: [86, 32, 6], inX: 18, outX: 92 },
  xor: { body: XOR_BODY, arc: XOR_ARC, inX: 26, outX: 88 },
  xnor: { body: XOR_BODY, arc: XOR_ARC, bubble: [94, 32, 6], inX: 26, outX: 100 },
  not: { body: 'M18,6 L74,32 L18,58 Z', bubble: [80, 32, 6], inX: 18, outX: 86 },
  buffer: { body: 'M18,6 L78,32 L18,58 Z', inX: 18, outX: 78 },
  mux: { body: 'M26,6 L74,18 L74,46 L26,58 Z', inX: 26, outX: 74, text: 'MUX' },
  box: { body: 'M18,6 H86 V58 H18 Z', inX: 18, outX: 86 },
  // a block with a clock notch: the drafting shorthand for something that
  // only acts on an edge
  ff: { body: 'M18,6 H86 V58 H18 Z', arc: 'M18,26 L30,32 L18,38', inX: 18, outX: 86 },
};

export function spec(kind) { return SPECS[kind] || SPECS.box; }
export function isKnownSymbol(kind) { return Object.hasOwn(SPECS, kind) && kind !== 'box'; }

/** Radius of an inversion bubble drawn on an input lead. */
export const IN_BUBBLE_R = 5;

/** Y positions, in viewBox units, where n input leads meet the body. */
export function leadYs(n) {
  const top = 12, bottom = 52;
  if (n <= 1) return [32];
  const step = (bottom - top) / (n - 1);
  return Array.from({ length: n }, (_, i) => top + i * step);
}

function labelFor(kind, label) {
  const s = spec(kind);
  return s.text || label || '';
}

// --- DOM ---------------------------------------------------------------------

/** Inline SVG markup for a panel or list row. */
export function symbolSvg(kind, { label = '', inputs = 2, width = 38, leads = true, cls = 'sym', bubbles = [] } = {}) {
  const s = spec(kind);
  const text = labelFor(kind, label);
  const height = Math.round((width * VB.h) / VB.w);
  const parts = [`<path d="${s.body}"/>`];
  if (s.arc) parts.push(`<path d="${s.arc}"/>`);
  if (s.bubble) parts.push(`<circle cx="${s.bubble[0]}" cy="${s.bubble[1]}" r="${s.bubble[2]}"/>`);
  if (leads) {
    leadYs(inputs).forEach((y, i) => {
      // An inverted input is drawn the way a drawing draws it: a bubble sitting
      // against the body on that lead.
      if (bubbles.includes(i)) {
        const cx = s.inX - IN_BUBBLE_R - 1;
        parts.push(`<circle cx="${cx}" cy="${y}" r="${IN_BUBBLE_R}"/>`);
        parts.push(`<path d="M0,${y} H${cx - IN_BUBBLE_R}"/>`);
        parts.push(`<path d="M${cx + IN_BUBBLE_R},${y} H${s.inX + 2}"/>`);
      } else {
        parts.push(`<path d="M0,${y} H${s.inX + 2}"/>`);
      }
    });
    parts.push(`<path d="M${s.outX},32 H${VB.w}"/>`);
  }
  const size = text.length > 3 ? 15 : 20;
  const caption = text
    ? `<text x="52" y="32" text-anchor="middle" dominant-baseline="central"
         font-size="${size}" font-family="inherit" stroke="none" fill="currentColor">${text}</text>`
    : '';
  return `<svg class="${cls}" viewBox="0 0 ${VB.w} ${VB.h}" width="${width}" height="${height}" aria-hidden="true"
    ><g fill="none" stroke="currentColor" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"
      >${parts.join('')}</g>${caption}</svg>`;
}

// --- canvas ------------------------------------------------------------------

/**
 * Draw a symbol into a box. The body stretches with the box (schematics do the
 * same for extra inputs) but bubbles stay circular and strokes stay even.
 * Returns where leads should attach, in canvas coordinates.
 */
export function drawSymbol(ctx, kind, box, o = {}) {
  const { color = '#1b3350', fill = '#ffffff', lw = 1.6, label = '', font = 'monospace', bubbles = [], inputs = 0 } = o;
  const s = spec(kind);
  const sx = box.w / VB.w;
  const sy = box.h / VB.h;
  const m = new DOMMatrix([sx, 0, 0, sy, box.x, box.y]);
  const at = (x, y) => ({ x: box.x + x * sx, y: box.y + y * sy });

  const body = new Path2D();
  body.addPath(new Path2D(s.body), m);
  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.fill(body);
  ctx.stroke(body);
  if (s.arc) {
    const arc = new Path2D();
    arc.addPath(new Path2D(s.arc), m);
    ctx.stroke(arc);
  }
  if (s.bubble) {
    const c = at(s.bubble[0], s.bubble[1]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, s.bubble[2] * sx, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.stroke();
  }
  if (bubbles.length && inputs) {
    const r = IN_BUBBLE_R * sx;
    leadYs(inputs).forEach((y, i) => {
      if (!bubbles.includes(i)) return;
      const c = at(s.inX - IN_BUBBLE_R - 1, y);
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.stroke();
    });
  }
  const text = labelFor(kind, label);
  if (text) {
    const size = Math.max(7, Math.min(13, (text.length > 3 ? 15 : 20) * sy));
    ctx.fillStyle = color;
    ctx.font = `600 ${size}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const c = at(52, 32);
    ctx.fillText(text, c.x, c.y);
  }
  ctx.restore();

  return {
    bubbleX: box.x + (s.inX - IN_BUBBLE_R * 2 - 1) * sx,
    inX: box.x + s.inX * sx,
    outX: box.x + s.outX * sx,
    leadYs: (n) => leadYs(n).map((y) => box.y + y * sy),
  };
}
