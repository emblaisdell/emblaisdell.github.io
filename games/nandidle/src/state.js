// state.js — game state, the type registry (unlocked subfab blueprints),
// graph editing operations, and save/load. DOM-free so it can be unit-tested.

import { NAND_ID, canonicalName, tableFromFn, MAX_ARITY, INPUT_NAMES } from './circuits.js';
import { CLIENT_CATALOG, makeClientNode } from './clients.js';

export const BAL = {
  startCash: 250,
  gateCost: 0.5,          // $ per NAND from the source node
  // Subfabs do not stockpile: an input port holds exactly one cycle's worth of
  // its ingredient (see the port's own `need`), and finished work waits in a
  // shallow output buffer until a line can take it.
  outputCap: 4,
  refund: 0.5,            // fraction returned when a placed subfab is removed
  recordMinMs: 300,
  recordMaxMs: 180000,
  maintenancePay: 0.35,   // pay factor once a client's order is filled
  grantAmount: 60,        // anti-softlock advance (see OPEN_QUESTIONS.md)
  logMax: 60,
};

export const NAND_TYPE = {
  id: NAND_ID,
  name: 'NAND',
  arity: 2,
  table: tableFromFn(2, ([a, b]) => !(a && b)),
  ingredients: [],
  inNames: ['A', 'B'],
  outName: 'Y',
  timeMs: 0,
  cost: 0,
  gateEquiv: 1,
  origin: 'base',
};

export function newGame() {
  const s = {
    v: 1,
    seq: 1,
    cash: BAL.startCash,
    timeMs: 0,
    types: { [NAND_ID]: { ...NAND_TYPE } },
    nodes: [],
    links: [],
    clientsUnlocked: 0,
    log: [],
    stats: { gates: 0, spentGates: 0, earned: 0, delivered: 0, rejected: 0, recorded: 0 },
    screen: 'fab',
  };
  s.nodes.push({
    id: nextId(s, 'src'), kind: 'source', x: -320, y: 0,
    out: { typeId: NAND_ID, n: 0 }, rr: 0,
  });
  unlockNextClient(s);
  log(s, 'good', 'Fab commissioned',
    'The source mints NAND, and nothing else. Open the RECORDING BENCH and build your first circuit out of one NAND: wire input A into both of its inputs.');
  return s;
}

export function nextId(s, prefix) { return `${prefix}${s.seq++}`; }
export function typeOf(s, id) { return s.types[id]; }
export function allTypes(s) { return Object.values(s.types); }
export function nodeById(s, id) { return s.nodes.find((n) => n.id === id); }

export function log(s, kind, text, detail) {
  s.log.unshift({ kind, text, detail, t: s.timeMs });
  if (s.log.length > BAL.logMax) s.log.length = BAL.logMax;
}

// --- graph editing ---------------------------------------------------------

export function placeCost(type) { return type.cost; }

export function placeSubfab(s, typeId, x, y) {
  const t = typeOf(s, typeId);
  if (!t) return { ok: false, error: 'Unknown subfab.' };
  if (s.cash < t.cost) return { ok: false, error: `Not enough cash (needs $${t.cost}).` };
  s.cash -= t.cost;
  const node = {
    id: nextId(s, 'f'), kind: 'fab', typeId, x, y, rr: 0,
    ins: t.ingredients.map((g) => ({ typeId: g.typeId, need: g.count, n: 0 })),
    out: { typeId, n: 0 },
    prog: null,
  };
  s.nodes.push(node);
  return { ok: true, node };
}

export function removeNode(s, id) {
  const node = nodeById(s, id);
  if (!node || node.kind === 'source') return false;
  if (node.kind === 'client') return false;           // clients leave on their own
  s.cash += Math.round(typeOf(s, node.typeId).cost * BAL.refund);
  s.nodes = s.nodes.filter((n) => n.id !== id);
  s.links = s.links.filter((l) => l.from !== id && l.to !== id);
  return true;
}

/** Output type a node emits, or null for sinks. */
export function outputTypeOf(s, node) {
  if (node.kind === 'client') return null;
  return node.out.typeId;
}

