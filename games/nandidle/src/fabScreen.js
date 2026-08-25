// fabScreen.js — the fab floor: place subfabs, wire them, watch circuits flow.

import * as V from './view.js';
import { C } from './view.js';
import {
  BAL, typeOf, nodeById, placeSubfab, removeNode, addLink, removeLink, linkError,
} from './state.js';

const SNAP = 8;
const PIN_HIT = 9;

export function nodeGeom(s, n) {
  if (n.kind === 'source') return { w: 176, h: 66, ins: [], out: { x: n.x + 176, y: n.y + 33 } };
  if (n.kind === 'client') return { w: 200, h: n.lastError ? 106 : 92, ins: [{ x: n.x, y: n.y + 46, port: 0 }], out: null };
  const rows = Math.max(1, n.ins.length);
  const h = 24 + rows * 20 + 30;
  return {
    w: 184, h,
    ins: n.ins.map((_, i) => ({ x: n.x, y: n.y + 24 + 12 + i * 20, port: i })),
    out: { x: n.x + 184, y: n.y + h / 2 },
  };
}

export function linkPoints(s, l) {
  const from = nodeById(s, l.from); const to = nodeById(s, l.to);
  if (!from || !to) return null;
  const a = nodeGeom(s, from).out;
  const gb = nodeGeom(s, to);
  const b = gb.ins[l.port] || gb.ins[0];
  if (!a || !b) return null;
  return V.route(a, b);
}

