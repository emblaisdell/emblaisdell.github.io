// recordScreen.js — the recording bench. Lay out labelled input terminals and
// one OUT terminal, press RECORD, wire up copies of circuits you already own.
// The stopwatch time becomes the new process's cycle time.

import * as V from './view.js';
import { C } from './view.js';
import { typeOf, registerRecording } from './state.js';
import { canonicalName, INPUT_NAMES, rowCount, bitAt } from './circuits.js';
import { analyse, MAX_PORTS, MAX_WIDTH } from './netlist.js';
import { drawSymbol, leadYs, spec, VB } from './symbols.js';
import { sfx } from './audio.js';
import * as History from './undo.js';

const FRAME = { x: -420, y: -250, w: 840, h: 500 };
const SNAP = 6;
const PIN_HIT = 22;        // generous: the drawn pin is 4px, the target is not
const BODY_PAD = 7;        // parts are easier to grab than they look
const TERM_W = 130;        // room either side of the frame for the terminal boxes

export const inPortsOf = (t) => t.inPorts || Array.from({ length: t.arity }, (_, i) => ({ name: (t.inNames || [])[i] || `IN${i}`, width: 1 }));
export const outPortsOf = (t) => t.outPorts || Array.from({ length: t.outCount || 1 }, (_, i) => ({ name: (t.outNames || ['Y'])[i] || `O${i}`, width: 1 }));

export function partGeom(s, p) {
  const t = typeOf(s, p.typeId);
  const ins = inPortsOf(t);
  const outs = outPortsOf(t);
  const w = 104;
  const h = Math.max(46, 14 + Math.max(ins.length, outs.length) * 17);
  const sy = h / VB.h;
  const sx = w / VB.w;
  const k = spec(t.symbol || 'box');
  return {
    w, h, inPorts: ins, outPorts: outs,
    ins: leadYs(ins.length).map((y, i) => ({ x: p.x, y: p.y + y * sy, i, width: ins[i].width })),
    outs: leadYs(outs.length).map((y, i) => ({ x: p.x + w, y: p.y + y * sy, i, width: outs[i].width })),
    out: { x: p.x + w, y: p.y + 32 * sy },
    bodyIn: p.x + k.inX * sx,
    bubbleIn: p.x + (k.inX - 11) * sx,
    bodyOut: p.x + k.outX * sx,
  };
}

export function termPins(rec) {
  const ins = Array.from({ length: rec.arity }, (_, i) => ({
    x: FRAME.x, y: FRAME.y + (FRAME.h * (i + 1)) / (rec.arity + 1), i,
  }));
  const outs = Array.from({ length: rec.outCount || 1 }, (_, i) => ({
    x: FRAME.x + FRAME.w, y: FRAME.y + (FRAME.h * (i + 1)) / ((rec.outCount || 1) + 1), i,
  }));
  return { ins, outs, out: outs[0] };
}

/** Dimension lines, corner marks and a scale note: a plan, not just a box. */
function planFurniture(ctx, active) {
  const c = active ? C.accent : C.inkFaint;
  const off = 14;
  ctx.save();
  ctx.strokeStyle = c;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (let x = FRAME.x; x <= FRAME.x + FRAME.w; x += 60) {
    ctx.moveTo(x, FRAME.y - off); ctx.lineTo(x, FRAME.y - off + 6);
    ctx.moveTo(x, FRAME.y + FRAME.h + off - 6); ctx.lineTo(x, FRAME.y + FRAME.h + off);
  }
  for (let y = FRAME.y; y <= FRAME.y + FRAME.h; y += 60) {
    ctx.moveTo(FRAME.x - off, y); ctx.lineTo(FRAME.x - off + 6, y);
    ctx.moveTo(FRAME.x + FRAME.w + off - 6, y); ctx.lineTo(FRAME.x + FRAME.w + off, y);
  }
  // corner marks
  const k = 22;
  for (const [cx, cy, sx, sy] of [
    [FRAME.x, FRAME.y, 1, 1], [FRAME.x + FRAME.w, FRAME.y, -1, 1],
    [FRAME.x, FRAME.y + FRAME.h, 1, -1], [FRAME.x + FRAME.w, FRAME.y + FRAME.h, -1, -1],
  ]) {
    ctx.moveTo(cx, cy + sy * k); ctx.lineTo(cx, cy); ctx.lineTo(cx + sx * k, cy);
  }
  ctx.stroke();
  ctx.restore();
  V.label(ctx, 'SCALE 1:1', FRAME.x + FRAME.w - 8, FRAME.y + FRAME.h + 22,
    { size: 8.5, align: 'right', color: C.inkFaint, track: 1 });
}

