// sim.js — the shop tick. There is no graph: processes draw from one global
// stock of circuits and put their output back into it, in priority order, and
// clients take what is left over.

import {
  BAL, typeOf, stockOf, addStock, log, unlockNextClient, matchingTypes, matchesClient,
  activeCopies, sayRow, payFor, stageOf, stageLeft, closeClient,
} from './state.js';
import { firstDifference } from './circuits.js';

const BUCKET_MS = 500;
const BUCKETS = 8;      // rolling 4s window for the money readout

export function tick(s, dtMs) {
  s.timeMs += dtMs;
  let earned = 0;
  let spent = 0;

  // 1. Finish running cycles. Output lands in the global stock.
  for (const p of s.rows) {
    if (p.kind !== 'process') continue;
    let done = 0;
    for (let i = p.timers.length - 1; i >= 0; i--) {
      p.timers[i] -= dtMs;
      if (p.timers[i] <= 0) { p.timers.splice(i, 1); done++; }
    }
    if (done) {
      addStock(s, p.typeId, done);
      s.stats.produced += done;
    }
  }

  // 2. Walk the schedule in order. Both kinds of row draw from the same stock,
  //    so where a shipment sits decides whether it takes the circuits a process
  //    below it was going to use. Circuits are rationed by priority: a process
  //    takes what it needs even when that is not yet a whole cycle's worth, and
  //    holds it until it is, so a row below can never live off the trickle a
  //    row above is waiting to accumulate. Gates are not rationed — see below.
  const queues = [];
  for (const row of s.rows) {
    if (row.kind === 'ship') {
      if (!row.paused) earned += ship(s, row);
      continue;
    }
    const type = typeOf(s, row.typeId);
    row.starved = false;
    row.noCash = false;
    const held = [];
    // Starts on one row come no closer together than a cycle divided by the
    // copies, so a ×4 stack puts out a unit every quarter cycle rather than
    // four at once and then nothing. (A single copy's starts are a whole cycle
    // apart anyway.) A schedule that fell idle restarts from this tick.
    const gap = type.timeMs / Math.max(1, activeCopies(row));
    const from = Math.max((row.lastStart ?? -Infinity) + gap, s.timeMs - dtMs);   // the earliest start due
    let due = Math.floor((s.timeMs - from) / gap) + 1;
    let slot = row.timers.length;
    for (; slot < activeCopies(row) && due > 0; slot++, due--) {
      const take = reserve(s, type, row);
      if (!take) { row.starved = true; break; }
      held.push(take);
    }
    // Whatever its copies are doing, a row claims for every one of their next
    // runs: a cycle's worth per copy lands in its pile rather than passing to
    // the rows below, so each copy that finishes starts again from the pile.
    if (activeCopies(row) > 0) takeToward(s, type, row, activeCopies(row));
    if (held.length) queues.push({ row, type, held, i: 0, gap });
  }

  // Gates are minted on demand for whoever needs them, not handed out top-down:
  // one copy per row per pass, so a row at the bottom of the schedule still
  // gets its NAND when money is short instead of the top row taking it all.
  let granted = true;
  while (granted) {
    granted = false;
    for (const q of queues) {
      if (q.i >= q.held.length) continue;
      const cost = q.held[q.i].cost;
      if (cost > s.cash) continue;
      if (cost > 0) {
        s.cash -= cost;
        spent += cost;
        s.stats.gates += q.held[q.i].gates;
        s.stats.spentGates += cost;
      }
      q.row.timers.push(q.type.timeMs);
      q.row.lastStart = Math.max((q.row.lastStart ?? -Infinity) + q.gap, s.timeMs - dtMs);   // its scheduled slot
      q.i++;
      granted = true;
    }
  }
  // Anything nobody could pay for stays held by its row, ready for next tick.
  for (const q of queues) {
    for (let k = q.i; k < q.held.length; k++) release(q.row, q.held[k]);
    if (q.i < q.held.length) { q.row.starved = true; q.row.noCash = true; }
  }

  // Money moves in bursts, so the readout averages a rolling window rather than
  // smoothing per-tick instants.
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

/**
 * Move what is in stock into the row's pile, up to `cycles` cycles' worth.
 * True if the pile holds at least one whole cycle (gates aside — those can
 * always be minted).
 */
function takeToward(s, type, row, cycles = 1) {
  const held = row.held || (row.held = {});
  const mintable = (id) => (typeOf(s, id)?.origin === 'base');
  let ready = true;
  for (const g of type.ingredients) {
    const want = cycles * g.count - (held[g.typeId] || 0);
    const take = Math.min(want, stockOf(s, g.typeId));   // refunded gates count too
    if (take > 0) { addStock(s, g.typeId, -take); held[g.typeId] = (held[g.typeId] || 0) + take; }
    if ((held[g.typeId] || 0) < g.count && !mintable(g.typeId)) ready = false;
  }
  return ready;
}

/**
 * Take one cycle's worth of ingredients, counting how many gates would have to
 * be minted to make up the difference. Circuits cannot be conjured, only
 * produced, so whatever of them is in stock is moved into the row's holding
 * pile first; if that still falls short of a cycle the pile stays with the row
 * and null comes back. Gates are never held — they are minted at the moment a
 * cycle starts, so the shop never pays for one before it is used.
 */
function reserve(s, type, row) {
  if (!takeToward(s, type, row)) return null;
  const held = row.held;
  const took = [];
  let cost = 0;
  let gates = 0;
  for (const g of type.ingredients) {
    const have = held[g.typeId] || 0;
    const short = g.count - have;                     // only ever gates, minted on the spot
    if (short > 0) {
      cost += short * (typeOf(s, g.typeId).mintCost ?? BAL.gateCost);
      gates += short;
    }
    if (have > 0) took.push([g.typeId, have]);
    delete held[g.typeId];
  }
  return { gates, cost, took };
}

function release(row, take) {
  for (const [id, n] of take.took) row.held[id] = (row.held[id] || 0) + n;
}

/**
 * Can one cycle of this circuit start right now? Used by the panels and by the
 * stall check; the tick itself reserves and grants in two passes. `held` is
 * what a row has already taken towards its next cycle.
 */
export function plan(s, type, held = {}) {
  let buy = 0;
  let cost = 0;
  for (const g of type.ingredients) {
    const have = stockOf(s, g.typeId) + (held[g.typeId] || 0);
    if (have >= g.count) continue;
    const t = typeOf(s, g.typeId);
    if (t?.origin !== 'base') return null;         // only supplied parts appear
    buy += g.count - have;
    cost += (g.count - have) * (t.mintCost ?? BAL.gateCost);
  }
  if (cost > s.cash) return null;
  return { buy, cost };
}

/** A shipping row sends every unit in stock that behaves like the order. */
function ship(s, row) {
  const client = s.clients.find((c) => c.id === row.clientId);
  if (!client || client.closed) return 0;
  let earned = 0;
  let shipped = 0;
  for (const type of matchingTypes(s, client)) {
    let have = stockOf(s, type.id);
    while (have > 0 && !client.closed) {
      have--;
      addStock(s, type.id, -1);
      earned += deliver(s, client, type.id);
      shipped++;
    }
  }
  row.lastShipped = shipped;
  return earned;
}

function deliver(s, client, typeId) {
  const t = typeOf(s, typeId);
  // One rule for what satisfies an order, shared with the shipping row that
  // chose to send this. They disagreed once, and units were consumed and then
  // rejected on the way out of the door.
  if (matchesClient(s, t, client)) {
    const pay = payFor(client, t);
    s.cash += pay;
    s.stats.earned += pay;
    s.stats.delivered++;
    client.delivered++;
    client.lastError = null;
    client.seen = true;          // shipping to them counts as having noticed them
    if (!client.complete && client.delivered >= client.need) {
      client.complete = true;
      const later = { ...client, delivered: client.need * (1 + BAL.discountSpan) };
      log(s, 'good', `${client.company}: order filled`,
        `They keep buying: $${payFor(client, t)}/unit for the next ${stageLeft(client)}, then $${payFor(later, t)}/unit for ${stageLeft(later)} more.`);
      unlockNextClient(s);
    }
    // Their demand runs out eventually; the row goes with it.
    if (stageOf(client) === 'closed') closeClient(s, client);
    return pay;
  }

  // Shipping matches on behaviour, so a wrong circuit never leaves the shop.
  // This is a guard, not a mechanic: what a near-miss actually needs is a
  // testbench run, which reports every failing case rather than the first.
  client.rejected++;
  s.stats.rejected++;
  const d = (t.arity === client.arity && t.table != null && client.table != null)
    ? firstDifference(client.arity, client.table, t.table) : null;
  const detail = d
    ? `Fails on ${sayRow(client, d.row)}: ${client.outName || 'OUT'} should be ${d.wanted}, got ${d.got}.`
    : `${t.name} does not meet the ${client.want} specification.`;
  if (client.lastError !== detail) log(s, 'bad', `${client.company} rejected a ${t.name}`, detail);
  client.lastError = detail;
  return 0;
}

/**
 * Catch up on time the shop ran unattended. Stepped a second at a time, which
 * is conservative: a process with a cycle shorter than a second completes once
 * per step rather than several times, so the shop never earns more offline than
 * it would have with someone watching.
 */
export function catchUp(s, awayMs, stepMs = 1000) {
  const before = { cash: s.cash, delivered: s.stats.delivered, produced: s.stats.produced };
  const steps = Math.floor(awayMs / stepMs);
  for (let i = 0; i < steps; i++) tick(s, stepMs);
  return {
    ms: steps * stepMs,
    earned: s.cash - before.cash,
    delivered: s.stats.delivered - before.delivered,
    produced: s.stats.produced - before.produced,
  };
}

/** True when nothing can move: no cash to mint gates and no work in flight. */
export function isStalled(s) {
  if (s.cash >= BAL.gateCost) return false;
  const procs = s.rows.filter((r) => r.kind === 'process');
  if (procs.some((p) => p.timers.length > 0)) return false;
  if (procs.some((p) => plan(s, typeOf(s, p.typeId), p.held))) return false;
  for (const c of s.clients) {
    if (c.closed) continue;                        // stock only they wanted is no way out
    if (matchingTypes(s, c).some((t) => stockOf(s, t.id) > 0)) return false;
  }
  return true;
}

/** Units per minute a process row is capable of when never starved. */
export function ratePerMin(s, p) {
  const t = typeOf(s, p.typeId);
  return (60000 / t.timeMs) * activeCopies(p);
}
