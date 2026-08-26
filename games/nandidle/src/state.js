// state.js — game state: the circuit library (recorded process types), the
// global stock of circuits, the priority-sorted process list, clients, and
// save/load. DOM-free so it can be unit-tested.

import { NAND_ID, CLOCK_ID, canonicalName, canonicalGate, tableFromFn, rowLabel, MAX_ARITY, INPUT_NAMES } from './circuits.js';
import {
  sigFromTables, bitsFromFn, truthTables, checkVectors, portsOf, shapeOf, flatOf,
  MAX_PORTS, MAX_WIDTH,
} from './netlist.js';
import { identifySequential } from './seqCatalogue.js';
import { CLIENT_CATALOG, makeClient } from './clients.js';

// Money is deliberately tight: an order is worth roughly three times the gates
// it takes to fill, and a process costs about what a small order earns, so
// every duplicate is a decision rather than a reflex.
export const BAL = {
  startCash: 90,
  gateCost: 0.5,          // $ per NAND, minted on demand when a process needs one
  processCost: 25,        // flat $ per process, and per duplicate of a process
  clockCost: 3,           // $ per clock part drawn, minted like a gate
  testBase: 15,           // testbench: $15 + $8 per input of the order under test
  testPerInput: 8,
  testPerStep: 2,         // a sequence test is priced by how long it runs
  refund: 0.5,            // fraction returned when a process copy is dismantled
  // A cycle is never shorter than the game loop's longest step (250ms in
  // main.js), so a copy can only ever finish one cycle per tick and no
  // production is lost when a frame runs late.
  recordMinMs: 300,
  recordMaxMs: 180000,
  maintenancePay: 0.25,   // pay factor once a client's order is filled
  maintenanceFloor: 1.1,  // ...but never below this multiple of a fair build's gates
  grantAmount: 30,        // anti-softlock advance (see DECISIONS.md)
  offlineCapMs: 4 * 3600e3,   // the shop runs for at most four hours unattended
  offlineStepMs: 1000,
  logMax: 60,
};

export const SAVE_VERSION = 4;

const NAND_BITS = bitsFromFn(2, ([a, b]) => !(a && b));

/**
 * Grouping wires: a bundle gathers single wires into one bus, a tap takes them
 * apart again. Neither is a gate — they are pure rewiring, and cost nothing to
 * draw — but they are what makes a byte a thing you can carry on one wire.
 */
function busPart(kind, width) {
  const singles = Array.from({ length: width }, (_, i) => `B${i}`);
  const bundle = kind === 'bundle';
  const inPorts = bundle ? portsOf(singles) : portsOf(['BUS'], [width]);
  const outPorts = bundle ? portsOf(['BUS'], [width]) : portsOf(singles);
  return {
    id: `${kind}${width}`,
    name: `${bundle ? 'BUNDLE' : 'TAP'} ${width}`,
    arity: inPorts.length,
    outCount: outPorts.length,
    inPorts,
    outPorts,
    inNames: inPorts.map((p) => p.name),
    outNames: outPorts.map((p) => p.name),
    outName: outPorts[0].name,
    table: null,
    sig: `${kind}${width}`,
    kind: 'comb',
    stable: true,
    // zero gates: its outputs are its inputs, regrouped
    flat: {
      arity: width,
      gates: [],
      clocks: [],
      outs: Array.from({ length: width }, (_, i) => ({ k: 'in', i })),
      inPorts,
      outPorts,
    },
    ingredients: [],
    symbol: 'box',
    symbolLabel: bundle ? `\u21c9${width}` : `${width}\u21c7`,
    symbolBubbles: [],
    timeMs: 0,
    cost: 0,
    gateEquiv: 0,
    origin: 'base',
    mintCost: 0,
    locked: true,
    blurb: bundle
      ? `Gathers ${width} wires onto one ${width}-wide bus.`
      : `Takes a ${width}-wide bus apart into ${width} wires.`,
  };
}

// Every width, not a chosen few: splitting an eight-wide address into seven and
// one is what building memory by doubling needs.
export const BUS_TYPES = [2, 3, 4, 5, 6, 7, 8].flatMap((w) => [busPart('bundle', w), busPart('tap', w)]);

