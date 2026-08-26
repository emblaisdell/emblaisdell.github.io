// netlist.js — flattening a design down to NAND gates, and simulating it.
//
// Every circuit is ultimately NANDs, so a recorded design is inlined into one
// flat gate list at record time. That makes simulation uniform and, more to the
// point, makes feedback work: a latch is a loop of NANDs, and a loop only means
// anything if the whole thing is stepped together.
//
//   flat = { arity, gates: [{a, b}], outs: [ref] }
//   ref  = { k: 'in', i } | { k: 'g', i } | { k: 'const', v }
//
// Gates update synchronously with unit delay: a step reads the previous values
// and writes the next ones. Combinational designs settle; sequential ones carry
// their state between steps; a ring of an odd number of inversions never
// settles, and is reported as unstable rather than hung.

import { NAND_ID, CLOCK_ID, rowCount, INPUT_NAMES } from './circuits.js';

export const MAX_PORTS = 10;          // inputs, and outputs, counted per port
export const MAX_WIDTH = 8;           // bits in one port: a byte
export const TRACE_STEPS = 64;        // how long a sequential circuit is watched
export const BIG_GATES = 2000;        // past this, identity is sampled more coarsely
export const ENUMERATE_MAX_BITS = 12; // above this, behaviour is sampled, not enumerated
const SETTLE_CAP = 400;

/** Ports are named groups of wires; a width of one is an ordinary wire. */
export const portsOf = (names, widths) =>
  names.map((name, i) => ({ name, width: (widths && widths[i]) || 1 }));
export const bitsIn = (ports) => ports.reduce((n, p) => n + p.width, 0);
export function portOffsets(ports) {
  const offs = [];
  let at = 0;
  for (const p of ports) { offs.push(at); at += p.width; }
  return offs;
}

export const ZERO = { k: 'const', v: 0 };

const readRef = (ref, gates, inputs) => {
  if (!ref) return 0;
  if (ref.k === 'in') return inputs[ref.i] | 0;
  if (ref.k === 'const') return ref.v | 0;
  return gates[ref.i] | 0;
};

// --- compiled form -----------------------------------------------------------
// Simulation runs over integers rather than the little {k, i} objects the design
// is built from: a gate index is itself, an input is -1-i, and a constant zero
// is the sentinel. Kept beside the netlist rather than on it, so it never
// reaches a save file.

const CONST0 = -2147483648;
const compiled = new WeakMap();

const encode = (ref) => {
  if (!ref) return CONST0;
  if (ref.k === 'g') return ref.i;
  if (ref.k === 'in') return -1 - ref.i;
  return CONST0;                                  // the only constant is zero
};

export function compile(flat) {
  let c = compiled.get(flat);
  if (c) return c;
  const n = flat.gates.length;
  const code = new Int32Array(n * 2);
  for (let i = 0; i < n; i++) {
    code[i * 2] = encode(flat.gates[i].a);
    code[i * 2 + 1] = encode(flat.gates[i].b);
    if (flat.gates[i].clock) code[i * 2] = CONST0;
  }
  const isClock = new Uint8Array(n);
  for (const i of (flat.clocks || [])) isClock[i] = 1;
  c = {
    n,
    code,
    isClock,
    outs: Int32Array.from((flat.outs || []).map(encode)),
    clocks: Int32Array.from(flat.clocks || []),
  };
  compiled.set(flat, c);
  return c;
}

/**
 * Inline a design into a flat NAND list. Parts are laid out first so that a
 * wire may run backwards into a part that has not been visited yet — which is
 * the whole point of allowing feedback.
 */
// A recorded circuit is kept as the design the player drew — ten parts, say —
// rather than as the thousands of gates it flattens into. The flattened form is
// worked out when it is first needed and kept here, out of the save file.
const flats = new WeakMap();

