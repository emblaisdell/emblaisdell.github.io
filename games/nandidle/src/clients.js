// clients.js — the client progression. Each client names a target circuit; the
// player designates one of their own circuits to ship, and it pays only if it is
// that exact (arity, table).

import { tableFromFn } from './circuits.js';
import { bitsFromFn, sigFromTables, portsOf, shapeOf } from './netlist.js';
import { seqSpec } from './seqCatalogue.js';

const pop = (b) => b.reduce((s, x) => s + x, 0);

export const CLIENT_CATALOG = [
  {
    company: 'INVERSE HOLDINGS', name: 'NOT', gates: 1, ins: ['A'], out: 'Y', arity: 1,
    fn: ([a]) => !a, need: 15, pay: 2,
    brief: 'We need signal inverters. One input, one output, opposite.',
  },
  {
    company: 'CONJUNCTION LTD', name: 'AND', gates: 2, ins: ['A', 'B'], out: 'Y', arity: 2,
    fn: ([a, b]) => !!(a && b), need: 25, pay: 3,
    brief: 'Both or nothing.',
  },
  {
    company: 'UNION WORKS', name: 'OR', gates: 3, ins: ['A', 'B'], out: 'Y', arity: 2,
    fn: ([a, b]) => !!(a || b), need: 30, pay: 5,
    brief: 'Either will do.',
  },
  {
    company: 'DIFFERENCE ENGINE CO', name: 'XOR', gates: 4, ins: ['A', 'B'], out: 'Y', arity: 2,
    fn: ([a, b]) => !!(a ^ b), need: 40, pay: 7,
    brief: 'High when the inputs disagree. Harder than it looks.',
  },
  {
    company: 'CARRY & SONS', name: 'ADDER CARRY', gates: 11, ins: ['A', 'B', 'CIN'], out: 'COUT', arity: 3,
    fn: (b) => pop(b) >= 2, need: 45, pay: 10,
    brief: 'Majority of three. The carry half of a full adder.',
  },
  {
    company: 'SIGMA ARITHMETIC', name: 'ADDER SUM', gates: 8, ins: ['A', 'B', 'CIN'], out: 'SUM', arity: 3,
    fn: (b) => pop(b) % 2 === 1, need: 50, pay: 15,
    brief: 'Odd parity of three inputs. The sum half of a full adder.',
  },
  {
    company: 'SELECTOR SYSTEMS', name: 'MUX 2:1', gates: 4, ins: ['A', 'B', 'SEL'], out: 'Y', arity: 3,
    fn: ([a, b, s]) => (s ? !!b : !!a), need: 60, pay: 11,
    brief: 'SEL picks: 0 routes A, 1 routes B.',
  },
  {
    company: 'COMPARATOR MUTUAL', name: 'EQUAL 2-BIT', gates: 12, ins: ['A0', 'A1', 'B0', 'B1'], out: 'EQ', arity: 4,
    fn: ([a0, a1, b0, b1]) => a0 === b0 && a1 === b1, need: 80, pay: 20,
    brief: 'Two 2-bit numbers A1A0 and B1B0. High when equal.',
  },
  {
    company: 'FULL SUM WORKS', name: 'FULL ADDER', gates: 15, ins: ['A', 'B', 'CIN'], out: ['SUM', 'COUT'], arity: 3,
    symbol: 'box', label: 'Σ',
    fns: [(b) => pop(b) % 2 === 1, (b) => pop(b) >= 2], need: 90, pay: 26,
    brief: 'Both halves in one part: the sum bit and the carry out. Two outputs.',
  },
  {
    company: 'HOLDFAST MEMORY', name: 'SR LATCH', gates: 2, ins: ['SET', 'RESET'], out: ['Q', 'NQ'], arity: 2,
    symbol: 'box', label: 'SR',
    seq: seqSpec('sr-latch'),
    need: 100, pay: 34,
    brief: 'Our first part that remembers. SET low makes Q high and it stays high; RESET low clears it. Never both low at once — we will not test that.',
  },
  {
    company: 'HOLDFAST MEMORY', name: 'D LATCH', gates: 4, ins: ['D', 'ENABLE'], out: ['Q'], arity: 2,
    symbol: 'box', label: 'D',
    seq: seqSpec('d-latch'),
    need: 110, pay: 44,
    brief: 'While ENABLE is high, Q follows D. When ENABLE drops, Q holds whatever it saw last.',
  },
  {
    company: 'TICKTOCK SYSTEMS', name: 'D FLIP-FLOP', gates: 9, ins: ['D', 'CLK'], out: ['Q'], arity: 2,
    unlocks: ['clock'],
    symbol: 'ff', label: 'D',
    seq: seqSpec('d-flip-flop'),
    need: 120, pay: 60,
    brief: 'Q takes D only on the rising edge of CLK, and ignores D the rest of the time. Two latches back to back, one enabled while the other is not.',
  },
  {
    company: 'NIBBLE & CO', name: '4-BIT ADDER', gates: 60, ins: ['A', 'B', 'CIN'], inWidths: [4, 4, 1],
    out: ['S', 'COUT'], outWidths: [4, 1], arity: 3,
    symbol: 'box', label: '\u03a34',
    values: ([a, b, cin]) => { const t = a + b + cin; return [t & 15, t >> 4]; },
    need: 60, pay: 90,
    unlocks: ['bundle2', 'tap2', 'bundle3', 'tap3', 'bundle4', 'tap4'],
    brief: 'Four bits at a time. Group your wires: A and B arrive as four-wide buses, and the sum goes back out as one.',
  },
  {
    company: 'PRODUCT LINE', name: '2-BIT MULTIPLIER', gates: 20, ins: ['A', 'B'], inWidths: [2, 2],
    out: ['P'], outWidths: [4], arity: 2,
    symbol: 'box', label: '\u00d7',
    values: ([a, b]) => [a * b],
    need: 60, pay: 110,
    brief: 'Two two-bit numbers in, their product out. Four bits is enough room for all of it.',
  },
  {
    company: 'HOLDFAST MEMORY', name: '4-BIT REGISTER', gates: 52, ins: ['D', 'CLK', 'LOAD'], inWidths: [4, 1, 1],
    out: ['Q'], outWidths: [4], arity: 3,
    symbol: 'ff', label: 'REG',
    seqValues: {
      skipFirst: 1,
      steps: [
        [0, 0, 1], [0, 1, 1], [5, 0, 1], [5, 1, 1], [9, 0, 0], [9, 1, 0], [9, 0, 0], [9, 1, 0],
        [12, 0, 1], [12, 1, 1], [3, 0, 0], [3, 1, 0], [3, 0, 1], [3, 1, 1],
      ],
      ref: {
        init: () => ({ q: 0, clk: 0 }),
        step: ([d, clk, load], st) => {
          const q = (clk && !st.clk && load) ? d : st.q;
          return { outs: [q], state: { q, clk } };
        },
      },
    },
    need: 70, pay: 140,
    brief: 'Four flip-flops that share a clock, and only take D when LOAD is high. Otherwise they keep what they have.',
  },
  {
    company: 'TICKTOCK SYSTEMS', name: '4-BIT COUNTER', gates: 66, ins: ['CLK', 'RESETB'], inWidths: [1, 1],
    out: ['Q'], outWidths: [4], arity: 2,
    symbol: 'ff', label: '+1',
    seqValues: {
      skipFirst: 2,
      steps: (() => {
        const steps = [[0, 0], [1, 0], [0, 1]];
        for (let i = 0; i < 20; i++) steps.push([i % 2 ? 1 : 0, 1]);
        return steps;
      })(),
      ref: {
        init: () => ({ q: 0, clk: 0 }),
        step: ([clk, resetb], st) => {
          let q = st.q;
          if (!resetb) q = 0;
          else if (clk && !st.clk) q = (q + 1) & 15;
          return { outs: [q], state: { q, clk } };
        },
      },
    },
    need: 80, pay: 180,
    brief: 'Counts rising edges, wrapping at sixteen. RESETB low clears it.',
  },
  {
    company: 'STREAMWORKS', name: 'BYTE INCREMENT', gates: 139, ins: ['IN'], inWidths: [8],
    out: ['OUT'], outWidths: [8], arity: 1,
    symbol: 'box', label: '+1',
    stream: true,
    values: ([x]) => [(x + 1) & 255],
    need: 90, pay: 220, unlocks: ['bundle5', 'tap5', 'bundle6', 'tap6', 'bundle7', 'tap7', 'bundle8', 'tap8'],
    brief: 'We send a stream of bytes; send them back one higher, wrapping at 255. A byte is eight wires bundled onto one.',
  },
  {
    company: 'STREAMWORKS', name: 'RUNNING TOTAL', gates: 197, ins: ['IN', 'CLK', 'RESETB'], inWidths: [8, 1, 1],
    out: ['SUM'], outWidths: [8], arity: 3,
    symbol: 'ff', label: '\u03a3',
    stream: true,
    seqValues: {
      skipFirst: 2,
      steps: (() => {
        const data = [0, 0, 3, 3, 10, 10, 40, 40, 100, 100, 200, 200, 7, 7, 1, 1, 250, 250];
        return data.map((v, i) => [v, i % 2, i < 2 ? 0 : 1]);
      })(),
      ref: {
        init: () => ({ sum: 0, clk: 0 }),
        step: ([x, clk, resetb], st) => {
          let sum = st.sum;
          if (!resetb) sum = 0;
          else if (clk && !st.clk) sum = (sum + x) & 255;
          return { outs: [sum], state: { sum, clk } };
        },
      },
    },
    need: 100, pay: 300,
    brief: 'Add each byte of the stream to a running total as it arrives, and keep the total on the output. RESETB low clears it; it wraps at 255.',
  },
  {
    company: 'SEQUENCE HOUSE', name: 'FIBONACCI', gates: 282, ins: ['CLK', 'RESETB'], inWidths: [1, 1],
    out: ['OUT'], outWidths: [8], arity: 2,
    symbol: 'ff', label: 'FIB',
    seqValues: {
      skipFirst: 3,
      steps: (() => {
        const steps = [[0, 0], [1, 0], [0, 1]];
        for (let i = 0; i < 24; i++) steps.push([i % 2 ? 1 : 0, 1]);
        return steps;
      })(),
      ref: {
        init: () => ({ a: 0, b: 1, clk: 0 }),
        step: ([clk, resetb], st) => {
          let { a, b } = st;
          if (!resetb) { a = 0; b = 1; }
          else if (clk && !st.clk) { const next = (a + b) & 255; a = b; b = next; }
          return { outs: [a], state: { a, b, clk } };
        },
      },
    },
    need: 120, pay: 420,
    brief: 'One Fibonacci number per rising edge, wrapping at 255: 0, 1, 1, 2, 3, 5, 8. Two registers and an adder, feeding each other.',
  },
  {
    company: 'MACHINE WORKS', name: 'ACCUMULATOR', gates: 153, ins: ['OP', 'DATA', 'CLK'], inWidths: [2, 4, 1],
    out: ['ACC'], outWidths: [4], arity: 3,
    symbol: 'ff', label: 'CPU',
    seqValues: {
      skipFirst: 2,
      steps: (() => {
        // a little program: load 3, add 5, xor 6, hold, load 0, add 9
        const prog = [[1, 3], [1, 3], [2, 5], [2, 5], [3, 6], [3, 6], [0, 0], [0, 0], [1, 0], [1, 0], [2, 9], [2, 9], [2, 9], [2, 9]];
        return prog.map(([op, data], i) => [op, data, i % 2]);
      })(),
      ref: {
        init: () => ({ acc: 0, clk: 0 }),
        step: ([op, data, clk], st) => {
          let acc = st.acc;
          if (clk && !st.clk) {
            if (op === 1) acc = data;
            else if (op === 2) acc = (acc + data) & 15;
            else if (op === 3) acc = (acc ^ data) & 15;
          }
          return { outs: [acc], state: { acc, clk } };
        },
      },
    },
    need: 150, pay: 600,
    brief: 'A machine with one register. Each rising edge does what OP says: 0 nothing, 1 load DATA, 2 add DATA, 3 exclusive-or DATA. The smallest processor worth the name.',
  },
];