export const CLOCK_TYPE = {
  id: CLOCK_ID,
  name: 'CLOCK',
  arity: 0,
  outCount: 1,
  table: null,
  sig: 'clock',
  kind: 'seq',
  stable: true,
  flat: null,
  ingredients: [],
  inNames: [],
  outNames: ['CLK'],
  outName: 'CLK',
  inPorts: [],
  outPorts: portsOf(['CLK']),
  symbol: 'box',
  symbolLabel: 'CLK',
  symbolBubbles: [],
  timeMs: 0,
  cost: 0,
  gateEquiv: 1,
  origin: 'base',
  mintCost: BAL.clockCost,
  locked: true,           // unlocked when an order first needs timing
  blurb: 'Flips once every step. Time, in a part.',
};

export const NAND_TYPE = {
  id: NAND_ID,
  name: 'NAND',
  arity: 2,
  outCount: 1,
  table: tableFromFn(2, ([a, b]) => !(a && b)),
  sig: sigFromTables(2, [NAND_BITS]),
  kind: 'comb',
  stable: true,
  flat: null,                    // the primitive: flatten() knows it by id
  ingredients: [],
  inNames: ['A', 'B'],
  outNames: ['Y'],
  outName: 'Y',
  inPorts: portsOf(['A', 'B']),
  outPorts: portsOf(['Y']),
  symbol: 'nand',
  symbolLabel: '',
  timeMs: 0,
  cost: 0,
  gateEquiv: 1,
  origin: 'base',
  mintCost: BAL.gateCost,
};

// Judgements are deterministic for a given (order, circuit, behaviour), so they
// are worth keeping; the key includes the signature so a different circuit under
// a reused id cannot inherit one.
const verdicts = new Map();

export function newGame() {
  verdicts.clear();          // a new game reuses ids; do not carry judgements over
  const s = {
    v: SAVE_VERSION,
    seq: 1,
    cash: BAL.startCash,
    timeMs: 0,
    types: Object.fromEntries([
      [NAND_ID, { ...NAND_TYPE }],
      [CLOCK_ID, { ...CLOCK_TYPE }],
      ...BUS_TYPES.map((t) => [t.id, { ...t }]),
    ]),
    stock: {},              // typeId -> units on hand, the one global total
    rows: [],               // the schedule: processes and shipments, in priority order
    clients: [],
    clientsUnlocked: 0,
    log: [],
    stats: { gates: 0, spentGates: 0, earned: 0, produced: 0, delivered: 0, rejected: 0, recorded: 0 },
    screen: 'line',
  };
  unlockNextClient(s);
  log(s, 'good', 'Shop opened',
    'NAND is the only circuit you can buy, and only as a process consumes it. Open the RECORDING BENCH and design your first circuit out of one NAND: wire input A into both of its inputs.');
  return s;
}

export function nextId(s, prefix) { return `${prefix}${s.seq++}`; }
export function typeOf(s, id) { return s.types[id]; }

/** The gates behind a circuit, worked out from its design the first time. */
export function flatFor(s, type) { return flatOf(type, (id) => typeOf(s, id)); }
// The library changes rarely and is read constantly — every shipping row asks
// for it on every tick — so it is worked out once per change.
const libraries = new WeakMap();
const matchLists = new WeakMap();

export function libraryChanged(s) {
  s.typesVersion = (s.typesVersion || 0) + 1;
}

export function allTypes(s) {
  const hit = libraries.get(s);
  const v = s.typesVersion || 0;
  const n = Object.keys(s.types).length;      // a cheap guard against a missed bump
  if (hit && hit.v === v && hit.n === n) return hit.list;
  const list = Object.values(s.types).filter((t) => !t.locked);
  libraries.set(s, { v, n, list });
  return list;
}
export function stockOf(s, id) { return s.stock[id] || 0; }

export function addStock(s, id, n) {
  s.stock[id] = (s.stock[id] || 0) + n;
  return s.stock[id];
}

export function log(s, kind, text, detail, note) {
  s.log.unshift({ kind, text, detail, note, t: s.timeMs });
  if (s.log.length > BAL.logMax) s.log.length = BAL.logMax;
}

// --- the schedule ----------------------------------------------------------
// One ordered list holding both kinds of row: processes, which draw ingredients
// out of stock and put a circuit back in, and shipments, which draw a client's
// circuit out of stock and send it. Both compete for the same stock at their
// own position, so a shipment placed above a process really does take the
// circuits that process was going to use.

