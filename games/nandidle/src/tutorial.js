// tutorial.js — the opening tutorial. Steps watch real game state and
// advance when the player actually does the thing, so nothing is blocked,
// nothing is faked, and doing it your own way still counts.

import { BAL } from './state.js';

export const OPENING = [
  {
    id: 'bench',
    cta: 'Open the RECORD screen',
    title: 'You can only buy NAND',
    body: 'Your shop mints NAND gates and nothing else. Your first client wants inverters, so you will have to design one. Open the RECORD screen.',
    target: '[data-screen=record]',
    done: ({ state }) => state.screen === 'record',
  },
  {
    id: 'import',
    cta: 'Press IMPORT',
    title: 'Take the commission',
    body: 'IMPORT copies the order onto the bench: how many inputs it has, what its ports are called, and its name.',
    target: '#btnImport',
    done: ({ rec }) => !!rec.importedFrom || rec.arity === 1,
  },
  {
    id: 'record',
    cta: 'Press RECORD',
    title: 'Start the stopwatch',
    body: 'Press RECORD. The stopwatch runs until you press STOP, and that time becomes the cycle time of the process forever — so it pays to know what you are building before you start.',
    target: '#btnRecord',
    done: ({ rec }) => rec.recording,
  },
  {
    id: 'place',
    cta: 'Click NAND in the library, then the sheet',
    title: 'Place a NAND',
    body: 'Click NAND in the library, then click the sheet to drop one on the bench. It stays selected, so each further click drops another — until you start a wire or pick a different circuit.',
    target: '#palette',
    done: ({ rec }) => rec.parts.length > 0,
  },
  {
    id: 'wire',
    cta: 'Drag A to both NAND inputs',
    title: 'Tie both inputs together',
    body: 'Drag from the A terminal to the NAND’s first input, then from A again to its second. A NAND with both inputs on the same signal is an inverter.',
    done: ({ rec }) => rec.parts.some((p) => p.ins.length > 1 && p.ins.every(Boolean)),
  },
  {
    id: 'out',
    cta: 'Drag the NAND output to Y',
    title: 'Wire it to OUT',
    body: 'Drag the NAND’s output pin to the output terminal on the right. The analysis panel works out what you have built the moment the wiring closes — and a design can have more than one output if you need it.',
    done: ({ rec }) => (rec.outs || []).some(Boolean),
  },
  {
    id: 'done',
    cta: 'Press STOP',
    title: 'It knows what that is',
    body: 'The panel matched your truth table against the catalogue and calls it NOT. Press STOP to stop the clock and add it to your library.',
    target: '#btnRecord',
    done: ({ state }) => state.stats.recorded > 0,
  },
  {
    id: 'process',
    cta: 'Click NOT in the library',
    title: 'Run it',
    body: `A circuit in the library is only a design. Click NOT to run it as a process ($${BAL.processCost}). It starts drawing NAND out of stock and putting NOTs back in.`,
    target: '#palette',
    done: ({ state }) => state.rows.some((r) => r.kind === 'process'),
  },
  {
    id: 'ships',
    cta: 'Wait for the first unit to ship',
    title: 'It ships itself',
    body: 'Nothing had to be designated: your NOT behaves like what INVERSE HOLDINGS ordered, so the SHIP row at the bottom of the schedule picked it up. Move that row above a process and it would take the circuits that process needs — which is why shipments sit at the bottom by default.',
    target: '.prow.ship',
    done: ({ state }) => state.clients.some((c) => c.delivered > 0),
  },
  {
    id: 'duplicate',
    cta: 'Click NOT in the library again',
    title: 'Go faster',
    body: `Units are shipping. Click NOT in the library again — a second copy of a process you already run is a ×2 on the same row, for another $${BAL.processCost}, at twice the rate. Money is tight, so that is a real decision.`,
    target: '#palette',
    done: ({ state }) => state.rows.some((r) => r.kind === 'process' && r.n > 1),
  },
  {
    id: 'finish',
    title: 'That is the whole loop',
    body: 'Record a circuit, run it as a process, and the schedule ships it. Recorded circuits are ingredients for the next recording — AND is one NAND plus one NOT — and when two rows want the same circuit, the higher one draws first. When a client wants something you cannot work out, pay for a run on the TEST BENCH screen: they will tell you exactly which inputs your circuit gets wrong.',
    last: true,
    done: () => false,      // ends when the player dismisses it
  },
];

/**
 * A second chapter, for the mechanic a player is most likely to read as a bug:
 * a circuit that feeds itself. It opens when the first order for one arrives.
 */