export function flatOf(type, typeOf) {
  if (!type) return null;
  if (!type.design) return type.flat || null;      // supplied parts, and old saves
  const known = flats.get(type);
  if (known !== undefined) return known;
  const r = flatten(type.design, typeOf);
  const flat = r.ok ? r.flat : null;
  flats.set(type, flat);
  return flat;
}

export function flatten(net, typeOf) {
  const gates = [];
  const parts = net.parts;
  const byId = new Map(parts.map((p) => [p.id, p]));
  const inPorts = net.inPorts || portsOf(Array.from({ length: net.arity }, (_, i) => `IN${i}`));
  const inOffsets = portOffsets(inPorts);
  const portsOfType = (t) => t.inPorts || portsOf(Array.from({ length: t.arity }, (_, i) => `IN${i}`));
  const outPortsOfType = (t) => t.outPorts || portsOf((t.outNames || ['Y']).slice(0, t.outCount || 1));

  // 1. reserve a gate range per part
  const base = new Map();
  for (const p of parts) {
    const t = typeOf(p.typeId);
    if (!t) return { ok: false, error: 'A circuit in this design no longer exists.' };
    base.set(p.id, gates.length);
    const size = (t.id === NAND_ID || t.id === CLOCK_ID) ? 1 : (flatOf(t, typeOf)?.gates.length || 0);
    for (let i = 0; i < size; i++) gates.push({ a: ZERO, b: ZERO });
  }

  // 2. resolve refs, following pass-through wires (a design whose output is
  //    simply one of its inputs adds no gate of its own)
  // A reference names a port; resolving it yields that port's wires, in order.
  const resolving = new Set();
  const resolve = (ref) => {
    if (!ref) return null;
    if (ref.k === 'in') {
      const port = inPorts[ref.i];
      if (!port) return null;
      return Array.from({ length: port.width }, (_, b) => ({ k: 'in', i: inOffsets[ref.i] + b }));
    }
    const p = byId.get(ref.id);
    if (!p) return null;
    const t = typeOf(p.typeId);
    const outIndex = ref.out || 0;
    const key = `${p.id}:${outIndex}`;
    if (resolving.has(key)) return { loop: true };
    if (t.id === NAND_ID || t.id === CLOCK_ID) return [{ k: 'g', i: base.get(p.id) }];

    const outPorts = outPortsOfType(t);
    const offs = portOffsets(outPorts);
    const port = outPorts[outIndex];
    if (!port) return null;
    const inner_flat = flatOf(t, typeOf);
    if (!inner_flat) return null;
    const wires = [];
    resolving.add(key);
    for (let b = 0; b < port.width; b++) {
      const inner = inner_flat.outs[offs[outIndex] + b];
      if (!inner) { resolving.delete(key); return null; }
      if (inner.k === 'g') { wires.push({ k: 'g', i: base.get(p.id) + inner.i }); continue; }
      if (inner.k === 'const') { wires.push(inner); continue; }
      // the sub-design passes one of its own wires straight out: find which of
      // its input ports that wire belongs to, and follow the wire feeding it
      const innerPorts = portsOfType(t);
      const innerOffs = portOffsets(innerPorts);
      let pi = 0;
      while (pi + 1 < innerPorts.length && innerOffs[pi + 1] <= inner.i) pi++;
      const upstream = resolve(p.ins[pi]);
      if (!upstream || upstream.loop) { resolving.delete(key); return upstream || null; }
      wires.push(upstream[inner.i - innerOffs[pi]] || ZERO);
    }
    resolving.delete(key);
    return wires;
  };

  // 3. fill each part's gates in
  for (const p of parts) {
    const t = typeOf(p.typeId);
    const at = base.get(p.id);
    const ports = portsOfType(t);
    const args = [];
    for (let i = 0; i < ports.length; i++) {
      const r = resolve(p.ins[i]);
      if (r && r.loop) return { ok: false, error: 'A wire loops back on itself without passing through a gate.' };
      const wires = Array.isArray(r) ? r : [];
      for (let b = 0; b < ports[i].width; b++) args.push(wires[b] || ZERO);
    }
    if (t.id === CLOCK_ID) {
      // A clock is not a gate: it holds its value while the design settles and
      // flips once per step, which is what defines a tick in this game.
      gates[at] = { a: ZERO, b: ZERO, clock: true };
      continue;
    }
    if (t.id === NAND_ID) {
      gates[at] = { a: args[0], b: args[1] };
      continue;
    }
    const map = (ref) => {
      if (!ref) return ZERO;
      if (ref.k === 'g') return { k: 'g', i: at + ref.i };
      if (ref.k === 'in') return args[ref.i] || ZERO;
      return ref;
    };
    const childFlat = flatOf(t, typeOf);
    if (!childFlat) return { ok: false, error: `${t.name} cannot be built.`, partId: p.id };
    childFlat.gates.forEach((g, i) => { gates[at + i] = { a: map(g.a), b: map(g.b) }; });
  }

  const clocks = [];
  gates.forEach((g, i) => { if (g.clock) clocks.push(i); });
  const outPorts = net.outPorts || portsOf((net.outs || []).map((_, i) => `OUT${i}`));
  const outs = [];
  for (let i = 0; i < net.outs.length; i++) {
    const r = resolve(net.outs[i]);
    if (r && r.loop) {
      return { ok: false, error: 'A wire loops back on itself without passing through a gate.' };
    }
    const wires = Array.isArray(r) ? r : [];
    const width = outPorts[i]?.width || 1;
    for (let b = 0; b < width; b++) outs.push(wires[b] || ZERO);
  }
  return {
    ok: true,
    flat: { arity: bitsIn(inPorts), gates, outs, clocks, inPorts, outPorts },
  };
}