export function procOf(s, typeId) {
  return s.rows.find((r) => r.kind === 'process' && r.typeId === typeId);
}
export function processRows(s) { return s.rows.filter((r) => r.kind === 'process'); }
export function shipRowFor(s, clientId) {
  return s.rows.find((r) => r.kind === 'ship' && r.clientId === clientId);
}

/** Copies a row is allowed to run: the rest are stopped, but still owned. */
export function activeCopies(row) { return Math.max(0, row.n - (row.stopped || 0)); }

/** Put one cycle's worth of ingredients back on the shelf. */
export function refundCycle(s, type) {
  for (const g of type.ingredients) addStock(s, g.typeId, g.count);
}

export function addProcess(s, typeId) {
  const t = typeOf(s, typeId);
  if (!t) return { ok: false, error: 'Unknown circuit.' };
  if (t.origin === 'base') return { ok: false, error: `${t.name} is minted on demand, not produced by a process.` };
  if (s.cash < BAL.processCost) return { ok: false, error: `Not enough cash (a process costs $${BAL.processCost}).` };
  s.cash -= BAL.processCost;
  const existing = procOf(s, typeId);
  if (existing) { existing.n++; return { ok: true, proc: existing, duplicated: true }; }
  const proc = { id: nextId(s, 'p'), kind: 'process', typeId, n: 1, timers: [], starved: false };
  // New processes land above the shipments, so a circuit is made before it ships.
  const firstShip = s.rows.findIndex((r) => r.kind === 'ship');
  if (firstShip < 0) s.rows.push(proc); else s.rows.splice(firstShip, 0, proc);
  return { ok: true, proc, duplicated: false };
}

/** Dismantle one copy; the row disappears with its last copy. */
export function removeProcess(s, id) {
  const p = s.rows.find((q) => q.id === id && q.kind === 'process');
  if (!p) return false;
  p.n--;
  if (p.stopped) p.stopped = Math.min(p.stopped, p.n);
  s.cash += Math.round(BAL.processCost * BAL.refund);
  // A cycle caught in flight gives its ingredients back rather than eating them.
  if (p.timers.length > activeCopies(p)) {
    p.timers.pop();
    refundCycle(s, typeOf(s, p.typeId));
  }
  if (p.n <= 0) s.rows = s.rows.filter((q) => q.id !== id);
  return true;
}

/** Idle one copy without dismantling it; its cycle in flight is refunded. */
export function stopCopy(s, id) {
  const p = s.rows.find((q) => q.id === id && q.kind === 'process');
  if (!p || (p.stopped || 0) >= p.n) return false;
  p.stopped = (p.stopped || 0) + 1;
  if (p.timers.length > activeCopies(p)) {
    p.timers.pop();
    refundCycle(s, typeOf(s, p.typeId));
  }
  return true;
}

export function startCopy(s, id) {
  const p = s.rows.find((q) => q.id === id && q.kind === 'process');
  if (!p || !p.stopped) return false;
  p.stopped--;
  return true;
}

/** Break a stack in two, so the same circuit can run at two priorities. */
export function splitProcess(s, id, keep) {
  const p = s.rows.find((q) => q.id === id && q.kind === 'process');
  if (!p || p.n < 2) return null;
  const moved = Math.max(1, Math.min(p.n - 1, keep ?? Math.floor(p.n / 2)));
  const stoppedMoved = Math.min(p.stopped || 0, moved);
  const row = {
    id: nextId(s, 'p'), kind: 'process', typeId: p.typeId,
    n: moved, stopped: stoppedMoved, timers: [], starved: false,
  };
  // running cycles follow their copies
  for (let i = 0; i < moved && p.timers.length; i++) row.timers.push(p.timers.pop());
  p.n -= moved;
  p.stopped = (p.stopped || 0) - stoppedMoved;
  // Neither row may end up running more cycles than it has copies to run them;
  // any cycle left over gives its ingredients back rather than vanishing.
  const type = typeOf(s, p.typeId);
  for (const r of [p, row]) {
    while (r.timers.length > activeCopies(r)) {
      r.timers.pop();
      refundCycle(s, type);
    }
  }
  const at = s.rows.indexOf(p);
  s.rows.splice(at + 1, 0, row);
  return row;
}

export function moveRow(s, id, dir) {
  const i = s.rows.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= s.rows.length) return false;
  [s.rows[i], s.rows[j]] = [s.rows[j], s.rows[i]];
  return true;
}

