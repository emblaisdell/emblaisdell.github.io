// circuits.js — truth-table algebra, the precomputed catalog of common circuits,
// and combinational netlist evaluation (used only when a recording is finished).
//
// A "circuit" is identified canonically by (arity, table):
//   table is a bitmask; bit r of the table is the output for input assignment r,
//   where bit k of r is the value of input k (input 0 = least significant bit).
// Everything downstream (fab items, client specs, dedup) compares these two
// numbers, so the hot simulation loop never evaluates logic at all.

// The catalogue enumerates functions up to this many inputs; the bench allows
// more (see MAX_PORTS in netlist.js), those circuits are just never auto-named.
export const MAX_ARITY = 5;
export const NAND_ID = 'nand';
export const CLOCK_ID = 'clock';

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

export const INPUT_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K'];

// ---------------------------------------------------------------------------
// Precomputed catalog of common circuits.
// Arities 1 and 2 are exhaustive (all 4 + 16 functions); 3 and 4 are curated.
// New player-recorded circuits are looked up here to get a canonical name.
// ---------------------------------------------------------------------------

const CANON = new Map();
/** @param sym one of the kinds in symbols.js; `label` is the text for a box. */
const canon = (arity, table, name, sym = 'box', label = '') =>
  CANON.set(tableKey(arity, table), { name, symbol: sym, label: label || (sym === 'box' ? name : '') });

const pop = (bits) => bits.reduce((s, b) => s + b, 0);
const NAMES = INPUT_NAMES;

// --- generated families ------------------------------------------------------
// Minterms and maxterms first: they cover every "one row true" and "one row
// false" function, and the specific names below overwrite the ones that have a
// better name (a minterm of all-positive literals is just AND).
for (let arity = 1; arity <= 4; arity++) {
  const rows = rowCount(arity);
  for (let r = 0; r < rows; r++) {
    const lits = [];
    for (let k = 0; k < arity; k++) lits.push(((r >>> k) & 1) ? NAMES[k] : `\u00ac${NAMES[k]}`);
    canon(arity, (1 << r) >>> 0, lits.join('\u2227'), 'box', `m${r}`);
    const all = (rows >= 32 ? 0xffffffff : (1 << rows) - 1) >>> 0;
    const maxTerm = (all & ~(1 << r)) >>> 0;
    const dual = [];
    for (let k = 0; k < arity; k++) dual.push(((r >>> k) & 1) ? `\u00ac${NAMES[k]}` : NAMES[k]);
    canon(arity, maxTerm, dual.join('\u2228'), 'box', `M${r}`);
  }
}

// Constants, single literals, the n-ary gates, thresholds and counts.
for (let arity = 1; arity <= 5; arity++) {
  const n = arity;
  canon(n, tableFromFn(n, () => false), 'FALSE', 'box', '0');
  canon(n, tableFromFn(n, () => true), 'TRUE', 'box', '1');
  if (n === 1) {
    // The n-ary families all collapse to these two at one input, and would
    // otherwise overwrite them with names like NOR.
    canon(1, tableFromFn(1, ([a]) => !!a), 'BUFFER', 'buffer');
    canon(1, tableFromFn(1, ([a]) => !a), 'NOT', 'not');
    continue;
  }
  for (let k = 0; k < n; k++) {
    canon(n, tableFromFn(n, (b) => !!b[k]), NAMES[k], 'buffer');
    canon(n, tableFromFn(n, (b) => !b[k]), `NOT ${NAMES[k]}`, 'not');
  }
  const suffix = n > 2 ? String(n) : '';
  canon(n, tableFromFn(n, (b) => pop(b) === n), `AND${suffix}`, 'and');
  canon(n, tableFromFn(n, (b) => pop(b) > 0), `OR${suffix}`, 'or');
  canon(n, tableFromFn(n, (b) => pop(b) < n), `NAND${suffix}`, 'nand');
  canon(n, tableFromFn(n, (b) => pop(b) === 0), `NOR${suffix}`, 'nor');
  if (n >= 2) {
    canon(n, tableFromFn(n, (b) => pop(b) % 2 === 1), n === 2 ? 'XOR' : `PARITY${suffix}`, n === 2 ? 'xor' : 'box', n === 2 ? '' : '=1');
    canon(n, tableFromFn(n, (b) => pop(b) % 2 === 0), n === 2 ? 'XNOR' : `EVEN PARITY${suffix}`, n === 2 ? 'xnor' : 'box', n === 2 ? '' : '2k');
  }
  for (let k = 2; k < n; k++) {
    canon(n, tableFromFn(n, (b) => pop(b) >= k), `AT LEAST ${k} OF ${n}`, 'box', `\u2265${k}`);
    canon(n, tableFromFn(n, (b) => pop(b) < k), `FEWER THAN ${k} OF ${n}`, 'box', `<${k}`);
  }
  for (let k = 1; k < n; k++) {
    canon(n, tableFromFn(n, (b) => pop(b) === k), `EXACTLY ${k} OF ${n}`, 'box', `=${k}`);
  }
}