export function createFabScreen(canvas, ctxGet) {
  const cam = new V.Camera();
  const ui = {
    mode: 'idle', placing: null, sel: null, hover: null,
    drag: null, mouse: { x: 0, y: 0 }, world: { x: 0, y: 0 }, toast: null, toastT: 0,
  };

  const S = () => ctxGet().state;
  const toast = (msg, kind = 'bad') => { ui.toast = { msg, kind }; ui.toastT = 2600; };

  function hitPin(s, w) {
    for (const n of s.nodes) {
      const g = nodeGeom(s, n);
      if (g.out && Math.hypot(g.out.x - w.x, g.out.y - w.y) < PIN_HIT) return { node: n, kind: 'out' };
      for (const p of g.ins) if (Math.hypot(p.x - w.x, p.y - w.y) < PIN_HIT) return { node: n, kind: 'in', port: p.port };
    }
    return null;
  }
  function hitNode(s, w) {
    for (let i = s.nodes.length - 1; i >= 0; i--) {
      const n = s.nodes[i]; const g = nodeGeom(s, n);
      if (w.x >= n.x && w.x <= n.x + g.w && w.y >= n.y && w.y <= n.y + g.h) return n;
    }
    return null;
  }
  function hitLink(s, w) {
    for (const l of s.links) {
      const pts = linkPoints(s, l);
      if (pts && V.polyDist(w, pts) < 6) return l;
    }
    return null;
  }

  function screenPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function worldPos(e) {
    const r = canvas.getBoundingClientRect();
    return cam.toWorld(screenPos(e), r.width, r.height);
  }

  canvas.addEventListener('pointerdown', (e) => {
    const s = S(); const w = worldPos(e);
    canvas.setPointerCapture(e.pointerId);
    ui.sel = null;
    if (e.button === 2) {
      const n = hitNode(s, w); const l = !n && hitLink(s, w);
      if (n) { if (!removeNode(s, n.id)) toast(n.kind === 'source' ? 'The source is fixed in place.' : 'Clients cannot be dismissed.'); }
      else if (l) removeLink(s, l.id);
      return;
    }
    if (ui.placing) {
      const t = typeOf(s, ui.placing);
      const r = placeSubfab(s, ui.placing, Math.round((w.x - 92) / SNAP) * SNAP, Math.round((w.y - 40) / SNAP) * SNAP);
      if (!r.ok) { toast(r.error); ui.placing = null; }
      else { ui.sel = { kind: 'node', id: r.node.id }; if (!e.shiftKey) ui.placing = null; if (s.cash < t.cost) ui.placing = null; }
      return;
    }
    const p = hitPin(s, w);
    if (p) {
      if (p.kind === 'out') { ui.mode = 'link'; ui.drag = { from: p.node.id, to: w }; }
      else {
        const existing = s.links.find((l) => l.to === p.node.id && l.port === p.port);
        if (existing) { removeLink(s, existing.id); toast('Line removed.', 'warn'); }
      }
      return;
    }
    const n = hitNode(s, w);
    if (n) {
      ui.sel = { kind: 'node', id: n.id };
      ui.mode = 'move';
      ui.drag = { id: n.id, dx: w.x - n.x, dy: w.y - n.y };
      return;
    }
    const l = hitLink(s, w);
    if (l) { ui.sel = { kind: 'link', id: l.id }; return; }
    ui.mode = 'pan';
    ui.drag = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y };
  });

  canvas.addEventListener('pointermove', (e) => {
    const s = S();
    ui.mouse = screenPos(e);
    ui.world = worldPos(e);
    if (ui.mode === 'pan') {
      cam.x = ui.drag.cx - (e.clientX - ui.drag.sx) / cam.z;
      cam.y = ui.drag.cy - (e.clientY - ui.drag.sy) / cam.z;
    } else if (ui.mode === 'move') {
      const n = nodeById(s, ui.drag.id);
      if (n) { n.x = Math.round((ui.world.x - ui.drag.dx) / SNAP) * SNAP; n.y = Math.round((ui.world.y - ui.drag.dy) / SNAP) * SNAP; }
    } else if (ui.mode === 'link') {
      ui.drag.to = ui.world;
      const p = hitPin(s, ui.world);
      ui.drag.target = p && p.kind === 'in' ? p : null;
    }
    if (ui.mode === 'idle' || ui.mode === 'move') {
      const n = hitNode(s, ui.world);
      ui.hover = n ? n.id : null;
    } else {
      ui.hover = null;
    }
  });

  const finish = (e) => {
    const s = S();
    if (ui.mode === 'link') {
      const w = worldPos(e);
      const p = hitPin(s, w);
      if (p && p.kind === 'in') {
        const r = addLink(s, ui.drag.from, p.node.id, p.port);
        if (!r.ok) toast(r.error);
      } else {
        const n = hitNode(s, w);
        if (n && n.kind === 'client') {
          const r = addLink(s, ui.drag.from, n.id, 0);
          if (!r.ok) toast(r.error);
        }
      }
    }
    ui.mode = 'idle'; ui.drag = null;
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', () => { ui.mode = 'idle'; ui.drag = null; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    cam.zoomAt(screenPos(e), e.deltaY < 0 ? 1.12 : 1 / 1.12, r.width, r.height);
  }, { passive: false });

  function onKey(e) {
    const s = S();
    if (e.key === 'Escape') { ui.placing = null; ui.sel = null; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && ui.sel) {
      if (ui.sel.kind === 'link') removeLink(s, ui.sel.id);
      else if (!removeNode(s, ui.sel.id)) toast('That node cannot be removed.');
      ui.sel = null;
    }
  }

  function render(dt) {
    const { ctx, w, h } = V.fitCanvas(canvas);
    const s = S();
    if (ui.toastT > 0) ui.toastT -= dt;
    V.clear(ctx, w, h);
    ctx.save();
    cam.applyTo(ctx, w, h);
    V.grid(ctx, cam, w, h);

    const view = {
      x0: cam.toWorld({ x: 0, y: 0 }, w, h).x - 60, y0: cam.toWorld({ x: 0, y: 0 }, w, h).y - 60,
      x1: cam.toWorld({ x: w, y: h }, w, h).x + 60, y1: cam.toWorld({ x: w, y: h }, w, h).y + 60,
    };
    const visible = (x, y, bw, bh) => x + bw > view.x0 && x < view.x1 && y + bh > view.y0 && y < view.y1;

    for (const l of s.links) {
      const pts = linkPoints(s, l);
      if (!pts) continue;
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const bx = Math.min(...xs), by = Math.min(...ys);
      if (!visible(bx, by, Math.max(...xs) - bx, Math.max(...ys) - by)) continue;
      const selected = ui.sel?.kind === 'link' && ui.sel.id === l.id;
      V.polyline(ctx, pts, { color: selected ? C.accent : C.inkSoft, lw: selected ? 2 : 1.2 });
      if (l.flow > 0) {
        V.polyline(ctx, pts, {
          color: C.accent, lw: 2, dash: [5, 7],
          dashOffset: -(performance.now() / 26) % 12,
        });
      }
      V.arrow(ctx, pts[pts.length - 1], 1, selected ? C.accent : C.inkSoft);
    }

    if (ui.mode === 'link' && ui.drag) {
      const from = nodeById(s, ui.drag.from);
      if (from) {
        const a = nodeGeom(s, from).out;
        V.polyline(ctx, V.route(a, ui.drag.to), { color: C.accent, lw: 1.4, dash: [4, 4] });
      }
    }

    for (const n of s.nodes) {
      const g = nodeGeom(s, n);
      if (visible(n.x, n.y, g.w, g.h)) drawNode(ctx, s, n, ui);
    }

    if (ui.placing) {
      const t = typeOf(s, ui.placing);
      const x = Math.round((ui.world.x - 92) / SNAP) * SNAP, y = Math.round((ui.world.y - 40) / SNAP) * SNAP;
      ctx.save(); ctx.globalAlpha = 0.55;
      V.box(ctx, x, y, 184, 24 + Math.max(1, t.ingredients.length) * 20 + 30, { dash: [5, 4], stroke: C.accent });
      V.label(ctx, t.name, x + 8, y + 16, { size: 11, color: C.accent, track: 1 });
      ctx.restore();
    }
    ctx.restore();

    V.sheet(ctx, w, h, 'NAND IDLE — FAB FLOOR', 'SHEET 1 OF 1 / UNITS: GATES', `REV ${String(s.stats.recorded).padStart(2, '0')}`);
    if (ui.hover && ui.mode === 'idle') drawTip(ctx, s, nodeById(s, ui.hover), ui, w, h);
    if (ui.toastT > 0 && ui.toast) {
      const t = ui.toast;
      ctx.save();
      ctx.globalAlpha = Math.min(1, ui.toastT / 400);
      const tw = ctx.measureText(t.msg).width + 220;
      V.box(ctx, w / 2 - tw / 2, 26, tw, 30, { stroke: t.kind === 'bad' ? C.bad : C.warn });
      V.label(ctx, t.msg, w / 2, 46, { size: 12, align: 'center', color: t.kind === 'bad' ? C.bad : C.warn, track: 0.6 });
      ctx.restore();
    }
    return { cam, ui };
  }

  return { render, ui, cam, onKey, setPlacing: (id) => { ui.placing = id; }, toast };
}