/** Circuits that use this one as an ingredient — it cannot be deleted under them. */
export function dependentsOf(s, typeId) {
  return allTypes(s).filter((t) => t.ingredients.some((g) => g.typeId === typeId));
}

export function renameType(s, typeId, name) {
  const t = typeOf(s, typeId);
  if (!t || t.origin === 'base') return { ok: false, error: 'That circuit cannot be renamed.' };
  const clean = String(name || '').trim().toUpperCase().slice(0, 22);
  if (!clean) return { ok: false, error: 'A circuit needs a name.' };
  t.name = clean;
  if (!t.symbolAuto) t.symbolLabel = clean.replace(/[^A-Z0-9 ]/g, '').slice(0, 5);
  return { ok: true };
}

/**
 * Scrap a design: its process rows are dismantled (with the usual refund) and
 * whatever stock of it is left is written off. Refused while another circuit is
 * built out of it.
 */
export function deleteType(s, typeId) {
  const t = typeOf(s, typeId);
  if (!t) return { ok: false, error: 'Unknown circuit.' };
  if (t.origin === 'base') return { ok: false, error: 'NAND is not yours to scrap.' };
  const deps = dependentsOf(s, typeId);
  if (deps.length) {
    return { ok: false, error: `${deps.map((d) => d.name).join(', ')} ${deps.length > 1 ? 'are' : 'is'} built from ${t.name}.` };
  }
  const row = procOf(s, typeId);
  if (row) {
    while (procOf(s, typeId)) removeProcess(s, row.id);
  }
  const held = stockOf(s, typeId);
  delete s.stock[typeId];
  delete s.types[typeId];
  libraryChanged(s);
  log(s, 'warn', `Scrapped ${t.name}`, held ? `${held} in stock written off.` : undefined);
  return { ok: true };
}

// --- recorded circuits -----------------------------------------------------

/** How many source NAND gates one unit of this circuit costs, transitively. */
export function gateEquivalents(s, ingredients) {
  let total = 0;
  for (const g of ingredients) {
    const t = typeOf(s, g.typeId);
    total += g.count * (t ? t.gateEquiv : 1);
  }
  return total;
}

export function registerRecording(s, analysis) {
  const { arity, table, used, elapsedMs, name, inNames, outNames } = analysis;
  const ingredients = [...used.entries()].map(([typeId, count]) => ({ typeId, count }));
  const gateEquiv = analysis.flat ? analysis.flat.gates.length : gateEquivalents(s, ingredients);
  const timeMs = Math.round(Math.min(BAL.recordMaxMs, Math.max(BAL.recordMinMs, elapsedMs)));
  // Only single-output combinational circuits small enough to enumerate have a
  // catalogue entry; everything else is named by the player.
  const match = analysis.kind === 'seq'
    ? identifySequential(analysis.flat, arity, analysis.outCount)   // recognised by test
    : (analysis.outCount === 1 && table !== null ? canonicalGate(arity, table) : null);
  const named = !!name?.trim();
  const canon = match?.name || null;
  const duplicate = allTypes(s).find((t) => t.sig === analysis.sig);
  // Circuits with no catalogue entry are named for their shape rather than for
  // a truth table they may not have: STATE 8+1>8 beats CIRCUIT 2:NULL.
  const shape = `${(analysis.inPorts || []).map((p) => p.width).join('+') || arity}`
    + `\u2192${(analysis.outPorts || []).map((p) => p.width).join('+') || 1}`;
  const base = name?.trim() || canon
    || `${analysis.kind === 'seq' ? 'STATE' : 'CIRCUIT'} ${shape}`;
  const label = duplicate ? `${base} MK${countVariants(s, arity, table, analysis.sig) + 1}` : base;
  const type = {
    id: nextId(s, 'c'),
    name: label.toUpperCase().slice(0, 22),
    arity, table, ingredients, timeMs,
    outCount: analysis.outCount,
    inPorts: analysis.inPorts,
    outPorts: analysis.outPorts,
    shape: analysis.shape,
    sig: analysis.sig,
    kind: analysis.kind,
    stable: analysis.stable,
    design: analysis.design,
    inNames: (inNames || INPUT_NAMES).slice(0, arity),
    outNames: (outNames || ['Y']).slice(0, analysis.outCount),
    outName: (outNames && outNames[0]) || 'Y',
    cost: BAL.processCost,
    gateEquiv,
    origin: 'recorded',
    canon,
    symbol: match ? match.symbol : 'box',
    // A block the player named wears their initials; one the game named wears
    // its shape, which says more than the first four letters of "CIRCUIT".
    symbolLabel: match ? match.label
      : (named ? shortLabel(base) : `${(analysis.inPorts || []).length}\u2192${(analysis.outPorts || []).length}`),
    symbolBubbles: match?.bubbles || [],
    matched: canon,
    nameAuto: !!match && !named,
    symbolAuto: !!match,
  };
  s.types[type.id] = type;
  libraryChanged(s);
  s.stats.recorded++;
  log(s, 'good', `New circuit: ${type.name}`,
    `${ingredients.map((g) => `${g.count}x ${typeOf(s, g.typeId).name}`).join(' + ')} -> 1 in ${(timeMs / 1000).toFixed(1)}s`,
    matchNote(type));
  return type;
}