// The two-input functions that have their own names.
canon(2, tableFromFn(2, ([a, b]) => a || !b), 'B IMPLIES A', 'box', 'B\u21d2A');
canon(2, tableFromFn(2, ([a, b]) => !a || b), 'A IMPLIES B', 'box', 'A\u21d2B');

// Arithmetic and selection, where the shape of the job matters more than the
// count of ones.
canon(3, tableFromFn(3, (b) => pop(b) % 2 === 1), 'ADDER SUM', 'box', '=1');
canon(3, tableFromFn(3, (b) => pop(b) >= 2), 'ADDER CARRY', 'box', '\u22652');
canon(3, tableFromFn(3, ([a, b, s]) => (s ? !!b : !!a)), 'MUX 2:1', 'mux');
canon(3, tableFromFn(3, ([a, b, s]) => (s ? !b : !a)), 'MUX 2:1 INVERTING', 'mux', 'MUX');
canon(4, tableFromFn(4, ([a0, a1, b0, b1]) => a0 === b0 && a1 === b1), 'EQUAL 2-BIT', 'box', 'A=B');
canon(4, tableFromFn(4, ([a0, a1, b0, b1]) => (a1 * 2 + a0) > (b1 * 2 + b0)), 'GREATER 2-BIT', 'box', 'A>B');
canon(4, tableFromFn(4, ([a0, a1, b0, b1]) => (a1 * 2 + a0) < (b1 * 2 + b0)), 'LESS 2-BIT', 'box', 'A<B');
canon(4, tableFromFn(4, ([a0, a1, b0, b1]) => ((a1 * 2 + a0) + (b1 * 2 + b0)) % 2 === 1), 'SUM BIT 0 (2-BIT)', 'box', 'S0');
canon(4, tableFromFn(4, ([a, b, c, d]) => (a && b) || (c && d)), 'AND-OR-INVERT PAIR', 'box', 'AOI');

const BASES = [
  { kind: 'and', name: 'AND', fn: (b) => b.every((x) => x) },
  { kind: 'or', name: 'OR', fn: (b) => b.some((x) => x) },
];
const INVERTED = { and: 'nand', or: 'nor', xor: 'xnor' };

/**
 * Is this circuit one of the standard gates with some of its inputs inverted?
 * An AND that wants NOT B is still an AND — drawn with a bubble on that input,
 * which is how a drawing says it. Returns the fewest bubbles that explain the
 * behaviour.
 */