export function createRecordScreen(canvas, ctxGet) {
  const cam = new V.Camera();
  cam.z = 0.9;
  // Hit targets are sized in screen pixels, so a finger on a zoomed-out phone
  // is as forgiving as a mouse at 1:1.
  const pinTol = () => Math.max(PIN_HIT, 26 / cam.z);
  const bodyPad = () => Math.max(BODY_PAD, 10 / cam.z);
  const rec = {
    arity: 2, outCount: 1, parts: [], outs: [null],
    inWidths: new Array(10).fill(1), outWidths: new Array(10).fill(1),
    recording: false, startTs: 0, elapsed: 0, seq: 1, name: '',
    inNames: INPUT_NAMES.slice(), outNames: ['Y', 'Z', 'W', 'V', 'U', 'T', 'S', 'R', 'Q', 'P'],
    importedFrom: null,
  };
  const ui = { mode: 'idle', placing: null, sel: null, drag: null, mouse: { x: 0, y: 0 }, world: { x: 0, y: 0 }, toast: null, toastT: 0 };
  const S = () => ctxGet().state;
  const toast = (msg, kind = 'bad') => { ui.toast = { msg, kind }; ui.toastT = 2600; };

  /** The bench is small enough to snapshot whole. */
  const mark = (label) => {
    const parts = JSON.parse(JSON.stringify(rec.parts));
    const outs = JSON.parse(JSON.stringify(rec.outs));
    History.push('bench', label, () => { rec.parts = parts; rec.outs = outs; ui.sel = null; });
  };

  const reset = () => {
    rec.parts = []; rec.outs = [null]; rec.outCount = 1;
    rec.recording = false; rec.elapsed = 0; rec.name = '';
    rec.inNames = INPUT_NAMES.slice();
    rec.outNames = ['Y', 'Z', 'W', 'V', 'U', 'T', 'S', 'R', 'Q', 'P'];
    rec.inWidths = new Array(10).fill(1);
    rec.outWidths = new Array(10).fill(1);
    rec.importedFrom = null;
    ui.placing = null; ui.sel = null;
    History.clear('bench');
  };

  /** Terminal names are player text: uppercase, trimmed, and never empty. */
  const clean = (v, fallback) => {
    const t = String(v || '').trim().toUpperCase().replace(/\s+/g, ' ').slice(0, 6);
    return t || fallback;
  };

  /**
   * What the bench currently is, cheaply. The analysis panel asks for a verdict
   * several times a second, and analysing a design of any size is not free —
   * a few hundred gates takes tens of milliseconds — so the answer is kept
   * until the drawing actually changes.
   */
  function benchSignature() {
    const parts = rec.parts.map((p) => `${p.id}:${p.typeId}:${p.ins.map((r2) => (r2
      ? (r2.k === 'in' ? `i${r2.i}` : `p${r2.id}.${r2.out || 0}`) : '-')).join(',')}`).join(';');
    const outs = rec.outs.slice(0, rec.outCount).map((r2) => (r2
      ? (r2.k === 'in' ? `i${r2.i}` : `p${r2.id}.${r2.out || 0}`) : '-')).join(',');
    return `${rec.arity}|${rec.outCount}|${rec.inWidths.slice(0, rec.arity).join(',')}`
      + `|${rec.outWidths.slice(0, rec.outCount).join(',')}|${outs}|${parts}`;
  }

  let lastPreview = { sig: null, result: null };

  function preview() {
    const s = S();
    if (!rec.outs.some(Boolean)) return { ok: false, error: 'No output terminal is connected.' };
    const sig = `${benchSignature()}#${s.typesVersion || 0}`;
    if (lastPreview.sig === sig) return lastPreview.result;
    const result = analyse({
      arity: rec.arity,
      inPorts: rec.inNames.slice(0, rec.arity).map((name, i) => ({ name, width: rec.inWidths[i] || 1 })),
      outPorts: rec.outNames.slice(0, rec.outCount).map((name, i) => ({ name, width: rec.outWidths[i] || 1 })),
      parts: rec.parts,
      outs: rec.outs.slice(0, rec.outCount),
    }, (id) => typeOf(s, id));
    lastPreview = { sig, result };
    return result;
  }

  /**
   * The pin nearest the pointer, if any is within reach. Pins are tested
   * before part bodies, and the reach is deliberately wider than a pin looks —
   * it overlaps the body, and that is fine: wiring is what a pin is for.
   * Nearest wins, so the reach can be wider than the gap between two inputs.
   */
  function hitPin(w, tol = pinTol()) {
    let best = null;
    const consider = (x, y, hit) => {
      const d = Math.hypot(x - w.x, y - w.y);
      if (d < tol && (!best || d < best.d)) best = { d, hit };
    };
    const t = termPins(rec);
    for (const p of t.ins) consider(p.x, p.y, { kind: 'term-in', i: p.i });
    for (const p of t.outs) consider(p.x, p.y, { kind: 'term-out', i: p.i });
    const s = S();
    for (const p of rec.parts) {
      const g = partGeom(s, p);
      for (const q of g.outs) consider(q.x, q.y, { kind: 'part-out', part: p, i: q.i });
      for (const q of g.ins) consider(q.x, q.y, { kind: 'part-in', part: p, i: q.i });
    }
    return best?.hit || null;
  }

  /**
   * Where a wire being dragged would land: a pin within (wider) reach, else
   * the nearest free input of whatever part the pointer is over, else an OUT
   * terminal box. Letting go anywhere on a gate connects it.
   */
  function dropTarget(w) {
    const pin = hitPin(w, pinTol() * 1.4);
    if (pin && (pin.kind === 'part-in' || pin.kind === 'term-out')) return pin;
    const p = hitPart(w);
    if (p) {
      const g = partGeom(S(), p);
      let best = null;
      g.ins.forEach((q, i) => {
        const d = Math.hypot(q.x - w.x, q.y - w.y) + (p.ins[i] ? 1e6 : 0);   // a free input first
        if (!best || d < best.d) best = { d, i };
      });
      if (best) return { kind: 'part-in', part: p, i: best.i };
    }
    const term = hitTerminal(w);
    if (term && term.kind === 'out') return { kind: 'term-out', i: term.i };
    return null;
  }
  function hitPart(w) {
    const s = S();
    const pad = bodyPad();
    for (let i = rec.parts.length - 1; i >= 0; i--) {
      const p = rec.parts[i]; const g = partGeom(s, p);
      if (w.x >= p.x - pad && w.x <= p.x + g.w + pad
        && w.y >= p.y - pad && w.y <= p.y + g.h + pad) return p;
    }
    return null;
  }

  /** Drop a copy of the selected circuit. It stays selected: the next tap drops another. */
  function place(w) {
    const t = typeOf(S(), ui.placing);
    mark('place');
    sfx('place');
    rec.parts.push({
      id: `r${rec.seq++}`, typeId: ui.placing,
      x: Math.round((w.x - 52) / SNAP) * SNAP, y: Math.round((w.y - 24) / SNAP) * SNAP,
      ins: Array.from({ length: t.arity }, () => null),
    });
  }

  /** Pick a wire up from a pin: a fresh one from an output, or an existing one from an input. */
  function startLink(pin, w) {
    if (pin.kind === 'part-out') {
      ui.sel = { kind: 'part', id: pin.part.id };
      ui.mode = 'link';
      ui.drag = { src: { k: 'part', id: pin.part.id, out: pin.i }, to: w };
    } else if (pin.kind === 'term-in') {
      ui.sel = { kind: 'in', i: pin.i };
      ui.mode = 'link';
      ui.drag = { src: { k: 'in', i: pin.i }, to: w };
    } else if (pin.kind === 'part-in') {
      // Pick the existing wire up and carry it somewhere else, rather than
      // just dropping it on the floor.
      ui.sel = { kind: 'part', id: pin.part.id };
      const had = pin.part.ins[pin.i];
      pin.part.ins[pin.i] = null;
      if (had) { ui.mode = 'link'; ui.drag = { src: had, to: w }; }
    } else if (pin.kind === 'term-out') {
      ui.sel = { kind: 'out', i: pin.i };
      const had = rec.outs[pin.i];
      rec.outs[pin.i] = null;
      if (had) { ui.mode = 'link'; ui.drag = { src: had, to: w }; }
    }
  }

  /**
   * Show the whole sheet: frame, terminal boxes and labels, clear of the
   * toolbar at the top and the title block at the bottom. Called when the
   * screen opens and whenever the canvas changes size; zooming by hand after
   * that is respected until the next resize.
   */
  let fitted = { w: 0, h: 0 };
  function fit() {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    fitted = { w, h };
    const top = 62, bottom = w >= 600 ? 72 : 16, side = 10;
    const rw = w - side * 2, rh = h - top - bottom;
    cam.z = Math.max(0.15, Math.min(1.15, rw / (FRAME.w + TERM_W * 2), rh / (FRAME.h + 70)));
    cam.x = FRAME.x + FRAME.w / 2;
    // the frame's centre lands in the middle of the region left over
    const cy = (top + (h - bottom)) / 2;
    cam.y = FRAME.y + FRAME.h / 2 - (cy - h / 2) / cam.z;
  }

  /** The terminal boxes are click targets in their own right, not just pins. */
  function hitTerminal(w) {
    const t = termPins(rec);
    for (const p of t.ins) {
      if (w.x > p.x - 90 && w.x < p.x + 8 && Math.abs(w.y - p.y) < 18) return { kind: 'in', i: p.i };
    }
    for (const p of t.outs) {
      if (w.x > p.x - 8 && w.x < p.x + 96 && Math.abs(w.y - p.y) < 18) return { kind: 'out', i: p.i };
    }
    return null;
  }
  function removePart(p) {
    mark('delete');
    rec.parts = rec.parts.filter((q) => q.id !== p.id);
    const clear = (r) => (r && r.k === 'part' && r.id === p.id ? null : r);
    for (const q of rec.parts) q.ins = q.ins.map(clear);
    rec.outs = rec.outs.map(clear);
  }

  const screenPos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const worldPos = (e) => { const r = canvas.getBoundingClientRect(); return cam.toWorld(screenPos(e), r.width, r.height); };

  // Fingers currently on the sheet, so two of them can pinch.
  const pointers = new Map();
  let pinch = null;

  canvas.addEventListener('pointerdown', (e) => {
    if (ctxGet().state.screen !== 'record') return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, screenPos(e));
    if (pointers.size === 2) {
      // A second finger turns whatever the first was doing into a pinch.
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), z: cam.z };
      ui.mode = 'pinch'; ui.drag = null;
      return;
    }
    if (pointers.size > 2) return;
    const w = worldPos(e);
    ui.sel = null;
    if (e.button === 2) {
      const p = hitPart(w);
      if (p) removePart(p);
      return;
    }
    // Pins come first even while placing: starting a wire is how placing ends.
    const pin = hitPin(w);
    if (pin) { ui.placing = null; startLink(pin, w); return; }
    const p = hitPart(w);
    if (p) { ui.mode = 'move'; ui.sel = { kind: 'part', id: p.id }; ui.drag = { id: p.id, dx: w.x - p.x, dy: w.y - p.y }; return; }
    const term = hitTerminal(w);
    if (term) { ui.sel = term; return; }
    if (ui.placing) {
      if (!rec.recording) { toast('Press RECORD before building.', 'warn'); ui.placing = null; return; }
      if (e.pointerType === 'touch') {
        // A finger may be about to pan or pinch: place on lift, if it stayed put.
        ui.mode = 'tap-place';
        ui.drag = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y };
        return;
      }
      place(w);
      return;
    }
    ui.mode = 'pan';
    ui.drag = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y };
  });

  canvas.addEventListener('pointermove', (e) => {
    if (ctxGet().state.screen !== 'record') return;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, screenPos(e));
    ui.mouse = screenPos(e); ui.world = worldPos(e);
    if (ui.mode === 'pinch') {
      if (!pinch || pointers.size < 2) return;
      const [a, b] = [...pointers.values()];
      const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const r = canvas.getBoundingClientRect();
      const target = Math.max(0.15, Math.min(2.4, pinch.z * (d / pinch.d)));
      cam.zoomAt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, target / cam.z, r.width, r.height);
    } else if (ui.mode === 'tap-place') {
      if (Math.hypot(e.clientX - ui.drag.sx, e.clientY - ui.drag.sy) > 12) ui.mode = 'pan';   // a drag after all
    } else if (ui.mode === 'pan') {
      cam.x = ui.drag.cx - (e.clientX - ui.drag.sx) / cam.z;
      cam.y = ui.drag.cy - (e.clientY - ui.drag.sy) / cam.z;
    } else if (ui.mode === 'move') {
      const p = rec.parts.find((q) => q.id === ui.drag.id);
      if (p) { p.x = Math.round((ui.world.x - ui.drag.dx) / SNAP) * SNAP; p.y = Math.round((ui.world.y - ui.drag.dy) / SNAP) * SNAP; }
    } else if (ui.mode === 'link') {
      ui.drag.to = ui.world;
    }
  });

  function pointerEnd(e, cancelled) {
    if (ctxGet().state.screen !== 'record') return;
    pointers.delete(e.pointerId);
    if (ui.mode === 'pinch') {
      if (pointers.size < 2) { ui.mode = 'idle'; ui.drag = null; pinch = null; }
      return;
    }
    if (ui.mode === 'tap-place') {
      if (!cancelled && ui.placing) place(worldPos(e));
    } else if (ui.mode === 'link' && !cancelled) {
      const w = worldPos(e);
      const pin = dropTarget(w);
      if (pin && pin.kind === 'part-in') {
        if (pin.part.id === ui.drag.src.id) toast('A circuit cannot feed itself.');
        else { mark('wire'); pin.part.ins[pin.i] = ui.drag.src; sfx('wire'); }
      } else if (pin && pin.kind === 'term-out') {
        mark('wire');
        rec.outs[pin.i] = ui.drag.src;
        sfx('wire');
      } else {
        sfx('unwire');
      }
    }
    ui.mode = 'idle'; ui.drag = null;
  }
  canvas.addEventListener('pointerup', (e) => pointerEnd(e, false));
  canvas.addEventListener('pointercancel', (e) => pointerEnd(e, true));
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
      if (ui.sel.kind === 'part') {
        const p = rec.parts.find((q) => q.id === ui.sel.id);
        if (p) removePart(p);
      } else if (ui.sel.kind === 'out') {
        rec.outs[ui.sel.i] = null;
      } else if (ui.sel.kind === 'in') {
        for (const p of rec.parts) p.ins = p.ins.map((ref) => (ref && ref.k === 'in' && ref.i === ui.sel.i ? null : ref));
        rec.outs = rec.outs.map((ref) => (ref && ref.k === 'in' && ref.i === ui.sel.i ? null : ref));
      }
      ui.sel = null;
    }
  }

  const api = {
    rec, ui, cam, onKey, preview, reset, toast, fit,
    setPlacing: (id) => { ui.placing = id; },
    setArity(n) {
      if (rec.recording) return toast('Terminals are fixed once recording starts.', 'warn');
      rec.arity = Math.max(1, Math.min(MAX_PORTS, n));
      for (const p of rec.parts) p.ins = p.ins.map((r) => (r && r.k === 'in' && r.i >= rec.arity ? null : r));
      rec.outs = rec.outs.map((r) => (r && r.k === 'in' && r.i >= rec.arity ? null : r));
    },
    setOutCount(n) {
      if (rec.recording) return toast('Terminals are fixed once recording starts.', 'warn');
      rec.outCount = Math.max(1, Math.min(MAX_PORTS, n));
      while (rec.outs.length < rec.outCount) rec.outs.push(null);
      rec.outs.length = Math.max(rec.outCount, rec.outs.length);
    },
    setOutName(i, v) { rec.outNames[i] = clean(v, ['Y', 'Z', 'W', 'V', 'U', 'T', 'S', 'R', 'Q', 'P'][i] || `O${i + 1}`); },
    setWidth(side, i, w) {
      if (rec.recording) return toast('Terminals are fixed once recording starts.', 'warn');
      const width = Math.max(1, Math.min(MAX_WIDTH, w | 0));
      if (side === 'in') rec.inWidths[i] = width; else rec.outWidths[i] = width;
    },
    setInName(i, v) { rec.inNames[i] = clean(v, INPUT_NAMES[i]); },
    /** Copy a commission's signature onto the bench: ports, arity, circuit name. */
    importCommission(client) {
      if (!client) return null;
      if (rec.recording) { toast('Terminals are fixed once recording starts.', 'warn'); return null; }
      api.setArity(client.arity);
      api.setOutCount((client.outNames || [client.outName]).length);
      rec.inNames = INPUT_NAMES.slice();
      (client.inNames || []).forEach((n, i) => { rec.inNames[i] = clean(n, INPUT_NAMES[i]); });
      (client.outNames || [client.outName]).forEach((n, i) => { rec.outNames[i] = clean(n, 'Y'); });
      (client.inPorts || []).forEach((p, i) => { rec.inWidths[i] = p.width; });
      (client.outPorts || []).forEach((p, i) => { rec.outWidths[i] = p.width; });
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
        inNames: rec.inNames.slice(0, rec.arity),
        outNames: rec.outNames.slice(0, rec.outCount),
      });
      reset();
      return type;
    },
    render(dt) {
      const { ctx, w, h } = V.fitCanvas(canvas);
      if (w !== fitted.w || h !== fitted.h) fit();     // first frame, rotation, resize
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
      V.label(ctx, rec.recording ? 'FLOOR PLAN — RECORDING' : 'FLOOR PLAN — IDLE',
        FRAME.x + 8, FRAME.y - 8, { size: 10, color: rec.recording ? C.accent : C.inkSoft, track: 1.4 });
      planFurniture(ctx, rec.recording);

      const T = termPins(rec);
      const termBox = (text) => Math.max(58, text.length * 9 + 18);
      T.ins.forEach((p, i) => {
        const wide = (rec.inWidths[i] || 1) > 1;
        const text = (rec.inNames[i] || INPUT_NAMES[i]) + (wide ? `[${rec.inWidths[i]}]` : '');
        const bw = termBox(text);
        const selIn = ui.sel?.kind === 'in' && ui.sel.i === i;
        V.box(ctx, p.x - bw - 6, p.y - 13, bw, 26, { stroke: selIn ? C.accent : C.ink, lw: selIn ? 2 : 1.4 });
        V.label(ctx, text, p.x - 6 - bw / 2, p.y + 4.5,
          { size: text.length > 3 ? 11 : 13, weight: 600, align: 'center' });
        V.polyline(ctx, [{ x: p.x - 6, y: p.y }, { x: p.x, y: p.y }], { color: C.ink, lw: wide ? 2.6 : 1.4 });
        V.pin(ctx, p.x, p.y, { color: C.ink, filled: true, r: wide ? 4.5 : 3.5 });
      });
      T.outs.forEach((p, i) => {
        const wideOut = (rec.outWidths[i] || 1) > 1;
        const text = (rec.outNames[i] || `O${i + 1}`) + (wideOut ? `[${rec.outWidths[i]}]` : '');
        const obw = termBox(text);
        const selOut = ui.sel?.kind === 'out' && ui.sel.i === i;
        const wired = !!rec.outs[i];
        V.box(ctx, p.x + 8, p.y - 13, obw, 26,
          { stroke: selOut ? C.accent : wired ? C.good : C.ink, lw: selOut ? 2 : 1.4 });
        V.label(ctx, text, p.x + 8 + obw / 2, p.y + 4.5,
          { size: text.length > 3 ? 11 : 13, weight: 600, align: 'center', color: wired ? C.good : C.ink });
        V.polyline(ctx, [{ x: p.x, y: p.y }, { x: p.x + 8, y: p.y }], { color: C.ink });
        V.pin(ctx, p.x, p.y, { color: wired ? C.good : C.ink, filled: wired });
      });

      const anchorOf = (ref) => {
        if (!ref) return null;
        if (ref.k === 'in') return T.ins[ref.i];
        const p = rec.parts.find((q) => q.id === ref.id);
        if (!p) return null;
        const g = partGeom(s, p);
        return g.outs[ref.out || 0] || g.out;
      };
      const widthOf = (ref) => {
        if (!ref) return 1;
        if (ref.k === 'in') return (rec.inWidths[ref.i] || 1);
        const p = rec.parts.find((q) => q.id === ref.id);
        if (!p) return 1;
        return outPortsOf(typeOf(s, p.typeId))[ref.out || 0]?.width || 1;
      };

      for (const p of rec.parts) {
        const g = partGeom(s, p);
        p.ins.forEach((ref, i) => {
          const a = anchorOf(ref);
          if (a && g.ins[i]) {
            const bus = widthOf(ref) > 1;
            V.polyline(ctx, V.route(a, g.ins[i]), { color: C.inkSoft, lw: bus ? 2.6 : 1.2 });
          }
        });
      }
      T.outs.forEach((p, i) => {
        const anchor = anchorOf(rec.outs[i]);
        if (anchor) V.polyline(ctx, V.route(anchor, p), { color: C.good, lw: (rec.outWidths[i] || 1) > 1 ? 3 : 1.6 });
      });

      if (ui.mode === 'link' && ui.drag) {
        const a = anchorOf(ui.drag.src);
        if (a) V.polyline(ctx, V.route(a, ui.drag.to), { color: C.accent, lw: 1.3, dash: [4, 4] });
      }

      for (const p of rec.parts) {
        const t = typeOf(s, p.typeId);
        const g = partGeom(s, p);
        const sel = ui.sel?.kind === 'part' && ui.sel.id === p.id;
        const ink = sel ? C.accent : C.ink;

        // leads out to the pins, then the symbol itself
        const bub = t.symbolBubbles || [];
        g.ins.forEach((q, i) => V.polyline(ctx,
          [q, { x: bub.includes(i) ? g.bubbleIn : g.bodyIn, y: q.y }],
          { color: ink, lw: q.width > 1 ? 2.6 : 1.2 }));
        g.outs.forEach((q) => V.polyline(ctx, [{ x: g.bodyOut, y: q.y }, q],
          { color: ink, lw: q.width > 1 ? 2.6 : 1.2 }));
        drawSymbol(ctx, t.symbol || 'box', { x: p.x, y: p.y, w: g.w, h: g.h },
          { color: ink, fill: C.fill, lw: sel ? 2 : 1.5, label: t.symbolLabel, font: V.MONO,
            bubbles: t.symbolBubbles || [], inputs: t.arity });

        V.label(ctx, t.name.slice(0, 16), p.x + g.w / 2, p.y - 6,
          { size: 9, align: 'center', color: sel ? C.accent : C.inkSoft, track: 0.8 });
        g.ins.forEach((q, i) => {
          V.pin(ctx, q.x, q.y, { filled: !!p.ins[i], color: p.ins[i] ? ink : C.inkFaint, r: q.width > 1 ? 4.5 : 3.5 });
          if (g.ins.length > 1) {
            V.label(ctx, g.inPorts[i].name, g.bodyIn + 4, q.y + 3, { size: 7.5, color: C.inkFaint });
          }
        });
        g.outs.forEach((q, i) => {
          V.pin(ctx, q.x, q.y, { color: ink, r: q.width > 1 ? 4.5 : 3.5 });
          if (g.outs.length > 1) {
            V.label(ctx, g.outPorts[i].name, g.bodyOut - 4, q.y + 3, { size: 7.5, color: C.inkFaint, align: 'right' });
          }
        });
      }

      if (ui.placing) {
        const t = typeOf(s, ui.placing);
        const x = Math.round((ui.world.x - 52) / SNAP) * SNAP, y = Math.round((ui.world.y - 24) / SNAP) * SNAP;
        ctx.save(); ctx.globalAlpha = 0.5;
        drawSymbol(ctx, t.symbol || 'box', { x, y, w: 104, h: Math.max(46, 14 + t.arity * 17) },
          { color: C.accent, fill: C.fill, lw: 1.4, label: t.symbolLabel, font: V.MONO,
            bubbles: t.symbolBubbles || [], inputs: t.arity });
        V.label(ctx, t.name, x + 52, y - 6, { size: 9, align: 'center', color: C.accent });
        ctx.restore();
      }
      ctx.restore();

      // The sheet border and title block are drafting-room furniture; a phone
      // has no room for them.
      if (w >= 600) {
        V.sheet(ctx, w, h, 'NAND IDLE — RECORDING BENCH', 'DESIGN SHEET',
          rec.recording ? 'REC' : 'IDLE');
      }

      if (ui.toastT > 0 && ui.toast) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, ui.toastT / 400);
        ctx.font = `12px ${V.MONO}`;
        const tw = Math.min(w - 20, ctx.measureText(ui.toast.msg).width + 40);
        const ty = w >= 600 ? 26 : 62;                 // under the record bar on a phone
        V.box(ctx, w / 2 - tw / 2, ty, tw, 30, { stroke: ui.toast.kind === 'bad' ? C.bad : C.warn });
        V.label(ctx, ui.toast.msg, w / 2, ty + 20, { size: 12, align: 'center', color: ui.toast.kind === 'bad' ? C.bad : C.warn });
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