/** What to tell the player about a name or symbol the game chose for them. */
export function matchNote(type) {
  if (!type.matched) return 'No catalogue match — drawn as a generic block. The name is yours.';
  if (type.nameAuto) {
    return `Behaviour matched the catalogue: named ${type.matched} and given its symbol automatically.`;
  }
  return `Behaviour matched the catalogue: this is ${type.matched}, so its symbol was applied automatically.`;
}

/** Text small enough to sit inside a generic block symbol. */
function shortLabel(name) {
  const clean = String(name).replace(/[^A-Z0-9 ]/gi, '').trim();
  return clean.length <= 5 ? clean.toUpperCase() : clean.slice(0, 4).toUpperCase();
}

function countVariants(s, arity, table, sig) {
  return allTypes(s).filter((t) => t.sig === sig).length;
}

// --- clients ---------------------------------------------------------------

export function unlockNextClient(s) {
  const spec = CLIENT_CATALOG[s.clientsUnlocked];
  if (!spec) return null;
  s.clientsUnlocked++;
  const handed = (spec.unlocks || []).filter((id) => unlockBase(s, id, true));
  if (handed.length) {
    log(s, 'good', `New parts: ${handed.map((id) => s.types[id].name).join(', ')}`,
      handed.map((id) => s.types[id].blurb).join(' '));
  }
  const client = makeClient(s, spec);
  s.clients.push(client);
  // Every client gets a shipping row, at the bottom, so production comes first
  // until the player decides otherwise.
  s.rows.push({ id: nextId(s, 'sh'), kind: 'ship', clientId: client.id });
  log(s, 'good', `New client: ${spec.company}`, `${spec.need}x ${spec.name}, $${spec.pay} each`,
    'A shipping row was added to the bottom of the schedule. Anything you build that behaves like their order ships automatically.');
  return client;
}

/**
 * Circuits that satisfy a client, matched on behaviour — no designation step.
 * Several of the player's circuits can qualify at once (an AND and its MK2).
 */
// Judging is by test, not by comparison: a circuit that holds state has no
// canonical form, so two correct latches wired differently look different. What
// they have in common is that they both pass the order's test.
export function matchesClient(s, type, client) {
  // Keyed on ids, not on the signature: a signature can be hundreds of
  // characters, and this is called for every unit that ships.
  const key = `${client.id}|${type.id}`;
  const seen = verdicts.get(key);
  if (seen && seen.sig === type.sig) return seen.ok;
  let ok = false;
  const shape = type.shape || shapeOf(type.inPorts || portsOf(type.inNames || []), type.outPorts || portsOf(type.outNames || []));
  if (shape === client.shape) {
    const flat = flatFor(s, type);
    if (client.seq) {
      ok = flat
        ? checkVectors(flat, client.seq.vectors, client.seq.expect).fails.length === 0
        : false;
    } else if (client.sig && type.sig === client.sig) {
      ok = true;                                  // identical behaviour, cheaply
    } else if (client.bits && flat) {
      // Signatures only line up between circuits of the same kind. A design that
      // computes the right function but happens to contain a settled loop is
      // still the right answer, so fall back to running it over every row.
      ok = combMatch(flat, client);
    }
  }
  verdicts.set(key, { sig: type.sig, ok });
  return ok;
}