export function decomposeGate(arity, table) {
  if (arity < 2 || arity > 6) return null;
  const rows = rowCount(arity);
  const t = table >>> 0;
  let best = null;
  const consider = (cand) => {
    const weight = cand.bubbles.length + (cand.invOut ? 0.5 : 0);
    if (!best || weight < best.weight) best = { ...cand, weight };
  };

  // XOR does not care which inputs are inverted, only how many
  const parity = tableFromFn(arity, (b) => b.reduce((s, x) => s + x, 0) % 2 === 1);
  if (t === parity) consider({ base: 'xor', kind: 'xor', name: `XOR${arity > 2 ? arity : ''}`, bubbles: [], invOut: false });
  if (t === ((~parity & (rows >= 32 ? 0xffffffff : (1 << rows) - 1)) >>> 0)) {
    consider({ base: 'xor', kind: 'xnor', name: `XNOR${arity > 2 ? arity : ''}`, bubbles: [], invOut: true });
  }

  for (const base of BASES) {
    for (let mask = 0; mask < rows && mask < (1 << arity); mask++) {
      const flipped = tableFromFn(arity, (b) => base.fn(b.map((x, i) => ((mask >>> i) & 1 ? 1 - x : x))));
      const bubbles = [];
      for (let i = 0; i < arity; i++) if ((mask >>> i) & 1) bubbles.push(i);
      const label = bubbles.map((i) => `\u00ac${INPUT_NAMES[i]}`).join(',');
      if (t === flipped) {
        consider({
          base: base.kind, kind: base.kind, bubbles, invOut: false,
          name: bubbles.length ? `${base.name} (${label})` : base.name + (arity > 2 ? arity : ''),
        });
      }
      const inv = ((~flipped & (rows >= 32 ? 0xffffffff : (1 << rows) - 1)) >>> 0);
      if (t === inv) {
        consider({
          base: base.kind, kind: INVERTED[base.kind], bubbles, invOut: true,
          name: bubbles.length ? `${INVERTED[base.kind].toUpperCase()} (${label})` : INVERTED[base.kind].toUpperCase() + (arity > 2 ? arity : ''),
        });
      }
    }
  }
  return best;
}

/**
 * The catalogued circuit with this behaviour, or null. Matching is on the truth
 * table alone — behaviour, not structure — which is what lets a player-built
 * circuit be recognised as an AND however they wired it. A circuit that is a
 * standard gate with inverted inputs keeps its catalogue name but is drawn as
 * that gate, bubbles and all.
 */
export function canonicalGate(arity, table) {
  const exact = CANON.get(tableKey(arity, table)) || null;
  if (exact && exact.symbol !== 'box') return { ...exact, bubbles: [] };
  const gate = decomposeGate(arity, table);
  if (!gate) return exact;
  return {
    name: exact ? exact.name : gate.name,
    symbol: gate.kind,
    label: '',
    bubbles: gate.bubbles,
  };
}
/** Canonical name for a circuit, if it is one of the precomputed common ones. */
export function canonicalName(arity, table) {
  return CANON.get(tableKey(arity, table))?.name || null;
}
export function catalogSize() { return CANON.size; }

// Netlist evaluation lives in netlist.js: designs are flattened to NAND gates
// and simulated, so feedback works and a latch can hold its state.

/**
 * Which inputs the output actually depends on. A circuit that ignores an input
 * is a different function from the one the player probably meant, and this is
 * what explains a missing catalogue match.
 */
export function essentialInputs(arity, table) {
  const out = [];
  for (let k = 0; k < arity; k++) {
    for (let r = 0; r < rowCount(arity); r++) {
      if (bitAt(table, r) !== bitAt(table, r ^ (1 << k))) { out.push(k); break; }
    }
  }
  return out;
}

/** The same behaviour restricted to the inputs it actually uses. */
export function reduceToEssential(arity, table) {
  const keep = essentialInputs(arity, table);
  if (keep.length === arity) return { arity, table, keep };
  let reduced = 0;
  for (let r = 0; r < rowCount(keep.length); r++) {
    let full = 0;
    keep.forEach((k, i) => { if ((r >>> i) & 1) full |= 1 << k; });
    if (bitAt(table, full)) reduced = (reduced | (1 << r)) >>> 0;
  }
  return { arity: keep.length, table: reduced >>> 0, keep };
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