/** How many wires a reference carries, or null if it is unconnected. */
export function widthOfRef(ref, byId, typeOf, inPorts) {
  if (!ref) return null;
  if (ref.k === 'in') return inPorts[ref.i]?.width ?? null;
  const p = byId.get(ref.id);
  if (!p) return null;
  const t = typeOf(p.typeId);
  const outPorts = t.outPorts || portsOf((t.outNames || ['Y']).slice(0, t.outCount || 1));
  return outPorts[ref.out || 0]?.width ?? null;
}

/** Does any gate depend, however indirectly, on itself? */
/** One tick of the world: every clock changes phase. */
export function tickClocks(flat, gateState) {
  for (const i of (flat.clocks || [])) gateState[i] ^= 1;
}

export function hasFeedback(flat) {
  if (flat.clocks && flat.clocks.length) return true;   // a clock is time itself
  const state = new Int8Array(flat.gates.length);   // 0 unvisited, 1 on stack, 2 done
  const walk = (i) => {
    if (state[i] === 1) return true;
    if (state[i] === 2) return false;
    state[i] = 1;
    for (const ref of [flat.gates[i].a, flat.gates[i].b]) {
      if (ref && ref.k === 'g' && walk(ref.i)) return true;
    }
    state[i] = 2;
    return false;
  };
  for (let i = 0; i < flat.gates.length; i++) if (walk(i)) return true;
  return false;
}

/**
 * Sweep the gates until nothing changes, updating in place so each gate sees
 * the values written before it in this pass. Updating the whole array at once
 * instead would make a cross-coupled pair flip between 00 and 11 forever rather
 * than holding its state — a latch would never latch.
 */