/** Run a circuit over every input row and compare it with the order's table. */
function combMatch(flat, client) {
  const bits = client.inPorts.reduce((n, p) => n + p.width, 0);
  if (bits > 14) return false;                     // too many rows to be worth it
  const rows = 1 << bits;
  const vectors = [];
  const expect = [];
  for (let r = 0; r < rows; r++) {
    vectors.push(Array.from({ length: bits }, (_, b) => (r >>> b) & 1));
    expect.push(client.bits.map((t) => t[r]));
  }
  return checkVectors(flat, vectors, expect).fails.length === 0;
}

export function matchingTypes(s, client) {
  let per = matchLists.get(s);
  if (!per) { per = new Map(); matchLists.set(s, per); }
  const v = s.typesVersion || 0;
  const hit = per.get(client.id);
  if (hit && hit.v === v) return hit.list;
  const list = allTypes(s).filter((t) => matchesClient(s, t, client));
  per.set(client.id, { v, list });
  return list;
}

/** The truth table of a combinational circuit, worked out from its gates. */
export function tablesOf(s, type) {
  if (type.id === NAND_ID) return [bitsFromFn(2, ([a, b]) => !(a && b))];
  const flat = flatFor(s, type);
  if (!flat || type.kind !== 'comb') return null;
  return truthTables(flat).tables;
}

/** An input row of a client's table, said in its own port names and values. */
export function sayRow(client, row) {
  const ports = client.inPorts || portsOf(client.inNames || []);
  const bits = [];
  let at = 0;
  for (const p of ports) { for (let b = 0; b < p.width; b++) bits.push((row >>> (at + b)) & 1); at += p.width; }
  at = 0;
  return ports.map((p) => {
    let v = 0;
    for (let b = 0; b < p.width; b++) v |= bits[at + b] << b;
    at += p.width;
    return `${p.name}=${v}`;
  }).join(' ');
}

/**
 * What a client pays for one unit. Two floors keep shipping from ever costing
 * more than it earns: a filled order still pays enough to cover a fair build of
 * what it asked for, and no shipment pays less than the gates in the unit
 * actually sent — so an inefficient circuit earns thin margins rather than
 * quietly draining the shop.
 */
export function payFor(client, type) {
  const base = client.complete ? Math.round(client.pay * BAL.maintenancePay) : client.pay;
  const fair = (client.gates || 1) * BAL.gateCost * BAL.maintenanceFloor;
  const mine = (type?.gateEquiv || 0) * BAL.gateCost;
  return Math.round(Math.max(base, client.complete ? fair : 0, mine) * 100) / 100;
}

export function testCost(client) {
  const base = BAL.testBase + BAL.testPerInput * client.arity;
  // A sequence test is the only way to see a stateful specification, and it
  // costs the client time to run, so it is priced by its length.
  return client.seq ? base + BAL.testPerStep * client.seq.vectors.length : base;
}

/** Supplied parts a player has been given access to. */
export function unlockBase(s, id, quiet = false) {
  const t = s.types[id];
  if (!t || !t.locked) return false;
  t.locked = false;
  libraryChanged(s);
  if (!quiet) log(s, 'good', `${t.name} available`, t.blurb);
  return true;
}

/**
 * The testbench: pay a client to run one of your circuits against their
 * specification and report exactly which input assignments come back wrong.
 * It is the only way to see a spec you have not already matched.
 */