export const MEMORY = [
  {
    id: 'mem-intro',
    cta: 'Open the RECORD screen',
    title: 'A circuit that remembers',
    body: 'Everything so far has been a function: same inputs, same output, every time. This order wants a part that holds a bit — and the only way to build one is to let a wire run backwards, so the circuit can see what it did last. Open the RECORD screen.',
    target: '[data-screen=record]',
    done: ({ state }) => state.screen === 'record',
  },
  {
    id: 'mem-import',
    cta: 'Press IMPORT',
    title: 'Two in, two out',
    body: 'IMPORT the latch order. It has two inputs — SET and RESET, both active low — and two outputs, Q and its opposite. Feedback is why it needs both.',
    target: '#btnImport',
    done: ({ rec }) => (rec.outCount || 1) >= 2,
  },
  {
    id: 'mem-record',
    cta: 'Press RECORD',
    title: 'Start the clock',
    body: 'Press RECORD. Two NANDs is all this takes, so it should be quick.',
    target: '#btnRecord',
    done: ({ rec }) => rec.recording,
  },
  {
    id: 'mem-place',
    cta: 'Place two NANDs',
    title: 'Place two NANDs',
    body: 'One will drive Q, the other its opposite.',
    target: '#palette',
    done: ({ rec }) => rec.parts.length >= 2,
  },
  {
    id: 'mem-cross',
    cta: 'Wire each output into the other',
    title: 'Now cross them over',
    body: 'Wire the first NAND’s output into the second’s input, and the second’s output back into the first. That loop is the memory: each gate holds the other in place. The bench will not stop you — a loop is a circuit here, not an error.',
    done: ({ rec }) => rec.parts.some((p) => p.ins.some((r) => r && r.k === 'part'
      && rec.parts.find((q) => q.id === r.id)?.ins.some((rr) => rr && rr.k === 'part' && rr.id === p.id))),
  },
  {
    id: 'mem-terminals',
    cta: 'Wire SET, RESET and both outputs',
    title: 'Wire the terminals',
    body: 'SET into the free input of the first NAND, RESET into the free input of the second, then each NAND’s output to an output terminal. The analysis panel will stop showing a truth table and start showing what the circuit did, step by step — that is what a circuit with state gets instead.',
    done: ({ rec }) => rec.outs.filter(Boolean).length >= 2,
  },
  {
    id: 'mem-done',
    cta: 'Press STOP',
    title: 'Press STOP',
    body: 'If it holds its state, the catalogue will name it SR LATCH on the strength of its behaviour — the same test the client will run. From here on, orders are tests rather than truth tables. And when an order wants more of something — sixteen words of memory, not two — do not place sixteen: record two, then record a bigger one out of two copies of that. Each doubling costs the same handful of parts.',
    target: '#btnRecord',
    last: true,
    done: ({ state }) => Object.values(state.types).some((t) => t.kind === 'seq' && t.origin === 'recorded'),
  },
];

export const CHAPTERS = { opening: OPENING, memory: MEMORY };
export const STEPS = OPENING;      // the opening chapter, for the progress strip

export function stepsOf(state) {
  return CHAPTERS[state.tutorial?.chapter || 'opening'] || OPENING;
}

/** Start a chapter, unless the player has seen it or is mid-way through one. */
export function openChapter(state, name) {
  const t = state.tutorial;
  if (!t || t.seen?.[name]) return false;
  if (!t.done) return false;                       // never interrupt one in progress
  state.tutorial = { chapter: name, step: 0, done: false, seen: { ...(t.seen || {}) } };
  return true;
}

export function initTutorial(state) {
  if (state.tutorial) {
    state.tutorial.chapter = state.tutorial.chapter || 'opening';
    state.tutorial.seen = state.tutorial.seen || {};
    return state.tutorial;
  }
  // A save from before the tutorial existed, or one already underway, skips it.
  const underway = state.stats.recorded > 0 || state.rows.some((r) => r.kind === 'process');
  state.tutorial = { chapter: 'opening', step: 0, done: underway, seen: {} };
  return state.tutorial;
}

export function currentStep(state) {
  const t = state.tutorial;
  if (!t || t.done) return null;
  return stepsOf(state)[t.step] || null;
}

/** Advance past every step whose condition is already satisfied. */
export function advanceTutorial(state, ctx) {
  const t = state.tutorial;
  if (!t || t.done) return false;
  const steps = stepsOf(state);
  let moved = false;
  while (t.step < steps.length) {
    const step = steps[t.step];
    if (!step.done(ctx)) break;
    t.step++;
    moved = true;
  }
  if (t.step >= steps.length) {
    t.done = true;
    t.seen = { ...(t.seen || {}), [t.chapter || 'opening']: true };
  }
  return moved;
}

export function skipTutorial(state) {
  if (!state.tutorial) return;
  state.tutorial.done = true;
  state.tutorial.seen = { ...(state.tutorial.seen || {}), [state.tutorial.chapter || 'opening']: true };
}

export function restartTutorial(state, chapter = 'opening') {
  state.tutorial = { chapter, step: 0, done: false, seen: { ...(state.tutorial?.seen || {}) } };
}
