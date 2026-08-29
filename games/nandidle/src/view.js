// view.js — blueprint drawing primitives on a white-paper palette, plus the
// camera. Everything here is stateless except the Camera.

export const C = {
  paper: '#faf8f3',
  paperEdge: '#f2eee4',
  gridFine: '#e3e6ea',
  gridMajor: '#d2d8e0',
  ink: '#1b3350',
  inkSoft: '#5c748c',
  inkFaint: '#9aa9bb',
  fill: '#ffffff',
  accent: '#1f6f8b',
  good: '#2f6f4f',
  bad: '#a8372c',
  warn: '#9a6b1f',
  shade: 'rgba(27,51,80,0.06)',
};

export const MONO = '"IBM Plex Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

export class Camera {
  constructor() { this.x = 0; this.y = 0; this.z = 1; }
  toScreen(p, w, h) { return { x: (p.x - this.x) * this.z + w / 2, y: (p.y - this.y) * this.z + h / 2 }; }
  toWorld(p, w, h) { return { x: (p.x - w / 2) / this.z + this.x, y: (p.y - h / 2) / this.z + this.y }; }
  applyTo(ctx, w, h) {
    ctx.translate(w / 2, h / 2);
    ctx.scale(this.z, this.z);
    ctx.translate(-this.x, -this.y);
  }
  zoomAt(p, factor, w, h) {
    const before = this.toWorld(p, w, h);
    this.z = Math.max(0.15, Math.min(2.4, this.z * factor));
    const after = this.toWorld(p, w, h);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }
}

export function fitCanvas(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr; canvas.height = h * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h, dpr };
}

export function clear(ctx, w, h) {
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, w, h);
}

/** Blueprint grid in world space, drawn under the camera transform. */
export function grid(ctx, cam, w, h) {
  const tl = cam.toWorld({ x: 0, y: 0 }, w, h);
  const br = cam.toWorld({ x: w, y: h }, w, h);
  const step = 24;
  ctx.lineWidth = 1 / cam.z;
  for (let pass = 0; pass < 2; pass++) {
    const s = pass ? step * 5 : step;
    ctx.strokeStyle = pass ? C.gridMajor : C.gridFine;
    ctx.beginPath();
    for (let x = Math.floor(tl.x / s) * s; x < br.x; x += s) { ctx.moveTo(x, tl.y); ctx.lineTo(x, br.y); }
    for (let y = Math.floor(tl.y / s) * s; y < br.y; y += s) { ctx.moveTo(tl.x, y); ctx.lineTo(br.x, y); }
    ctx.stroke();
  }
}

/** Drawing-sheet border and title block, in screen space. */
export function sheet(ctx, w, h, title, subtitle, rev) {
  const m = 12;
  ctx.save();
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(m, m, w - m * 2, h - m * 2);
  ctx.lineWidth = 0.75;
  ctx.strokeRect(m + 5, m + 5, w - (m + 5) * 2, h - (m + 5) * 2);

  // tick marks along the border, like a drawing sheet
  ctx.strokeStyle = C.inkFaint;
  ctx.beginPath();
  for (let x = m + 40; x < w - m; x += 40) { ctx.moveTo(x, m); ctx.lineTo(x, m + 5); ctx.moveTo(x, h - m); ctx.lineTo(x, h - m - 5); }
  for (let y = m + 40; y < h - m; y += 40) { ctx.moveTo(m, y); ctx.lineTo(m + 5, y); ctx.moveTo(w - m, y); ctx.lineTo(w - m - 5, y); }
  ctx.stroke();

  const bw = 268, bh = 46;
  const bx = w - m - 5 - bw, by = h - m - 5 - bh;
  ctx.fillStyle = C.fill;
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, bw, bh);
  ctx.beginPath(); ctx.moveTo(bx, by + 20); ctx.lineTo(bx + bw, by + 20);
  ctx.moveTo(bx + bw - 62, by + 20); ctx.lineTo(bx + bw - 62, by + bh);
  ctx.stroke();
  label(ctx, title, bx + 8, by + 14, { size: 11, weight: 600, track: 1.4 });
  label(ctx, subtitle, bx + 8, by + 35, { size: 9.5, color: C.inkSoft, track: 1 });
  label(ctx, rev, bx + bw - 54, by + 35, { size: 9.5, color: C.inkSoft, track: 1 });
  ctx.restore();
}

export function label(ctx, text, x, y, o = {}) {
  const { size = 11, color = C.ink, weight = 400, align = 'left', track = 0 } = o;
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${MONO}`;
  ctx.textAlign = track ? 'left' : align;
  ctx.textBaseline = 'alphabetic';
  if (track) {
    const chars = [...text];
    const total = chars.reduce((s, c) => s + ctx.measureText(c).width + track, -track);
    let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    for (const c of chars) { ctx.fillText(c, cx, y); cx += ctx.measureText(c).width + track; }
  } else {
    ctx.fillText(text, x, y);
  }
  ctx.restore();
}

export function box(ctx, x, y, w, h, o = {}) {
  const { fill = C.fill, stroke = C.ink, lw = 1.4, dash = null } = o;
  ctx.save();
  if (dash) ctx.setLineDash(dash);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

/** Diagonal hatching, used for headers and disabled areas. */
export function hatch(ctx, x, y, w, h, color = C.shade, gap = 6) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.strokeStyle = color; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = -h; i < w; i += gap) { ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + h, y); }
  ctx.stroke();
  ctx.restore();
}

/** Orthogonal route between two ports, blueprint style. */
export function route(a, b) {
  if (b.x - a.x > 44) {
    const mx = (a.x + b.x) / 2;
    return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
  }
  const off = 30;
  const my = (a.y + b.y) / 2 + (Math.abs(b.y - a.y) < 8 ? 62 : 0);
  return [a, { x: a.x + off, y: a.y }, { x: a.x + off, y: my }, { x: b.x - off, y: my }, { x: b.x - off, y: b.y }, b];
}

export function polyline(ctx, pts, o = {}) {
  const { color = C.ink, lw = 1.4, dash = null, dashOffset = 0 } = o;
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = lw;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (dash) { ctx.setLineDash(dash); ctx.lineDashOffset = dashOffset; }
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.restore();
}

export function arrow(ctx, p, dir = 1, color = C.ink) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(p.x + 6 * dir, p.y);
  ctx.lineTo(p.x - 2 * dir, p.y - 4);
  ctx.lineTo(p.x - 2 * dir, p.y + 4);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

export function pin(ctx, x, y, o = {}) {
  const { color = C.ink, filled = false, r = 3.5 } = o;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - r, y - r, r * 2, r * 2);
  ctx.fillStyle = filled ? color : C.fill;
  ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

/** Buffer gauge: n of cap drawn as a segmented bar. */
export function gauge(ctx, x, y, w, h, n, cap, color = C.accent) {
  box(ctx, x, y, w, h, { lw: 0.9, stroke: C.inkFaint });
  const frac = Math.max(0, Math.min(1, n / cap));
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(x + 1, y + 1, (w - 2) * frac, h - 2);
  ctx.restore();
}

export function pointSegDist(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy || 1;
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  const dx = a.x + vx * t - p.x, dy = a.y + vy * t - p.y;
  return Math.hypot(dx, dy);
}

export function polyDist(p, pts) {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, pointSegDist(p, pts[i - 1], pts[i]));
  return d;
}
