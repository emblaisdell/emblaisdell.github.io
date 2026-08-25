// recordScreen.js — the recording bench. Lay out labelled input terminals and
// one OUT terminal, press RECORD, wire up copies of circuits you already own.
// The stopwatch time becomes the new subfab's cycle time.

import * as V from './view.js';
import { C } from './view.js';
import { typeOf, registerRecording, MAX_ARITY, BAL } from './state.js';
import { evalNetlist, canonicalName, INPUT_NAMES, rowCount, bitAt } from './circuits.js';

const FRAME = { x: -420, y: -250, w: 840, h: 500 };
const SNAP = 6;
const PIN_HIT = 9;

export function partGeom(s, p) {
  const t = typeOf(s, p.typeId);
  const rows = Math.max(1, t.arity);
  const h = 20 + rows * 18 + 8;
  return {
    w: 112, h,
    ins: Array.from({ length: t.arity }, (_, i) => ({ x: p.x, y: p.y + 20 + 12 + i * 18, i })),
    out: { x: p.x + 112, y: p.y + h / 2 },
  };
}

export function termPins(rec) {
  const ins = Array.from({ length: rec.arity }, (_, i) => ({
    x: FRAME.x, y: FRAME.y + (FRAME.h * (i + 1)) / (rec.arity + 1), i,
  }));
  return { ins, out: { x: FRAME.x + FRAME.w, y: FRAME.y + FRAME.h / 2 } };
}

