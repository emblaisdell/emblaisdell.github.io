// sim.js — the fab simulation. Items are indistinguishable within a circuit
// type, so buffers are integer counts and no logic is evaluated here; a tick is
// pure integer bookkeeping over the node/link graph.

import { BAL, typeOf, log, unlockNextClient } from './state.js';
import { firstDifference, rowLabel } from './circuits.js';

const BUCKET_MS = 500;
const BUCKETS = 8;      // rolling 4s window for the money readout

export function tick(s, dtMs) {
  s.timeMs += dtMs;
  let earned = 0;
  let spent = 0;

  // Index once per tick: the graph is walked several times below and the fab
  // is meant to stay cheap with hundreds of nodes.
  const byId = new Map();
  for (const n of s.nodes) byId.set(n.id, n);
  const outLinks = new Map();
  for (const l of s.links) {
    const arr = outLinks.get(l.from);
    if (arr) arr.push(l); else outLinks.set(l.from, [l]);
  }

  // 1. Advance running jobs.
  for (const n of s.nodes) {
    if (n.kind !== 'fab' || n.prog === null) continue;
    n.prog -= dtMs;
    if (n.prog <= 0) {
      if (n.out.n < BAL.outputCap) { n.out.n++; n.prog = null; } else { n.prog = 0; }
    }
  }

  // 2. Move finished items along links (instant transport, round-robin).
  //    A source has no stock: it mints a gate only when a consumer takes it, so
  //    no gate is ever paid for before it is used.
  for (const n of s.nodes) {
    if (n.kind === 'client') continue;
    const outs = outLinks.get(n.id);
    if (!outs || !outs.length) continue;
    const mints = n.kind === 'source';
    let guard = outs.length;
    while (guard > 0) {
      const stocked = n.out.n > 0;
      if (!stocked && !(mints && s.cash >= BAL.gateCost)) break;
      const link = outs[n.rr % outs.length];
      n.rr = (n.rr + 1) % outs.length;
      if (push(s, byId, link, n.out.typeId, (v) => { earned += v; })) {
        if (stocked) {
          n.out.n--;
        } else {
          s.cash -= BAL.gateCost;
          spent += BAL.gateCost;
          s.stats.gates++;
          s.stats.spentGates += BAL.gateCost;
        }
        link.flow = 1;
        guard = outs.length;
      } else {
        guard--;
      }
    }
  }

  // 3. Start new jobs where every ingredient port is stocked.
  for (const n of s.nodes) {
    if (n.kind !== 'fab' || n.prog !== null) continue;
    if (n.out.n >= BAL.outputCap) continue;
    if (!n.ins.every((p) => p.n >= p.need)) continue;
    for (const p of n.ins) p.n -= p.need;
    n.prog = typeOf(s, n.typeId).timeMs;
  }

  for (const l of s.links) if (l.flow > 0) l.flow = Math.max(0, l.flow - dtMs / 700);

  // Money moves in bursts — a buffer fills in one tick, and a slow subfab can
  // ship nothing for seconds — so the readout averages a rolling window rather
  // than smoothing per-tick instants.
  const m = s.meter || (s.meter = {
    acc: 0, earned: 0, spent: 0, i: 0,
    eBuckets: new Array(BUCKETS).fill(0), sBuckets: new Array(BUCKETS).fill(0),
  });
  m.acc += dtMs; m.earned += earned; m.spent += spent;
  while (m.acc >= BUCKET_MS) {
    m.acc -= BUCKET_MS;
    m.eBuckets[m.i] = m.earned; m.sBuckets[m.i] = m.spent;
    m.i = (m.i + 1) % BUCKETS;
    m.earned = 0; m.spent = 0;
    const perSec = 1000 / (BUCKET_MS * BUCKETS);
    s.rateEarn = m.eBuckets.reduce((a, b) => a + b, 0) * perSec;
    s.rateSpend = m.sBuckets.reduce((a, b) => a + b, 0) * perSec;
  }
  return { earned, spent };
}

function push(s, byId, link, typeId, credit) {
  const to = byId.get(link.to);
  if (!to) return false;
  if (to.kind === 'client') { credit(deliver(s, to, typeId)); return true; }
  // A port holds one cycle's worth and no more — subfabs do not stockpile.
  const port = to.ins[link.port];
  if (!port || port.typeId !== typeId || port.n >= port.need) return false;
  port.n++;
  return true;
}

function deliver(s, client, typeId) {
  const t = typeOf(s, typeId);
  if (t.arity === client.arity && t.table === client.table) {
    const pay = client.complete ? Math.round(client.pay * BAL.maintenancePay) : client.pay;
    s.cash += pay;
    s.stats.earned += pay;
    s.stats.delivered++;
    client.delivered++;
    if (!client.complete && client.delivered >= client.need) {
      client.complete = true;
      log(s, 'good', `${client.company}: order filled`,
        `Standing maintenance contract opens at $${Math.round(client.pay * BAL.maintenancePay)}/unit.`);
      unlockNextClient(s);
    }
    return pay;
  }
  client.rejected++;
  s.stats.rejected++;
  let detail;
  if (t.arity !== client.arity) {
    detail = `${t.name} has ${t.arity} input${t.arity === 1 ? '' : 's'}, the order calls for ${client.arity}.`;
  } else {
    const d = firstDifference(client.arity, client.table, t.table);
    detail = d
      ? `Fails on ${rowLabel(client.arity, d.row, client.inNames)}: ${client.outName || 'OUT'} should be ${d.wanted}, got ${d.got}.`
      : 'Specification mismatch.';
  }
  client.lastError = detail;
  log(s, 'bad', `${client.company} rejected a ${t.name}`, detail);
  return 0;
}

/** True when nothing can move: no cash for gates and no work in flight. */
export function isStalled(s) {
  if (s.cash >= BAL.gateCost) return false;
  if (s.nodes.some((n) => n.kind === 'fab' && (n.prog !== null || n.out.n > 0))) return false;
  if (s.nodes.some((n) => n.kind === 'source' && n.out.n > 0)) return false;   // legacy saves
  if (s.nodes.some((n) => n.kind === 'fab' && n.ins.every((p) => p.n >= p.need))) return false;
  return true;
}