export function linkError(s, fromId, toId, port) {
  if (fromId === toId) return 'A subfab cannot feed itself.';
  const from = nodeById(s, fromId); const to = nodeById(s, toId);
  if (!from || !to) return 'Missing node.';
  const outType = outputTypeOf(s, from);
  if (!outType) return 'That node has no output.';
  if (s.links.some((l) => l.from === fromId && l.to === toId && l.port === port)) return 'Already connected.';
  if (to.kind === 'client') return null;                       // clients accept anything
  const p = to.ins[port];
  if (!p) return 'No such input.';
  if (p.typeId !== outType) {
    return `Port takes ${typeOf(s, p.typeId).name}, that line carries ${typeOf(s, outType).name}.`;
  }
  if (s.links.some((l) => l.to === toId && l.port === port)) return 'That input already has a supplier.';
  return null;
}

export function addLink(s, fromId, toId, port) {
  const err = linkError(s, fromId, toId, port);
  if (err) return { ok: false, error: err };
  const link = { id: nextId(s, 'l'), from: fromId, to: toId, port, flow: 0 };
  s.links.push(link);
  return { ok: true, link };
}

export function removeLink(s, id) { s.links = s.links.filter((l) => l.id !== id); }

// --- recorded subfabs ------------------------------------------------------

/** How many source NAND gates one unit of this type costs, transitively. */
export function gateEquivalents(s, ingredients) {
  let total = 0;
  for (const g of ingredients) {
    const t = typeOf(s, g.typeId);
    total += g.count * (t ? t.gateEquiv : 1);
  }
  return total;
}

export function registerRecording(s, { arity, table, used, elapsedMs, name, inNames, outName }) {
  const ingredients = [...used.entries()].map(([typeId, count]) => ({ typeId, count }));
  const gateEquiv = gateEquivalents(s, ingredients);
  const timeMs = Math.round(Math.min(BAL.recordMaxMs, Math.max(BAL.recordMinMs, elapsedMs)));
  const canon = canonicalName(arity, table);
  const duplicate = allTypes(s).find((t) => t.arity === arity && t.table === table);
  const base = name?.trim() || canon || `CIRCUIT ${arity}:${table}`;
  const label = duplicate ? `${base} MK${countVariants(s, arity, table) + 1}` : base;
  const type = {
    id: nextId(s, 'c'),
    name: label.toUpperCase().slice(0, 22),
    arity, table, ingredients, timeMs,
    inNames: (inNames || INPUT_NAMES).slice(0, arity),
    outName: outName || 'Y',
    cost: Math.round(10 + 2 * gateEquiv),
    gateEquiv,
    origin: 'recorded',
    canon,
  };
  s.types[type.id] = type;
  s.stats.recorded++;
  log(s, 'good', `New subfab: ${type.name}`,
    `${ingredients.map((g) => `${g.count}x ${typeOf(s, g.typeId).name}`).join(' + ')} -> 1 in ${(timeMs / 1000).toFixed(1)}s`);
  return type;
}

function countVariants(s, arity, table) {
  return allTypes(s).filter((t) => t.arity === arity && t.table === table).length;
}

// --- clients ---------------------------------------------------------------

export function unlockNextClient(s) {
  const spec = CLIENT_CATALOG[s.clientsUnlocked];
  if (!spec) return null;
  s.clientsUnlocked++;
  const y = -190 + (s.clientsUnlocked - 1) * 160;
  const node = makeClientNode(s, spec, 200, y);
  s.nodes.push(node);
  log(s, 'good', `New client: ${spec.company}`, `${spec.need}x ${spec.name}, $${spec.pay} each`);
  return node;
}

// --- save / load -----------------------------------------------------------

const KEY = 'nand-idle-save-v1';

export function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; }
}
export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s.v !== 1) return null;
    if (!s.types[NAND_ID]) s.types[NAND_ID] = { ...NAND_TYPE };
    for (const t of Object.values(s.types)) {          // saves from before named ports
      if (!t.inNames) t.inNames = INPUT_NAMES.slice(0, t.arity);
      if (!t.outName) t.outName = 'Y';
    }
    for (const n of s.nodes) {
      if (n.kind === 'client' && !n.inNames) { n.inNames = INPUT_NAMES.slice(0, n.arity); n.outName = 'Y'; }
    }
    s.screen = 'fab';
    return s;
  } catch { return null; }
}
export function wipe() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

export { MAX_ARITY };
