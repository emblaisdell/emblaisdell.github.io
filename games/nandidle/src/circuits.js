// circuits.js — truth-table algebra, the precomputed catalog of common circuits,
// and combinational netlist evaluation (used only when a recording is finished).
//
// A "circuit" is identified canonically by (arity, table):
//   table is a bitmask; bit r of the table is the output for input assignment r,
//   where bit k of r is the value of input k (input 0 = least significant bit).
// Everything downstream (fab items, client specs, dedup) compares these two
// numbers, so the hot simulation loop never evaluates logic at all.

export const MAX_ARITY = 5;          // 32 rows; tables stay inside a uint32
export const NAND_ID = 'nand';

export const rowCount = (arity) => 1 << arity;
export const bitAt = (table, row) => (table >>> row) & 1;
export const maskFor = (arity) => (arity >= 5 ? 0xffffffff : ((1 << rowCount(arity)) - 1)) >>> 0;
export const tableKey = (arity, table) => arity + ':' + (table >>> 0);

/** Build a table from a predicate over an array of input bits. */
export function tableFromFn(arity, fn) {
  let t = 0;
  for (let r = 0; r < rowCount(arity); r++) {
    const bits = [];
    for (let k = 0; k < arity; k++) bits.push((r >>> k) & 1);
    if (fn(bits)) t = (t | (1 << r)) >>> 0;
  }
  return t >>> 0;
}

/** Human-readable input assignment for row r, e.g. "A=0 B=1 C=1". */
export function rowLabel(arity, r, names = INPUT_NAMES) {
  const parts = [];
  for (let k = 0; k < arity; k++) parts.push(`${names[k]}=${(r >>> k) & 1}`);
  return parts.join(' ');
}

export const INPUT_NAMES = ['A', 'B', 'C', 'D', 'E'];

// ---------------------------------------------------------------------------
// Precomputed catalog of common circuits.
// Arities 1 and 2 are exhaustive (all 4 + 16 functions); 3 and 4 are curated.
// New player-recorded circuits are looked up here to get a canonical name.
// ---------------------------------------------------------------------------

const CANON = new Map();
const canon = (arity, table, name) => CANON.set(tableKey(arity, table), name);

// arity 1 — all four functions
canon(1, tableFromFn(1, () => false), 'FALSE');
canon(1, tableFromFn(1, ([a]) => !a), 'NOT');
canon(1, tableFromFn(1, ([a]) => !!a), 'BUFFER');
canon(1, tableFromFn(1, () => true), 'TRUE');

// arity 2 — all sixteen functions
const A2 = [
  [() => false, 'FALSE'], [([a, b]) => !a && !b, 'NOR'], [([a, b]) => a && !b, 'A AND NOT B'],
  [([a, b]) => !b, 'NOT B'], [([a, b]) => !a && b, 'NOT A AND B'], [([a]) => !a, 'NOT A'],
  [([a, b]) => !!(a ^ b), 'XOR'], [([a, b]) => !(a && b), 'NAND'], [([a, b]) => !!(a && b), 'AND'],
  [([a, b]) => !(a ^ b), 'XNOR'], [([a]) => !!a, 'A'], [([a, b]) => a || !b, 'B IMPLIES A'],
  [([a, b]) => !!b, 'B'], [([a, b]) => !a || b, 'A IMPLIES B'], [([a, b]) => !!(a || b), 'OR'],
  [() => true, 'TRUE'],
];
for (const [fn, name] of A2) canon(2, tableFromFn(2, fn), name);

// arity 3 — the useful ones
const pop = (bits) => bits.reduce((s, b) => s + b, 0);
canon(3, tableFromFn(3, (b) => pop(b) === 3), 'AND3');
canon(3, tableFromFn(3, (b) => pop(b) > 0), 'OR3');
canon(3, tableFromFn(3, (b) => pop(b) < 3), 'NAND3');
canon(3, tableFromFn(3, (b) => pop(b) === 0), 'NOR3');
canon(3, tableFromFn(3, (b) => pop(b) % 2 === 1), 'XOR3 / ADDER SUM');
canon(3, tableFromFn(3, (b) => pop(b) >= 2), 'MAJORITY / ADDER CARRY');
canon(3, tableFromFn(3, ([a, b, s]) => (s ? !!b : !!a)), 'MUX 2:1');

