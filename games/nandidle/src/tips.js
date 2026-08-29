// tips.js — short notes that fire the first time a mechanic actually bites,
// rather than a second tutorial up front. Each fires once per game and is
// remembered in the save.

import { BAL, typeOf, stockOf, matchingTypes, testCost, activeCopies } from './state.js';

export const TIPS = [
  {
    id: 'starved',
    title: 'Starved means waiting on a circuit',
    body: 'A row goes starved when something it draws is not in stock. Either the row that makes it is too slow — duplicate it — or a row above is taking them first. Rows draw in order, top down.',
    when: (s) => s.rows.some((r) => r.kind === 'process' && r.starved && !r.noCash),
  },
  {
    id: 'nocash',
    title: 'Gates cost money you do not have',
    body: 'Gates are minted the moment a cycle starts, and the shop just ran out of cash to mint them with. Stop a copy or two until orders catch up — a stopped copy costs nothing and keeps its place.',
    when: (s) => s.rows.some((r) => r.noCash),
  },
  {
    id: 'contention',
    title: 'Two rows want the same circuit',
    body: 'A shipping row is taking circuits a process below it needs. Whichever sits higher draws first, so move the shipment down to feed the line first, or up to fill the order first.',
    when: (s) => {
      const shipping = new Set();
      for (const row of s.rows) {
        if (row.kind === 'ship') {
          const c = s.clients.find((x) => x.id === row.clientId);
          if (c) for (const t of matchingTypes(s, c)) shipping.add(t.id);
          continue;
        }
        if (row.starved && !row.noCash) {
          const t = typeOf(s, row.typeId);
          if (t && t.ingredients.some((g) => shipping.has(g.typeId))) return true;
        }
      }
      return false;
    },
  },
  {
    id: 'filled',
    title: 'A filled order keeps paying',
    body: `An order that is complete does not stop buying — it drops to ${Math.round(BAL.discountPay * 100)}% of the rate for a while, then ${Math.round(BAL.maintenancePay * 100)}%, and eventually they have all they need and their row leaves the schedule. If you would rather keep those circuits, pause the row (■) or move it below the processes that want them.`,
    when: (s) => s.clients.some((c) => c.complete),
  },
  {
    id: 'testbench',
    title: 'You can buy the answer',
    body: 'A client only accepts a circuit that behaves exactly like their order, so a near miss ships nothing and says nothing. On the TEST BENCH screen they will tell you precisely which inputs come back wrong — it costs money, but guessing costs more.',
    // Only once they have actually built something and missed: at the start
    // there is nothing to test and nothing to learn from testing it.
    when: (s) => s.clients.some((c) => !c.complete
      && matchingTypes(s, c).length === 0
      && s.cash >= testCost(c)
      && Object.values(s.types).some((t) => t.origin === 'recorded' && t.arity === c.arity)),
  },
  {
    id: 'stockpile',
    title: 'Stock is piling up',
    body: 'Circuits nobody draws just sit there — stock is unlimited and free, but idle stock is money spent on gates that has not come back. Either ship it or stop the row making it.',
    when: (s) => Object.entries(s.stock).some(([id, n]) => n > 40 && id !== 'nand'),
  },
  {
    id: 'doubling',
    title: 'Build it by doubling',
    body: 'Placing the same part over and over is the slow way round, and the stopwatch charges you for every second of it. Record a small piece — two words of memory, say — then record a bigger one out of two copies of that, and a bigger one out of two of those. Each doubling costs the same handful of parts, so eight recordings of ten parts each gets you 256 words. Depth is cheaper than width here.',
    when: (s) => Object.values(s.types).some((t) => (t.design?.parts?.length || 0) >= 10),
  },
  {
    id: 'deep',
    title: 'Circuits are made of circuits',
    body: 'Anything in your library can be placed on the bench, so the next design starts from the last one. The catalogue names what you build from its behaviour alone — however you wired it.',
    when: (s) => Object.values(s.types).some((t) => t.gateEquiv >= 4),
  },
];

export function initTips(s) {
  if (!s.tips) s.tips = {};
  return s.tips;
}

/** The next tip whose moment has arrived, or null. */
export function dueTip(s) {
  if (!s.tips) initTips(s);
  for (const tip of TIPS) {
    if (s.tips[tip.id]) continue;
    let fires = false;
    try { fires = tip.when(s); } catch { fires = false; }
    if (fires) return tip;
  }
  return null;
}

export function markTip(s, id) { initTips(s)[id] = true; }