/** Bits of a set of port values, low bit first, ports in order. */
export function bitsOfPorts(ports, values) {
  const bits = [];
  ports.forEach((p, i) => {
    for (let b = 0; b < p.width; b++) bits.push(((values[i] || 0) >>> b) & 1);
  });
  return bits;
}

/** Port values read back out of a bit vector. */
export function valuesOfPorts(ports, bits) {
  const vals = [];
  let at = 0;
  for (const p of ports) {
    let v = 0;
    for (let b = 0; b < p.width; b++) v |= (bits[at + b] || 0) << b;
    vals.push(v);
    at += p.width;
  }
  return vals;
}

// Every order is a behaviour, expressed the same way a player's circuit is.
for (const spec of CLIENT_CATALOG) {
  spec.outs = Array.isArray(spec.out) ? spec.out : [spec.out];
  spec.inPorts = portsOf(spec.ins, spec.inWidths);
  // `gates` is what a straightforward build of this order costs; it sets the
  // floor under the maintenance rate, so filling an order never turns the
  // process that filled it into a money hole.
  spec.outPorts = portsOf(spec.outs, spec.outWidths);
  spec.shape = shapeOf(spec.inPorts, spec.outPorts);
  spec.outCount = spec.outs.length;
  const inBits = spec.inPorts.reduce((n, p) => n + p.width, 0);

  if (spec.seqValues) {
    // A sequence written in port values rather than bits: a stream of bytes is
    // easier to say, and easier to read back, than sixty-four wires.
    let st = spec.seqValues.ref.init();
    const vectors = [];
    const expect = [];
    spec.seqValues.steps.forEach((vals, i) => {
      const r = spec.seqValues.ref.step(vals, st);
      st = r.state;
      vectors.push(bitsOfPorts(spec.inPorts, vals));
      const outBits = bitsOfPorts(spec.outPorts, r.outs);
      expect.push(i < (spec.seqValues.skipFirst || 0) ? outBits.map(() => null) : outBits);
    });
    spec.seq = { vectors, expect };
    spec.kind = 'seq';
    continue;
  }

  if (spec.seq) {
    // A circuit that holds state has no truth table, so the order is written as
    // a test — the same one the catalogue uses to recognise it.
    spec.kind = 'seq';
    continue;
  }

  if (spec.values) {
    // Combinational, but written in port values. Small enough to enumerate, so
    // it is judged exactly rather than sampled.
    const rows = 1 << inBits;
    spec.bits = spec.outPorts.flatMap((p) => Array.from({ length: p.width }, () => new Uint8Array(rows)));
    for (let r = 0; r < rows; r++) {
      const ins = valuesOfPorts(spec.inPorts, Array.from({ length: inBits }, (_, b) => (r >>> b) & 1));
      const outBits = bitsOfPorts(spec.outPorts, spec.values(ins));
      outBits.forEach((v, b) => { spec.bits[b][r] = v; });
    }
    spec.sig = sigFromTables(inBits, spec.bits);
    spec.table = null;
    spec.kind = 'comb';
    continue;
  }

  const fns = spec.fns || [spec.fn];
  spec.bits = fns.map((fn) => bitsFromFn(spec.arity, fn));
  spec.sig = sigFromTables(spec.arity, spec.bits);
  spec.table = spec.bits.length === 1 ? tableFromFn(spec.arity, fns[0]) : null;
  spec.kind = 'comb';
}

export function makeClient(s, spec) {
  return {
    id: `cl${s.seq++}`,
    company: spec.company, want: spec.name, brief: spec.brief,
    arity: spec.arity, table: spec.table ?? null, sig: spec.sig || null,
    inPorts: spec.inPorts, outPorts: spec.outPorts, shape: spec.shape,
    kind: spec.kind, bits: spec.bits || null, outCount: spec.outCount, gates: spec.gates || 1,
    symbol: spec.symbol || null, label: spec.label || '',
    seq: spec.seq ? { vectors: spec.seq.vectors, expect: spec.seq.expect } : null,
    inNames: spec.ins.slice(), outNames: spec.outs.slice(), outName: spec.outs[0],
    need: spec.need, pay: spec.pay,
    delivered: 0, complete: false, rejected: 0, lastError: null, seen: false,
    report: null,          // the last testbench run, if the player paid for one
  };
}