export function settle(flat, gateState, inputs, cap = SETTLE_CAP, order = null) {
  const { n, code, isClock } = compile(flat);
  const passes = Math.min(cap, Math.max(8, n * 4));
  for (let step = 0; step < passes; step++) {
    let changed = false;
    for (let k = 0; k < n; k++) {
      const i = order ? order[k] : k;
      if (isClock[i]) continue;                    // held for the whole settle
      const a = code[i * 2];
      const b = code[i * 2 + 1];
      const av = a >= 0 ? gateState[a] : (a === CONST0 ? 0 : inputs[-1 - a]);
      let v;
      if (!av) v = 1;
      else {
        const bv = b >= 0 ? gateState[b] : (b === CONST0 ? 0 : inputs[-1 - b]);
        v = bv ? 0 : 1;
      }
      if (v !== gateState[i]) { gateState[i] = v; changed = true; }
    }
    if (!changed) return true;
  }
  return false;
}

/** Sweep orders used to tell settled behaviour from a race. */
function sweepOrders(n) {
  const forward = Array.from({ length: n }, (_, i) => i);
  const backward = forward.slice().reverse();
  const shuffled = forward.slice();
  let seed = 0x2545f491;
  for (let i = n - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return [forward, backward, shuffled];
}

/** Dependency order for a design without feedback: one pass evaluates it. */
export function topoOrder(flat) {
  const n = flat.gates.length;
  const mark = new Uint8Array(n);
  const order = [];
  const stack = [];
  for (let start = 0; start < n; start++) {
    if (mark[start]) continue;
    stack.push([start, 0]);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const [i, edge] = frame;
      if (mark[i] === 2) { stack.pop(); continue; }
      mark[i] = 1;
      const refs = [flat.gates[i].a, flat.gates[i].b];
      if (edge < 2) {
        frame[1]++;
        const r = refs[edge];
        if (r && r.k === 'g' && mark[r.i] === 0) stack.push([r.i, 0]);
        continue;
      }
      mark[i] = 2;
      order.push(i);
      stack.pop();
    }
  }
  return order;
}

export function outputsOf(flat, gateState, inputs) {
  const { outs } = compile(flat);
  const result = new Array(outs.length);
  for (let i = 0; i < outs.length; i++) {
    const r = outs[i];
    result[i] = r >= 0 ? gateState[r] : (r === CONST0 ? 0 : inputs[-1 - r] | 0);
  }
  return result;
}

export function freshState(flat) { return new Uint8Array(flat.gates.length); }

/**
 * Exhaustive behaviour of a combinational design: one bit array per output,
 * indexed by input assignment.
 */
export function truthTables(flat) {
  const rows = rowCount(flat.arity);
  const { code, outs } = compile(flat);
  const tables = flat.outs.map(() => new Uint8Array(rows));
  const order = topoOrder(flat);           // no feedback: one pass per row
  const state = freshState(flat);
  const inputs = new Uint8Array(flat.arity);
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < flat.arity; k++) inputs[k] = (r >>> k) & 1;
    for (let q = 0; q < order.length; q++) {
      const i = order[q];
      const a = code[i * 2];
      const b = code[i * 2 + 1];
      const av = a >= 0 ? state[a] : (a === CONST0 ? 0 : inputs[-1 - a]);
      if (!av) { state[i] = 1; continue; }
      const bv = b >= 0 ? state[b] : (b === CONST0 ? 0 : inputs[-1 - b]);
      state[i] = bv ? 0 : 1;
    }
    for (let o = 0; o < outs.length; o++) {
      const ref = outs[o];
      tables[o][r] = ref >= 0 ? state[ref] : (ref === CONST0 ? 0 : inputs[-1 - ref]);
    }
  }
  return { tables, stable: true };
}

// A fixed, deterministic exercise: the same sequence every time, so two
// circuits are comparable, and short enough that a big design stays cheap.
function* canonicalInputs(arity, steps) {
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed;
  };
  const rows = rowCount(Math.min(arity, 6));
  for (let s = 0; s < steps; s++) {
    const inputs = [];
    // walk the small assignments first, then wander
    const r = s < rows ? s : rnd();
    for (let k = 0; k < arity; k++) inputs.push((r >>> (k % 30)) & 1);
    yield inputs;
  }
}