function drawNode(ctx, s, n, ui) {
  const g = nodeGeom(s, n);
  const selected = ui.sel?.kind === 'node' && ui.sel.id === n.id;
  const stroke = selected ? C.accent : C.ink;

  if (n.kind === 'source') {
    V.box(ctx, n.x, n.y, g.w, g.h, { stroke, lw: selected ? 2 : 1.6 });
    V.hatch(ctx, n.x + 1, n.y + 1, g.w - 2, 22);
    ctx.save(); ctx.strokeStyle = stroke; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(n.x, n.y + 23); ctx.lineTo(n.x + g.w, n.y + 23); ctx.stroke(); ctx.restore();
    V.label(ctx, 'GATE SOURCE', n.x + 8, n.y + 16, { size: 10.5, weight: 600, track: 1.2 });
    V.label(ctx, `NAND  $${BAL.gateCost.toFixed(2)}/EA`, n.x + 8, n.y + 40, { size: 10, color: C.inkSoft, track: 0.6 });
    V.label(ctx, 'OUT', n.x + g.w - 30, n.y + g.h / 2 - 8, { size: 9, color: C.inkSoft, track: 0.6 });
    V.label(ctx, 'MINTED ON DEMAND', n.x + 8, n.y + 56, { size: 8.5, color: C.inkFaint, track: 0.6 });
    V.label(ctx, String(s.stats.gates), n.x + g.w - 8, n.y + 56, { size: 9, align: 'right', color: C.inkSoft });
    V.pin(ctx, g.out.x, g.out.y, { filled: s.cash >= BAL.gateCost, color: stroke });
    return;
  }

  if (n.kind === 'client') {
    V.box(ctx, n.x, n.y, g.w, g.h, { stroke: n.complete ? C.good : stroke, lw: selected ? 2 : 1.6 });
    V.hatch(ctx, n.x + 1, n.y + 1, g.w - 2, 22, n.complete ? 'rgba(47,111,79,0.12)' : C.shade);
    ctx.save(); ctx.strokeStyle = n.complete ? C.good : stroke; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(n.x, n.y + 23); ctx.lineTo(n.x + g.w, n.y + 23); ctx.stroke(); ctx.restore();
    V.label(ctx, n.company.slice(0, 20), n.x + 8, n.y + 16, { size: 10, weight: 600, track: 0.8 });
    V.label(ctx, `WANTS  ${n.want}`, n.x + 8, n.y + 40, { size: 11, track: 0.8 });
    V.label(ctx, `${n.arity} IN`, n.x + g.w - 8, n.y + 40, { size: 9.5, align: 'right', color: C.inkSoft });
    V.gauge(ctx, n.x + 8, n.y + 48, g.w - 16, 8, n.delivered, n.need, n.complete ? C.good : C.accent);
    const pay = n.complete ? Math.round(n.pay * BAL.maintenancePay) : n.pay;
    V.label(ctx, `${Math.min(n.delivered, n.need)}/${n.need}`, n.x + 8, n.y + 70, { size: 10, color: C.inkSoft, track: 0.6 });
    V.label(ctx, `$${pay}/EA${n.complete ? ' (MAINT)' : ''}`, n.x + g.w - 8, n.y + 70, { size: 10, align: 'right', color: C.good, track: 0.6 });
    if (n.lastError) V.label(ctx, n.lastError.slice(0, 30), n.x + 8, n.y + 88, { size: 8.5, color: C.bad });
    V.pin(ctx, g.ins[0].x, g.ins[0].y, { color: n.complete ? C.good : stroke });
    return;
  }

  const t = typeOf(s, n.typeId);
  V.box(ctx, n.x, n.y, g.w, g.h, { stroke, lw: selected ? 2 : 1.6 });
  V.hatch(ctx, n.x + 1, n.y + 1, g.w - 2, 23);
  ctx.save(); ctx.strokeStyle = stroke; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(n.x, n.y + 24); ctx.lineTo(n.x + g.w, n.y + 24); ctx.stroke(); ctx.restore();
  V.label(ctx, t.name, n.x + 8, n.y + 16.5, { size: 10.5, weight: 600, track: 1 });
  V.label(ctx, `${t.arity}IN`, n.x + g.w - 8, n.y + 16.5, { size: 9, align: 'right', color: C.inkSoft });

  n.ins.forEach((p, i) => {
    const y = n.y + 24 + 12 + i * 20;
    const pt = typeOf(s, p.typeId);
    V.pin(ctx, n.x, y, { filled: p.n >= p.need, color: stroke });
    V.label(ctx, `${p.need}x ${pt.name}`.slice(0, 14), n.x + 10, y + 3.5, { size: 9.5, color: C.inkSoft });
    V.gauge(ctx, n.x + g.w - 68, y - 4, 30, 8, p.n, p.need, p.n >= p.need ? C.accent : C.warn);
    V.label(ctx, `${p.n}/${p.need}`, n.x + g.w - 8, y + 3.5, { size: 9, color: C.inkSoft, align: 'right' });
  });

  const by = n.y + g.h - 22;
  V.label(ctx, `${(60000 / t.timeMs).toFixed(1)}/MIN`, n.x + 8, by + 4, { size: 9, color: C.inkSoft });
  const pw = 62;
  V.box(ctx, n.x + g.w - pw - 30, by - 5, pw, 9, { lw: 0.9, stroke: C.inkFaint });
  if (n.prog !== null) {
    const frac = 1 - Math.max(0, n.prog) / t.timeMs;
    ctx.save(); ctx.fillStyle = C.ink; ctx.globalAlpha = 0.8;
    ctx.fillRect(n.x + g.w - pw - 29, by - 4, (pw - 2) * frac, 7); ctx.restore();
  }
  V.gauge(ctx, n.x + g.w - 24, by - 5, 16, 9, n.out.n, BAL.outputCap, C.good);
  V.pin(ctx, g.out.x, g.out.y, { filled: n.out.n > 0, color: stroke });
}