export function createRecordScreen(canvas, ctxGet) {
  const cam = new V.Camera();
  cam.z = 0.9;
  const rec = {
    arity: 2, parts: [], out: null, recording: false, startTs: 0, elapsed: 0, seq: 1, name: '',
    inNames: INPUT_NAMES.slice(), outName: 'OUT', importedFrom: null,
  };
  const ui = { mode: 'idle', placing: null, sel: null, drag: null, mouse: { x: 0, y: 0 }, world: { x: 0, y: 0 }, toast: null, toastT: 0 };
  const S = () => ctxGet().state;
  const toast = (msg, kind = 'bad') => { ui.toast = { msg, kind }; ui.toastT = 2600; };

  const reset = () => {
    rec.parts = []; rec.out = null; rec.recording = false; rec.elapsed = 0; rec.name = '';
    rec.inNames = INPUT_NAMES.slice(); rec.outName = 'OUT'; rec.importedFrom = null;
    ui.placing = null; ui.sel = null;
  };

  /** Terminal names are player text: uppercase, trimmed, and never empty. */
  const clean = (v, fallback) => {
    const t = String(v || '').trim().toUpperCase().replace(/\s+/g, ' ').slice(0, 6);
    return t || fallback;
  };

  function preview() {
    const s = S();
    const net = { arity: rec.arity, parts: rec.parts, out: rec.out };
    if (!rec.out) return { ok: false, error: 'OUT terminal not connected.' };
    return evalNetlist(net, (id) => typeOf(s, id));
  }

  function hitPin(w) {
    const t = termPins(rec);
    for (const p of t.ins) if (Math.hypot(p.x - w.x, p.y - w.y) < PIN_HIT) return { kind: 'term-in', i: p.i };
    if (Math.hypot(t.out.x - w.x, t.out.y - w.y) < PIN_HIT) return { kind: 'term-out' };
    const s = S();
    for (const p of rec.parts) {
      const g = partGeom(s, p);
      if (Math.hypot(g.out.x - w.x, g.out.y - w.y) < PIN_HIT) return { kind: 'part-out', part: p };
      for (const q of g.ins) if (Math.hypot(q.x - w.x, q.y - w.y) < PIN_HIT) return { kind: 'part-in', part: p, i: q.i };
    }
    return null;
  }
  function hitPart(w) {
    const s = S();
    for (let i = rec.parts.length - 1; i >= 0; i--) {
      const p = rec.parts[i]; const g = partGeom(s, p);
      if (w.x >= p.x && w.x <= p.x + g.w && w.y >= p.y && w.y <= p.y + g.h) return p;
    }
    return null;
  }
  function removePart(p) {
    rec.parts = rec.parts.filter((q) => q.id !== p.id);
    const clear = (r) => (r && r.k === 'part' && r.id === p.id ? null : r);
    for (const q of rec.parts) q.ins = q.ins.map(clear);
    rec.out = clear(rec.out);
  }

  const screenPos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const worldPos = (e) => { const r = canvas.getBoundingClientRect(); return cam.toWorld(screenPos(e), r.width, r.height); };

  canvas.addEventListener('pointerdown', (e) => {
    if (ctxGet().state.screen !== 'record') return;
    const s = S(); const w = worldPos(e);
    canvas.setPointerCapture(e.pointerId);
    ui.sel = null;
    if (e.button === 2) {
      const p = hitPart(w);
      if (p) removePart(p);
      return;
    }
    if (ui.placing) {
      if (!rec.recording) { toast('Press RECORD before building.', 'warn'); ui.placing = null; return; }
      const t = typeOf(s, ui.placing);
      rec.parts.push({
        id: `r${rec.seq++}`, typeId: ui.placing,
        x: Math.round((w.x - 56) / SNAP) * SNAP, y: Math.round((w.y - 24) / SNAP) * SNAP,
        ins: Array.from({ length: t.arity }, () => null),
      });
      if (!e.shiftKey) ui.placing = null;
      return;
    }
    const pin = hitPin(w);
    if (pin) {
      if (pin.kind === 'part-out' || pin.kind === 'term-in') {
        ui.mode = 'link';
        ui.drag = { src: pin.kind === 'term-in' ? { k: 'in', i: pin.i } : { k: 'part', id: pin.part.id }, to: w };
      } else if (pin.kind === 'part-in') {
        pin.part.ins[pin.i] = null;
      } else if (pin.kind === 'term-out') {
        rec.out = null;
      }
      return;
    }
    const p = hitPart(w);
    if (p) { ui.mode = 'move'; ui.sel = p.id; ui.drag = { id: p.id, dx: w.x - p.x, dy: w.y - p.y }; return; }
    ui.mode = 'pan';
    ui.drag = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y };
  });

  canvas.addEventListener('pointermove', (e) => {
    if (ctxGet().state.screen !== 'record') return;
    ui.mouse = screenPos(e); ui.world = worldPos(e);
    if (ui.mode === 'pan') {
      cam.x = ui.drag.cx - (e.clientX - ui.drag.sx) / cam.z;
      cam.y = ui.drag.cy - (e.clientY - ui.drag.sy) / cam.z;
    } else if (ui.mode === 'move') {
      const p = rec.parts.find((q) => q.id === ui.drag.id);
      if (p) { p.x = Math.round((ui.world.x - ui.drag.dx) / SNAP) * SNAP; p.y = Math.round((ui.world.y - ui.drag.dy) / SNAP) * SNAP; }
    } else if (ui.mode === 'link') {
      ui.drag.to = ui.world;
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    if (ctxGet().state.screen !== 'record') return;
    if (ui.mode === 'link') {
      const w = worldPos(e);
      const pin = hitPin(w);
      if (pin && pin.kind === 'part-in') {
        if (pin.part.id === ui.drag.src.id) toast('A circuit cannot feed itself.');
        else pin.part.ins[pin.i] = ui.drag.src;
      } else if (pin && pin.kind === 'term-out') {
        rec.out = ui.drag.src;
      }
    }
    ui.mode = 'idle'; ui.drag = null;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    if (ctxGet().state.screen !== 'record') return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    cam.zoomAt(screenPos(e), e.deltaY < 0 ? 1.12 : 1 / 1.12, r.width, r.height);
  }, { passive: false });

  function onKey(e) {
    if (e.key === 'Escape') { ui.placing = null; ui.sel = null; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && ui.sel) {
      const p = rec.parts.find((q) => q.id === ui.sel);
      if (p) removePart(p);
      ui.sel = null;
    }
  }

  const api = {
    rec, ui, cam, onKey, preview, reset, toast,
    setPlacing: (id) => { ui.placing = id; },
    setArity(n) {
      if (rec.recording) return toast('Terminals are fixed once recording starts.', 'warn');
      rec.arity = Math.max(1, Math.min(MAX_ARITY, n));
      for (const p of rec.parts) p.ins = p.ins.map((r) => (r && r.k === 'in' && r.i >= rec.arity ? null : r));
      if (rec.out && rec.out.k === 'in' && rec.out.i >= rec.arity) rec.out = null;
    },
    setInName(i, v) { rec.inNames[i] = clean(v, INPUT_NAMES[i]); },
    setOutName(v) { rec.outName = clean(v, 'OUT'); },
    /** Copy a commission's signature onto the bench: ports, arity, circuit name. */
    importCommission(client) {
      if (!client) return null;
      if (rec.recording) { toast('Terminals are fixed once recording starts.', 'warn'); return null; }
      api.setArity(client.arity);
      rec.inNames = INPUT_NAMES.slice();
      (client.inNames || []).forEach((n, i) => { rec.inNames[i] = clean(n, INPUT_NAMES[i]); });
      rec.outName = clean(client.outName, 'OUT');
      rec.name = client.want;
      rec.importedFrom = client.id;
      toast(`Imported ${client.want} from ${client.company}.`, 'warn');
      return rec.name;
    },
    start() {
      if (rec.recording) return;
      rec.recording = true; rec.startTs = performance.now(); rec.elapsed = 0;
    },
    finish(name) {
      const s = S();
      if (!rec.recording) { toast('Nothing recorded yet.', 'warn'); return null; }
      const r = preview();
      if (!r.ok) { toast(r.error); return null; }
      if (r.used.size === 0) { toast('Wire at least one circuit between the terminals.'); return null; }
      const type = registerRecording(s, {
        ...r, elapsedMs: rec.elapsed, name: (name && name.trim()) || rec.name,
        inNames: rec.inNames.slice(0, rec.arity), outName: rec.outName,
      });
      reset();
      return type;
    },
    render(dt) {
      const { ctx, w, h } = V.fitCanvas(canvas);
      const s = S();
      if (ui.toastT > 0) ui.toastT -= dt;
      if (rec.recording) rec.elapsed = performance.now() - rec.startTs;
      V.clear(ctx, w, h);
      ctx.save();
      cam.applyTo(ctx, w, h);
      V.grid(ctx, cam, w, h);

      // recording frame
      ctx.save();
      ctx.strokeStyle = rec.recording ? C.accent : C.inkFaint;
      ctx.setLineDash([8, 6]); ctx.lineWidth = 1.6;
      ctx.strokeRect(FRAME.x, FRAME.y, FRAME.w, FRAME.h);
      ctx.restore();
      V.label(ctx, rec.recording ? 'RECORDING FRAME — ACTIVE' : 'RECORDING FRAME — IDLE',
        FRAME.x + 8, FRAME.y - 8, { size: 10, color: rec.recording ? C.accent : C.inkSoft, track: 1.4 });

      const T = termPins(rec);
      const termBox = (text) => Math.max(58, text.length * 9 + 18);
      T.ins.forEach((p, i) => {
        const text = rec.inNames[i] || INPUT_NAMES[i];
        const bw = termBox(text);
        V.box(ctx, p.x - bw - 6, p.y - 13, bw, 26, { stroke: C.ink });
        V.label(ctx, text, p.x - 6 - bw / 2, p.y + 4.5,
          { size: text.length > 3 ? 11 : 13, weight: 600, align: 'center' });
        V.polyline(ctx, [{ x: p.x - 6, y: p.y }, { x: p.x, y: p.y }], { color: C.ink });
        V.pin(ctx, p.x, p.y, { color: C.ink, filled: true });
      });
      const outText = rec.outName || 'OUT';
      const obw = termBox(outText);
      V.box(ctx, T.out.x + 8, T.out.y - 13, obw, 26, { stroke: rec.out ? C.good : C.ink });
      V.label(ctx, outText, T.out.x + 8 + obw / 2, T.out.y + 4.5,
        { size: outText.length > 3 ? 11 : 13, weight: 600, align: 'center', color: rec.out ? C.good : C.ink });
      V.polyline(ctx, [{ x: T.out.x, y: T.out.y }, { x: T.out.x + 8, y: T.out.y }], { color: C.ink });
      V.pin(ctx, T.out.x, T.out.y, { color: rec.out ? C.good : C.ink, filled: !!rec.out });

      const anchorOf = (ref) => {
        if (!ref) return null;
        if (ref.k === 'in') return T.ins[ref.i];
        const p = rec.parts.find((q) => q.id === ref.id);
        return p ? partGeom(s, p).out : null;
      };

      for (const p of rec.parts) {
        const g = partGeom(s, p);
        p.ins.forEach((ref, i) => {
          const a = anchorOf(ref);
          if (a) V.polyline(ctx, V.route(a, g.ins[i]), { color: C.inkSoft, lw: 1.2 });
        });
      }
      const outAnchor = anchorOf(rec.out);
      if (outAnchor) V.polyline(ctx, V.route(outAnchor, T.out), { color: C.good, lw: 1.6 });

      if (ui.mode === 'link' && ui.drag) {
        const a = anchorOf(ui.drag.src);
        if (a) V.polyline(ctx, V.route(a, ui.drag.to), { color: C.accent, lw: 1.3, dash: [4, 4] });
      }

      for (const p of rec.parts) {
        const t = typeOf(s, p.typeId);
        const g = partGeom(s, p);
        const sel = ui.sel === p.id;
        V.box(ctx, p.x, p.y, g.w, g.h, { stroke: sel ? C.accent : C.ink, lw: sel ? 2 : 1.4 });
        V.hatch(ctx, p.x + 1, p.y + 1, g.w - 2, 19);
        ctx.save(); ctx.strokeStyle = sel ? C.accent : C.ink; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x, p.y + 20); ctx.lineTo(p.x + g.w, p.y + 20); ctx.stroke(); ctx.restore();
        V.label(ctx, t.name.slice(0, 13), p.x + 6, p.y + 14, { size: 9.5, weight: 600, track: 0.6 });
        g.ins.forEach((q, i) => {
          V.pin(ctx, q.x, q.y, { filled: !!p.ins[i], color: p.ins[i] ? C.ink : C.inkFaint });
          V.label(ctx, (t.inNames && t.inNames[i]) || INPUT_NAMES[i], q.x + 8, q.y + 3.5,
            { size: 9, color: C.inkSoft });
        });
        V.pin(ctx, g.out.x, g.out.y, { color: C.ink });
      }

      if (ui.placing) {
        const t = typeOf(s, ui.placing);
        const x = Math.round((ui.world.x - 56) / SNAP) * SNAP, y = Math.round((ui.world.y - 24) / SNAP) * SNAP;
        ctx.save(); ctx.globalAlpha = 0.5;
        V.box(ctx, x, y, 112, 20 + Math.max(1, t.arity) * 18 + 8, { dash: [5, 4], stroke: C.accent });
        V.label(ctx, t.name, x + 6, y + 14, { size: 9.5, color: C.accent });
        ctx.restore();
      }
      ctx.restore();

      V.sheet(ctx, w, h, 'NAND IDLE — RECORDING BENCH', 'COMBINATIONAL DESIGN SHEET',
        rec.recording ? 'REC' : 'IDLE');

      // stopwatch
      const secs = rec.elapsed / 1000;
      V.box(ctx, 26, 26, 168, 44, { stroke: rec.recording ? C.bad : C.inkSoft });
      V.label(ctx, rec.recording ? 'STOPWATCH — RUNNING' : 'STOPWATCH', 34, 42, { size: 9, color: C.inkSoft, track: 1 });
      V.label(ctx, `${secs.toFixed(1)}s`, 34, 62, { size: 17, weight: 600, color: rec.recording ? C.bad : C.inkSoft });
      V.label(ctx, `CYCLE ${(Math.min(BAL.recordMaxMs, Math.max(BAL.recordMinMs, rec.elapsed)) / 1000).toFixed(1)}s`,
        186, 62, { size: 9, align: 'right', color: C.inkSoft });

      if (ui.toastT > 0 && ui.toast) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, ui.toastT / 400);
        ctx.font = `12px ${V.MONO}`;
        const tw = ctx.measureText(ui.toast.msg).width + 40;
        V.box(ctx, w / 2 - tw / 2, 26, tw, 30, { stroke: ui.toast.kind === 'bad' ? C.bad : C.warn });
        V.label(ctx, ui.toast.msg, w / 2, 46, { size: 12, align: 'center', color: ui.toast.kind === 'bad' ? C.bad : C.warn });
        ctx.restore();
      }
    },
  };
  return api;
}

/** Render a truth table as rows of text for the side panel. */
export function truthRows(arity, table) {
  const out = [];
  for (let r = 0; r < rowCount(arity); r++) {
    const ins = [];
    for (let k = 0; k < arity; k++) ins.push((r >>> k) & 1);
    out.push({ ins, out: bitAt(table, r) });
  }
  return out;
}
export { canonicalName };