/**
 * Put a circuit into a defined state before watching it: pulse each input low
 * in turn, then release everything high. A latch ends up wherever its last
 * pulse left it rather than wherever the gate order happened to land.
 */
export function prime(flat, state, order = null) {
  const inputs = new Array(flat.arity).fill(1);
  settle(flat, state, inputs, SETTLE_CAP, order);
  for (let i = 0; i < flat.arity; i++) {
    inputs.fill(1);
    inputs[i] = 0;
    settle(flat, state, inputs, SETTLE_CAP, order);
  }
  inputs.fill(1);
  settle(flat, state, inputs, SETTLE_CAP, order);
}

function traceOnce(flat, steps, order, start) {
  const state = start ? Uint8Array.from(start) : freshState(flat);
  prime(flat, state, order);
  const rows = [];
  let stable = true;
  for (const inputs of canonicalInputs(flat.arity, steps)) {
    tickClocks(flat, state);
    if (!settle(flat, state, inputs, SETTLE_CAP, order)) stable = false;
    rows.push({ inputs: inputs.slice(), outs: outputsOf(flat, state, inputs) });
  }
  return { rows, stable };
}

/**
 * What a design does over a standard exercise — and, separately, which steps of
 * it are a race.
 *
 * Gates are swept in a fixed order, so a design that only works because one gate
 * happens to be visited before another would otherwise be given a behaviour it
 * does not really have. Running the same exercise under three sweep orders
 * separates what the circuit does from what the sweep does: steps where the
 * orders disagree are marked, and left out of the signature. Two correct latches
 * wired in a different order then agree on everything that is actually theirs.
 */
export function trace(flat, steps = TRACE_STEPS) {
  // A big design is watched for less time and under one sweep order rather than
  // three. Identity matters least exactly where it costs most: a twenty-thousand
  // gate memory is not going to be mistaken for a catalogue entry, and the
  // orders that judge it do so by their own test anyway.
  const big = flat.gates.length > BIG_GATES;
  const watch = big ? Math.max(12, Math.round(steps / 4)) : steps;
  const orders = big ? [null] : sweepOrders(flat.gates.length);
  const runs = orders.map((o) => traceOnce(flat, watch, o));
  const base = runs[0];
  const raced = [];
  for (let i = 0; i < base.rows.length; i++) {
    const key = base.rows[i].outs.join('');
    if (runs.some((r) => r.rows[i].outs.join('') !== key)) raced.push(i);
  }
  // starting from all ones as well: a design that cannot be primed into a known
  // state is start-dependent, and says so
  const fromOnes = traceOnce(flat, watch, orders[0], new Uint8Array(flat.gates.length).fill(1));
  const startDependent = fromOnes.rows.some((row, i) => row.outs.join('') !== base.rows[i].outs.join(''));
  return {
    rows: base.rows,
    stable: runs.every((r) => r.stable),
    raced,
    startDependent,
    coarse: big,
  };
}

/**
 * Run a circuit against a written test: a list of input vectors, applied in
 * order from a primed state. This — not comparing one circuit to another — is
 * how a design is judged against an order, because a circuit that holds state
 * has no canonical form to compare.
 */
export function runVectors(flat, vectors) {
  const state = freshState(flat);
  prime(flat, state);
  const outs = [];
  let stable = true;
  for (const inputs of vectors) {
    tickClocks(flat, state);
    if (!settle(flat, state, inputs)) stable = false;
    outs.push(outputsOf(flat, state, inputs));
  }
  return { outs, stable };
}

/**
 * Does this circuit do what the test asks? `expect` rows may hold null for a
 * don't-care: an output nobody has an opinion about.
 */
export function checkVectors(flat, vectors, expect) {
  const { outs } = runVectors(flat, vectors);
  const fails = [];
  for (let i = 0; i < expect.length; i++) {
    for (let o = 0; o < expect[i].length; o++) {
      const want = expect[i][o];
      if (want === null || want === undefined) continue;
      if ((outs[i][o] | 0) !== (want | 0)) fails.push({ step: i, out: o, want, got: outs[i][o] | 0, inputs: vectors[i] });
    }
  }
  return { fails, outs, steps: expect.length };
}