export function runTestbench(s, clientId, typeId) {
  const client = s.clients.find((c) => c.id === clientId);
  const type = typeOf(s, typeId);
  if (!client || !type) return { ok: false, error: 'Nothing to test.' };
  const cost = testCost(client);
  if (s.cash < cost) return { ok: false, error: `A test run at ${client.company} costs $${cost}.` };
  s.cash -= cost;
  s.stats.tested = (s.stats.tested || 0) + 1;

  const report = { typeId, typeName: type.name, cost, at: s.timeMs, fails: [], rows: 0 };

  if (client.seq) {
    if (type.arity !== client.arity || (type.outCount || 1) !== (client.outCount || 1) || !flatFor(s, type)) {
      report.arityMismatch = {
        got: type.arity, want: client.arity,
        outs: type.outCount || 1, wantOuts: client.outCount || 1, sequential: type.kind === 'seq',
      };
    } else {
      const run = checkVectors(flatFor(s, type), client.seq.vectors, client.seq.expect);
      report.sequential = true;
      report.rows = run.steps;
      report.fails = run.fails.map((f) => ({
        step: f.step, out: f.out, want: f.want, got: f.got, inputs: f.inputs,
      }));
    }
    const n = report.fails.length;
    log(s, n || report.arityMismatch ? 'bad' : 'good', `${client.company} tested ${type.name} ($${cost})`,
      report.arityMismatch ? 'Wrong shape for this order.'
        : n ? `${n} of ${report.rows} steps wrong.` : `All ${report.rows} steps correct — it ships from here.`);
    client.report = report;
    return { ok: true, report };
  }

  const got = tablesOf(s, type);
  if (type.arity !== client.arity || (type.outCount || 1) !== (client.outCount || 1) || !got) {
    report.arityMismatch = {
      got: type.arity, want: client.arity,
      outs: type.outCount || 1, sequential: type.kind === 'seq',
    };
    log(s, 'bad', `${client.company} tested ${type.name}`,
      type.kind === 'seq'
        ? `${type.name} holds state; the order is a plain ${client.arity}-input circuit.`
        : `${type.name} has ${type.arity} input${type.arity === 1 ? '' : 's'}; the order is a ${client.arity}-input circuit.`);
  } else {
    report.rows = 1 << client.arity;
    for (let r = 0; r < report.rows; r++) {
      for (let o = 0; o < client.bits.length; o++) {
        const want = client.bits[o][r];
        if (want === null) continue;                      // a row nobody minds about
        if (want !== got[o][r]) { report.fails.push({ row: r, out: o, want, got: got[o][r] }); break; }
      }
    }
    const n = report.fails.length;
    log(s, n ? 'bad' : 'good', `${client.company} tested ${type.name} ($${cost})`,
      n ? `${n} of ${report.rows} cases wrong.` : `All ${report.rows} cases correct — it ships from here.`,
      n ? report.fails.slice(0, 3).map((f) => `${sayRow(client, f.row)} -> ${(client.outNames || [client.outName])[f.out || 0] || 'OUT'} should be ${f.want}`).join(' · ') : undefined);
  }
  client.report = report;
  return { ok: true, report };
}

// --- save / load -----------------------------------------------------------

const KEY = 'nand-idle-save-v4';

export function save(s) {
  try {
    s.savedAt = Date.now();
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch { return false; }
}
export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s.v !== SAVE_VERSION) return null;
    if (!s.types[NAND_ID]) s.types[NAND_ID] = { ...NAND_TYPE };
    if (!s.types[CLOCK_ID]) s.types[CLOCK_ID] = { ...CLOCK_TYPE };
    for (const t of BUS_TYPES) if (!s.types[t.id]) s.types[t.id] = { ...t };
    // Port metadata arrived after this save format; fill it in rather than
    // throwing the game away.
    for (const t of Object.values(s.types)) {
      if (!t.inPorts) t.inPorts = portsOf((t.inNames || []).slice(0, t.arity));
      if (!t.outPorts) t.outPorts = portsOf(t.outNames || [t.outName || 'Y']);
      if (!t.outCount) t.outCount = t.outPorts.length;
      if (!t.shape) t.shape = shapeOf(t.inPorts, t.outPorts);
    }
    // Supplied parts a player has already earned stay earned.
    for (let i = 0; i < s.clientsUnlocked && i < CLIENT_CATALOG.length; i++) {
      for (const id of (CLIENT_CATALOG[i].unlocks || [])) {
        if (s.types[id]) { s.types[id].locked = false; libraryChanged(s); }
      }
    }
    // How long the shop was left running by itself, to be caught up on boot.
    s.awayMs = Math.max(0, Math.min(BAL.offlineCapMs, Date.now() - (s.savedAt || Date.now())));
    for (const t of Object.values(s.types)) {        // saves from before symbols
      if (t.symbol) continue;
      const m = canonicalGate(t.arity, t.table);
      t.symbol = m ? m.symbol : 'box';
      t.symbolLabel = m ? m.label : shortLabel(t.name);
      t.symbolBubbles = m?.bubbles || [];
      t.matched = m?.name || null;
      t.symbolAuto = !!m;
    }
    libraryChanged(s);
    s.screen = 'line';
    return s;
  } catch { return null; }
}
export function wipe() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem('nand-idle-save-v3');   // truth-table identity
    localStorage.removeItem('nand-idle-save-v2');   // designated shipments
    localStorage.removeItem('nand-idle-save-v1');   // the fab-floor build
  } catch { /* ignore */ }
}

export { MAX_ARITY, MAX_PORTS, MAX_WIDTH };