// arity 4
canon(4, tableFromFn(4, (b) => pop(b) === 4), 'AND4');
canon(4, tableFromFn(4, (b) => pop(b) > 0), 'OR4');
canon(4, tableFromFn(4, (b) => pop(b) % 2 === 1), 'XOR4 / PARITY');
canon(4, tableFromFn(4, ([a0, a1, b0, b1]) => a0 === b0 && a1 === b1), 'EQUAL 2-BIT');
canon(4, tableFromFn(4, ([a0, a1, b0, b1]) => (a1 * 2 + a0) > (b1 * 2 + b0)), 'GREATER 2-BIT');
canon(4, tableFromFn(4, (b) => pop(b) >= 3), 'MAJORITY4');

/** Canonical name for a circuit, if it is one of the precomputed common ones. */
export function canonicalName(arity, table) {
  return CANON.get(tableKey(arity, table)) || null;
}
export function catalogSize() { return CANON.size; }

// ---------------------------------------------------------------------------
// Netlist evaluation — only runs once, when a recording is finished.
// net = { arity, parts: [{id, typeId, ins:[ref|null]}], out: ref|null }
// ref = {k:'in', i} | {k:'part', id}
// ---------------------------------------------------------------------------

export function evalNetlist(net, typeOf) {
  if (!net.out) return { ok: false, error: 'The OUT terminal is not connected.' };
  const byId = new Map(net.parts.map((p) => [p.id, p]));

  // Structural checks first, so the player gets one clear message.
  const reach = new Set();
  const stack = [net.out];
  const path = new Set();
  const visit = (ref, chain) => {
    if (!ref) return 'unconnected';
    if (ref.k === 'in') return null;
    if (chain.has(ref.id)) return 'cycle';
    if (reach.has(ref.id)) return null;
    const part = byId.get(ref.id);
    if (!part) return 'missing';
    chain.add(ref.id);
    const type = typeOf(part.typeId);
    for (let i = 0; i < type.arity; i++) {
      const e = visit(part.ins[i], chain);
      if (e) return e === 'unconnected' ? `unconnected:${part.id}:${i}` : e;
    }
    chain.delete(ref.id);
    reach.add(ref.id);
    return null;
  };
  const err = visit(net.out, path);
  if (err === 'unconnected') return { ok: false, error: 'The OUT terminal is not connected.' };
  if (err === 'cycle') return { ok: false, error: 'Feedback loop: circuits must be combinational.' };
  if (err && err.startsWith('unconnected:')) {
    const [, id, pin] = err.split(':');
    const part = byId.get(id);
    const t = typeOf(part.typeId);
    return { ok: false, error: `${t.name} has an unconnected input (${INPUT_NAMES[+pin]}).`, partId: id };
  }
  if (err === 'missing') return { ok: false, error: 'Dangling connection.' };

  const arity = net.arity;
  let table = 0;
  const memo = new Map();
  for (let r = 0; r < rowCount(arity); r++) {
    memo.clear();
    const value = (ref) => {
      if (ref.k === 'in') return (r >>> ref.i) & 1;
      if (memo.has(ref.id)) return memo.get(ref.id);
      const part = byId.get(ref.id);
      const type = typeOf(part.typeId);
      let idx = 0;
      for (let k = 0; k < type.arity; k++) idx |= value(part.ins[k]) << k;
      const v = bitAt(type.table, idx);
      memo.set(ref.id, v);
      return v;
    };
    if (value(net.out)) table = (table | (1 << r)) >>> 0;
  }

  // Which parts actually drive the output — unreachable parts are not ingredients.
  const used = new Map();
  for (const id of reach) {
    const p = byId.get(id);
    used.set(p.typeId, (used.get(p.typeId) || 0) + 1);
  }
  return { ok: true, arity, table: table >>> 0, used, usedIds: reach };
}

/** First input assignment where two circuits of the same arity disagree. */
export function firstDifference(arity, wanted, got) {
  for (let r = 0; r < rowCount(arity); r++) {
    if (bitAt(wanted, r) !== bitAt(got, r)) {
      return { row: r, wanted: bitAt(wanted, r), got: bitAt(got, r) };
    }
  }
  return null;
}