export function hashTrace(rows, skip = []) {
  const raced = new Set(skip);
  let h = 2166136261;
  const mix = (v) => { h ^= v; h = Math.imul(h, 16777619) >>> 0; };
  rows.forEach((r, i) => {
    if (raced.has(i)) return;                     // a race is not behaviour
    mix(i + 7);
    for (const b of r.inputs) mix(b + 1);
    for (const b of r.outs) mix(b + 3);
  });
  return (h >>> 0).toString(16).padStart(8, '0');
}

const tableHex = (t) => {
  let out = '';
  for (let i = 0; i < t.length; i += 4) {
    out += ((t[i] || 0) | ((t[i + 1] || 0) << 1) | ((t[i + 2] || 0) << 2) | ((t[i + 3] || 0) << 3)).toString(16);
  }
  return out;
};

/**
 * The one string that says what a circuit does. Combinational circuits are
 * described exhaustively; sequential ones by their response to the standard
 * exercise, because their state space is not worth enumerating.
 */
export function behaviourOf(flat) {
  const sequential = hasFeedback(flat);
  // A truth table is only worth having while it can be written down: a design
  // with two byte-wide inputs has 65536 rows, and a stream has no last row at
  // all. Past that, behaviour is sampled the way a stateful circuit's is.
  if (!sequential && flat.arity <= ENUMERATE_MAX_BITS) {
    const { tables, stable } = truthTables(flat);
    return {
      kind: 'comb',
      stable,
      tables,
      sig: `c${flat.arity}.${tables.map(tableHex).join('.')}`,
    };
  }
  const { rows, stable, raced, startDependent, coarse } = trace(flat);
  return {
    kind: sequential ? 'seq' : 'wide',
    coarse,
    stable,
    rows,
    raced,
    startDependent,
    orderSensitive: raced.length > 0,
    sig: `${sequential ? 's' : 'w'}${flat.arity}.${flat.outs.length}.${hashTrace(rows, raced)}`,
  };
}

/** A specification, written as a signature in the same language. */
export function sigFromTables(arity, tables) {
  return `c${arity}.${tables.map(tableHex).join('.')}`;
}
export const sigFromTable = (arity, bits) => sigFromTables(arity, [bits]);

/** Bits of a truth table, from a predicate over input bits. */
export function bitsFromFn(arity, fn) {
  const rows = rowCount(arity);
  const out = new Uint8Array(rows);
  for (let r = 0; r < rows; r++) {
    const bits = [];
    for (let k = 0; k < arity; k++) bits.push((r >>> k) & 1);
    out[r] = fn(bits) ? 1 : 0;
  }
  return out;
}

/**
 * Check a design over, flatten it, and work out what it does. Replaces the old
 * combinational-only evaluation: loops are allowed now, and a design that never
 * settles is reported as free-running rather than refused.
 */
export const shapeOf = (inPorts, outPorts) =>
  `${inPorts.map((p) => p.width).join(',')}>${outPorts.map((p) => p.width).join(',')}`;

