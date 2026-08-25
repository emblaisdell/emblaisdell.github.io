// clients.js — the client progression. Each client is a sink node in the fab
// with a target circuit; the fab must deliver that exact (arity, table).

import { tableFromFn } from './circuits.js';

const pop = (b) => b.reduce((s, x) => s + x, 0);

export const CLIENT_CATALOG = [
  {
    company: 'INVERSE HOLDINGS', name: 'NOT', ins: ['A'], out: 'Y', arity: 1,
    table: tableFromFn(1, ([a]) => !a), need: 15, pay: 6,
    brief: 'We need signal inverters. One input, one output, opposite.',
  },
  {
    company: 'CONJUNCTION LTD', name: 'AND', ins: ['A', 'B'], out: 'Y', arity: 2,
    table: tableFromFn(2, ([a, b]) => !!(a && b)), need: 25, pay: 12,
    brief: 'Both or nothing.',
  },
  {
    company: 'UNION WORKS', name: 'OR', ins: ['A', 'B'], out: 'Y', arity: 2,
    table: tableFromFn(2, ([a, b]) => !!(a || b)), need: 30, pay: 16,
    brief: 'Either will do.',
  },
  {
    company: 'DIFFERENCE ENGINE CO', name: 'XOR', ins: ['A', 'B'], out: 'Y', arity: 2,
    table: tableFromFn(2, ([a, b]) => !!(a ^ b)), need: 40, pay: 30,
    brief: 'High when the inputs disagree. Harder than it looks.',
  },
  {
    company: 'CARRY & SONS', name: 'ADDER CARRY', ins: ['A', 'B', 'CIN'], out: 'COUT', arity: 3,
    table: tableFromFn(3, (b) => pop(b) >= 2), need: 45, pay: 55,
    brief: 'Majority of three. The carry half of a full adder.',
  },
  {
    company: 'SIGMA ARITHMETIC', name: 'ADDER SUM', ins: ['A', 'B', 'CIN'], out: 'SUM', arity: 3,
    table: tableFromFn(3, (b) => pop(b) % 2 === 1), need: 50, pay: 70,
    brief: 'Odd parity of three inputs. The sum half of a full adder.',
  },
  {
    company: 'SELECTOR SYSTEMS', name: 'MUX 2:1', ins: ['A', 'B', 'SEL'], out: 'Y', arity: 3,
    table: tableFromFn(3, ([a, b, s]) => (s ? !!b : !!a)), need: 60, pay: 95,
    brief: 'SEL picks: 0 routes A, 1 routes B.',
  },
  {
    company: 'COMPARATOR MUTUAL', name: 'EQUAL 2-BIT', ins: ['A0', 'A1', 'B0', 'B1'], out: 'EQ', arity: 4,
    table: tableFromFn(4, ([a0, a1, b0, b1]) => a0 === b0 && a1 === b1), need: 80, pay: 160,
    brief: 'Two 2-bit numbers A1A0 and B1B0. High when equal.',
  },
];

export function makeClientNode(s, spec, x, y) {
  return {
    id: `cl${s.seq++}`, kind: 'client', x, y,
    company: spec.company, want: spec.name, brief: spec.brief,
    arity: spec.arity, table: spec.table,
    inNames: spec.ins.slice(), outName: spec.out,
    need: spec.need, pay: spec.pay,
    delivered: 0, complete: false, rejected: 0, lastError: null,
  };
}
