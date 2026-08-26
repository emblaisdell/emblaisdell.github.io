// seqCatalogue.js — the catalogue for circuits that hold state.
//
// A stateful circuit has no truth table to look up, so it is recognised the
// same way an order judges one: by running a written test. Each entry is a
// reference state machine, from which the expected outputs are generated.

import { checkVectors } from './netlist.js';

const build = (entry) => {
  let st = entry.ref.init();
  entry.expect = entry.vectors.map((v, i) => {
    const r = entry.ref.step(v, st);
    st = r.state;
    return i < (entry.skipFirst || 0) ? r.outs.map(() => null) : r.outs;
  });
  return entry;
};

export const SEQ_CATALOGUE = [
  build({
    key: 'sr-latch',
    name: 'SR LATCH',
    symbol: 'box',
    label: 'SR',
    ins: ['SET', 'RESET'],
    outs: ['Q', 'NQ'],
    arity: 2,
    outCount: 2,
    skipFirst: 1,
    vectors: [[1, 1], [0, 1], [1, 1], [1, 1], [1, 0], [1, 1], [1, 1], [0, 1], [1, 1], [1, 0], [1, 1]],
    ref: {
      init: () => ({ q: 0 }),
      step: ([s, r], st) => {
        const q = !s ? 1 : (!r ? 0 : st.q);
        return { outs: [q, q ? 0 : 1], state: { q } };
      },
    },
  }),
  build({
    key: 'd-latch',
    name: 'D LATCH',
    symbol: 'box',
    label: 'D',
    ins: ['D', 'ENABLE'],
    outs: ['Q'],
    arity: 2,
    outCount: 1,
    vectors: [[0, 1], [1, 1], [1, 0], [0, 0], [0, 0], [0, 1], [0, 0], [1, 1], [1, 0], [0, 0], [1, 0]],
    ref: {
      init: () => ({ q: 0 }),
      step: ([d, e], st) => {
        const q = e ? d : st.q;
        return { outs: [q], state: { q } };
      },
    },
  }),
  build({
    key: 'd-flip-flop',
    name: 'D FLIP-FLOP',
    symbol: 'ff',
    label: 'D',
    ins: ['D', 'CLK'],
    outs: ['Q'],
    arity: 2,
    outCount: 1,
    skipFirst: 2,
    vectors: [
      [0, 0], [0, 1], [0, 0], [1, 0], [1, 1], [1, 0], [0, 0], [0, 0], [1, 0],
      [1, 1], [0, 1], [0, 0], [0, 1], [1, 0], [1, 1], [1, 0],
    ],
    ref: {
      init: () => ({ q: 0, clk: 0 }),
      step: ([d, clk], st) => {
        const q = (clk && !st.clk) ? d : st.q;
        return { outs: [q], state: { q, clk } };
      },
    },
  }),
];

export const seqSpec = (key) => SEQ_CATALOGUE.find((e) => e.key === key);

/** Which catalogued stateful circuit this design behaves like, if any. */
export function identifySequential(flat, arity, outCount) {
  for (const entry of SEQ_CATALOGUE) {
    if (entry.arity !== arity || entry.outCount !== outCount) continue;
    if (checkVectors(flat, entry.vectors, entry.expect).fails.length === 0) return entry;
  }
  return null;
}