export function analyse(net, typeOf) {
  const outs = net.outs.filter(Boolean);
  if (!outs.length) return { ok: false, error: 'No output terminal is connected.' };
  const byId = new Map(net.parts.map((p) => [p.id, p]));
  const inPorts = net.inPorts || portsOf(Array.from({ length: net.arity }, (_, i) => INPUT_NAMES[i] || `IN${i}`));
  const outPorts = net.outPorts || portsOf(net.outs.map((_, i) => `OUT${i}`));

  // reachable parts, walking back from the outputs; unconnected inputs are the
  // one structural error left
  const seen = new Set();
  const queue = net.outs.filter(Boolean).slice();
  while (queue.length) {
    const ref = queue.pop();
    if (!ref || ref.k !== 'part') continue;
    if (seen.has(ref.id)) continue;
    const part = byId.get(ref.id);
    if (!part) return { ok: false, error: 'Dangling connection.' };
    seen.add(ref.id);
    const t = typeOf(part.typeId);
    if (!t) return { ok: false, error: 'A circuit in this design no longer exists.', partId: part.id };
    const portCount = (t.inPorts || []).length || t.arity;
    for (let i = 0; i < portCount; i++) {
      const in_ = part.ins[i];
      if (!in_) {
        return {
          ok: false,
          error: `${t.name} has an unconnected input (${(t.inNames && t.inNames[i]) || INPUT_NAMES[i]}).`,
          partId: part.id,
        };
      }
      queue.push(in_);
    }
  }

  // A wire may only join ports of the same width.
  for (const id of seen) {
    const part = byId.get(id);
    const t = typeOf(part.typeId);
    const ports = t.inPorts || portsOf(Array.from({ length: t.arity }, () => 'IN'));
    for (let i = 0; i < ports.length; i++) {
      const ref = part.ins[i];
      const w = widthOfRef(ref, byId, typeOf, inPorts);
      if (w !== null && w !== ports[i].width) {
        return {
          ok: false,
          error: `${t.name}: a ${w}-wire bundle cannot feed a ${ports[i].width}-wire input.`,
          partId: part.id,
        };
      }
    }
  }
  for (let i = 0; i < net.outs.length; i++) {
    const want = outPorts[i]?.width || 1;
    const w = widthOfRef(net.outs[i], byId, typeOf, inPorts);
    if (w !== null && w !== want) {
      return {
        ok: false,
        error: `${outPorts[i]?.name || `OUT ${i + 1}`}: a ${w}-wire bundle cannot feed a ${want}-wire terminal.`,
      };
    }
  }

  const live = {
    arity: net.arity, inPorts, outPorts,
    parts: net.parts.filter((p) => seen.has(p.id)), outs: net.outs,
  };
  const flatRes = flatten(live, typeOf);
  if (!flatRes.ok) return flatRes;
  const flat = flatRes.flat;

  const behaviour = behaviourOf(flat);
  const used = new Map();
  for (const id of seen) {
    const p = byId.get(id);
    used.set(p.typeId, (used.get(p.typeId) || 0) + 1);
  }
  return {
    ok: true,
    arity: inPorts.length,
    design: live,                                  // what the player drew
    inBits: flat.arity,
    inPorts,
    outPorts,
    shape: shapeOf(inPorts, outPorts),
    outCount: outPorts.length,
    kind: behaviour.kind,
    stable: behaviour.stable,
    raced: behaviour.raced || [],
    coarse: !!behaviour.coarse,
    orderSensitive: !!behaviour.orderSensitive,
    startDependent: !!behaviour.startDependent,
    sig: behaviour.sig,
    tables: behaviour.tables || null,
    rows: behaviour.rows || null,
    // A truth-table integer only describes a circuit whose ports are all single
    // wires. On a bus it would be the low bit's table wearing the whole
    // circuit's name, which is how a two-port bus design could be catalogued as
    // an AND.
    table: behaviour.kind === 'comb' && outPorts.length === 1 && flat.arity <= 5
      && inPorts.every((p) => p.width === 1) && outPorts.every((p) => p.width === 1)
      ? tableInt(behaviour.tables) : null,
    flat,
    used,
    usedIds: seen,
  };
}

/** Legacy single-output integer table, for the catalogue and the truth-table UI. */
export function tableInt(tables) {
  const t = tables[0];
  let v = 0;
  for (let r = 0; r < t.length && r < 32; r++) if (t[r]) v = (v | (1 << r)) >>> 0;
  return v >>> 0;
}

export { INPUT_NAMES };