function drawTip(ctx, s, n, ui, w, h) {
  if (!n) return;
  const lines = [];
  if (n.kind === 'fab') {
    const t = typeOf(s, n.typeId);
    lines.push(`${t.name} — ${t.arity} input${t.arity === 1 ? '' : 's'}`);
    lines.push(`cycle ${(t.timeMs / 1000).toFixed(1)}s · ${t.ingredients.map((g) => `${g.count}x ${typeOf(s, g.typeId).name}`).join(' + ') || 'no inputs'}`);
    lines.push(`${t.gateEquiv} NAND-equivalents · $${(t.gateEquiv * BAL.gateCost).toFixed(2)} of gates per unit`);
    lines.push('drag pins to wire · right-click to remove');
  } else if (n.kind === 'client') {
    lines.push(`${n.company} — wants ${n.want}`);
    lines.push(n.brief);
    if (n.lastError) lines.push(`last rejection: ${n.lastError}`);
  } else {
    lines.push('Gate source — mints NAND on demand');
    lines.push(`$${BAL.gateCost.toFixed(2)} per gate, charged only as a consumer takes one`);
    lines.push(`${s.stats.gates} gates minted so far`);
  }
  const pad = 8;
  ctx.font = `10px ${V.MONO}`;
  const tw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  const th = lines.length * 14 + pad * 2 - 4;
  let x = ui.mouse.x + 14, y = ui.mouse.y + 14;
  if (x + tw > w - 16) x = w - 16 - tw;
  if (y + th > h - 16) y = h - 16 - th;
  V.box(ctx, x, y, tw, th, { stroke: C.inkSoft });
  lines.forEach((l, i) => V.label(ctx, l, x + pad, y + pad + 10 + i * 14, { size: 10, color: i ? C.inkSoft : C.ink }));
}
