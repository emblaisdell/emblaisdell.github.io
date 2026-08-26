// lineScreen.js — the schedule: processes and shipments in one priority list,
// drawn as a drafting schedule. Rows are rebuilt only when the schedule's shape
// changes; live numbers are patched in place so nothing flickers.

import {
  BAL, typeOf, stockOf, addProcess, removeProcess, moveRow, matchingTypes,
  stopCopy, startCopy, activeCopies, splitProcess, payFor,
} from './state.js';
import { plan, ratePerMin } from './sim.js';
import { symbolSvg } from './symbols.js';
import { canonicalGate } from './circuits.js';
import * as History from './undo.js';

const MAX_SLOTS = 16;   // beyond this, one aggregate bar reads better

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (ch) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/** Ports as a player reads them: names, and widths where they are not wires. */
const portList = (ports, names) => (ports || (names || []).map((name) => ({ name, width: 1 })))
  .map((p) => p.name + (p.width > 1 ? `[${p.width}]` : '')).join(', ');

export function createLineScreen(host, getCtx, toast) {
  const rows = new Map();
  let signature = null;

  const S = () => getCtx().state;
  const shape = (s) => s.rows.map((r) => `${r.id}:${r.kind}:${r.n || 0}`).join('|');

  // Fixed slots, so the priority arrows sit in the same place on every row
  // whether or not that row also has copy controls.
  function controls(row, s, { copies }) {
    return `
      <button class="ghost small" data-act="up" title="raise priority">&#9650;</button>
      <button class="ghost small" data-act="down" title="lower priority">&#9660;</button>
      ${copies ? `
      <button class="ghost small" data-act="split" title="split this stack into two rows">&#9482;</button>
      <button class="ghost small" data-act="stop" title="stop one copy (keeps it, refunds the cycle)">&#9632;</button>
      <button class="ghost small" data-act="start" title="restart one stopped copy">&#9654;</button>
      <button class="ghost small" data-act="minus" title="dismantle one copy (+$${Math.round(BAL.processCost * BAL.refund)})">&minus;</button>
      <button class="ghost small" data-act="plus" title="duplicate ($${BAL.processCost})">+</button>`
      : '<span class="slotless"></span><span class="slotless"></span><span class="slotless"></span><span class="slotless"></span><span class="slotless"></span>'}`;
  }

  function build() {
    const s = S();
    rows.clear();
    host.innerHTML = `
      <div class="sheet-head">
        <h1>SCHEDULE</h1>
        <div class="sheet-sub">priority order &mdash; each row draws from stock in turn, so a shipment above a process takes the circuits that process wanted</div>
      </div>
      <div class="sched-head">
        <span>PRI</span><span>ROW</span><span>DRAWS FROM STOCK</span>
        <span class="num">CYCLE</span><span class="num">RATE</span><span>STATE</span><span></span>
      </div>
      <div class="sched"></div>
      <div class="sheet-block">
        <div class="tb"><b>NAND IDLE</b> &mdash; SCHEDULE</div>
        <div class="tb sub">GATES MINTED ON DEMAND @ $${BAL.gateCost.toFixed(2)}</div>
        <div class="tb rev">REV <span id="revno">00</span></div>
      </div>`;
    const list = host.querySelector('.sched');

    if (!s.rows.length) {
      list.innerHTML = `<div class="empty">
        <b>Nothing scheduled.</b>
        Record a circuit at the bench, then add it from the library on the left.
        Each process costs $${BAL.processCost}; adding one you already run duplicates it instead.
      </div>`;
      return;
    }

    s.rows.forEach((row, i) => {
      const el = document.createElement('div');
      const isShip = row.kind === 'ship';
      const client = isShip ? s.clients.find((c) => c.id === row.clientId) : null;
      if (isShip && !client) return;
      el.className = `prow${isShip ? ' ship' : ''}`;

      if (isShip) {
        const wanted = client.symbol
          ? { symbol: client.symbol, label: client.label || '' }
          : (client.table !== null && client.table !== undefined ? canonicalGate(client.arity, client.table) : null);
        el.innerHTML = `
          <div class="pri">${String(i + 1).padStart(2, '0')}</div>
          <div class="pmain">
            <div class="pname">${symbolSvg(wanted?.symbol || 'box', { label: wanted?.label || '', inputs: client.arity, width: 32, bubbles: wanted?.bubbles || [] })}
              <span>SHIP &rarr; ${esc(client.company)}</span></div>
            <div class="pports">${esc(client.want)} &middot; ${esc((client.inNames || []).join(', '))} &rarr; ${esc((client.outNames || [client.outName]).join(', '))}</div>
          </div>
          <div class="precipe"></div>
          <div class="num ptime">&mdash;</div>
          <div class="num prate"></div>
          <div class="pstate">
            <div class="bar"><i></i></div>
            <div class="pstatus"></div>
          </div>
          <div class="pctl">${controls(row, s, { copies: false })}</div>`;
      } else {
        const t = typeOf(s, row.typeId);
        el.innerHTML = `
          <div class="pri">${String(i + 1).padStart(2, '0')}</div>
          <div class="pmain">
            <div class="pname">${symbolSvg(t.symbol || 'box', { label: t.symbolLabel, inputs: t.arity, width: 32, bubbles: t.symbolBubbles || [] })}
              <span>${esc(t.name)}</span>${row.n > 1 ? `<em>&times;${row.n}</em>` : ''}</div>
            <div class="pports">${esc(portList(t.inPorts, t.inNames))} &rarr; ${esc(portList(t.outPorts, t.outNames))}</div>
          </div>
          <div class="precipe"></div>
          <div class="num ptime">${(t.timeMs / 1000).toFixed(1)}s</div>
          <div class="num prate">${ratePerMin(s, row).toFixed(0)}/min</div>
          <div class="pstate">
            <div class="copies"></div>
            <div class="pstatus"></div>
          </div>
          <div class="pctl">${controls(row, s, { copies: true })}</div>`;
      }

      el.querySelectorAll('button').forEach((b) => {
        b.onclick = () => {
          const act = b.dataset.act;
          const name = row.kind === 'ship' ? 'shipment' : typeOf(s, row.typeId).name;
          if (act === 'up') {
            if (moveRow(s, row.id, -1)) History.push('line', `move ${name}`, () => moveRow(s, row.id, 1));
          } else if (act === 'down') {
            if (moveRow(s, row.id, 1)) History.push('line', `move ${name}`, () => moveRow(s, row.id, -1));
          } else if (act === 'split') {
            const made = splitProcess(s, row.id, undefined);
            if (!made) toast('A single copy cannot be split.', 'warn');
            else History.push('line', `split ${name}`, () => {
              const back = s.rows.find((q) => q.id === row.id);
              if (back) { back.n += made.n; back.stopped = (back.stopped || 0) + (made.stopped || 0); }
              s.rows = s.rows.filter((q) => q.id !== made.id);
            });
          } else if (act === 'stop') {
            if (stopCopy(s, row.id)) History.push('line', `stop ${name}`, () => startCopy(s, row.id));
            else toast('Every copy is already stopped.', 'warn');
          } else if (act === 'start') {
            if (startCopy(s, row.id)) History.push('line', `start ${name}`, () => stopCopy(s, row.id));
            else toast('No stopped copies to restart.', 'warn');
          } else if (act === 'minus') {
            const typeId = row.typeId;
            if (removeProcess(s, row.id)) {
              History.push('line', `dismantle ${name}`, () => {
                const back = addProcess(s, typeId);
                if (back.ok) s.cash -= BAL.processCost - Math.round(BAL.processCost * BAL.refund);
              });
            }
          } else {
            const r = addProcess(s, row.typeId);
            if (!r.ok) toast(r.error);
            else {
              History.push('line', `duplicate ${name}`, () => {
                const back = s.rows.find((q) => q.id === row.id);
                if (!back) return;
                back.n--;
                if (back.n <= 0) s.rows = s.rows.filter((q) => q.id !== back.id);
                s.cash += BAL.processCost;
              });
            }
          }
          render(true);
        };
      });
      list.appendChild(el);

      const entry = {
        row: el, kind: row.kind, client,
        recipe: el.querySelector('.precipe'),
        status: el.querySelector('.pstatus'),
        rate: el.querySelector('.prate'),
      };
      if (isShip) {
        entry.bar = el.querySelector('.bar > i');
      } else {
        // One slot per copy, so a row of ×8 reads as eight cycles at eight
        // different points rather than one bar for whichever finishes first.
        const copies = el.querySelector('.copies');
        entry.slots = [];
        if (row.n <= MAX_SLOTS) {
          for (let k = 0; k < row.n; k++) {
            const slot = document.createElement('i');
            slot.className = 'slot';
            copies.appendChild(slot);
            entry.slots.push(slot);
          }
        } else {
          copies.classList.add('agg');
          const bar = document.createElement('i');
          bar.className = 'slot wide';
          copies.appendChild(bar);
          entry.slots.push(bar);
          entry.aggregate = true;
        }
      }
      rows.set(row.id, entry);
    });
  }

  function render(force = false) {
    const s = S();
    const sig = shape(s);
    if (force || sig !== signature) { signature = sig; build(); }
    const rev = host.querySelector('#revno');
    if (rev) rev.textContent = String(s.stats.recorded).padStart(2, '0');

    for (const row of s.rows) {
      const r = rows.get(row.id);
      if (!r) continue;

      if (row.kind === 'ship') {
        const c = r.client;
        const matches = matchingTypes(s, c);
        const held = matches.reduce((n, t) => n + stockOf(s, t.id), 0);
        r.recipe.innerHTML = matches.length
          ? matches.map((t) => `<span class="ing">${esc(t.name)} <b>${stockOf(s, t.id)}</b></span>`).join('')
          : '<span class="ing short">no circuit of yours matches yet</span>';
        r.rate.textContent = `$${payFor(c, matches[0])}/ea`;
        r.bar.style.width = `${Math.min(100, (c.delivered / c.need) * 100)}%`;
        r.status.className = `pstatus${matches.length ? '' : ' warn'}`;
        r.status.textContent = c.complete
          ? `${c.delivered} shipped · maintenance`
          : matches.length
            ? `${c.delivered}/${c.need} shipped${held ? '' : ' · waiting on stock'}`
            : `${c.delivered}/${c.need} · nothing to ship`;
        continue;
      }

      const t = typeOf(s, row.typeId);
      r.recipe.innerHTML = t.ingredients.map((g) => {
        const have = stockOf(s, g.typeId);
        const gate = g.typeId === 'nand';
        const short = !gate && have < g.count;
        return `<span class="ing${short ? ' short' : ''}">${g.count}&times; ${esc(typeOf(s, g.typeId).name)}
          <b>${gate ? 'minted' : have}</b></span>`;
      }).join('');

      const running = row.timers.length;
      const active = activeCopies(row);
      const stopped = row.stopped || 0;
      if (r.aggregate) {
        r.slots[0].style.setProperty('--p', active ? running / active : 0);
      } else {
        // running first, then waiting, then the copies the player switched off
        const rem = row.timers.slice().sort((a, b) => a - b);
        r.slots.forEach((slot, k) => {
          const off = k >= row.n - stopped;
          const busy = !off && k < rem.length;
          slot.classList.toggle('run', busy);
          slot.classList.toggle('off', off);
          slot.style.setProperty('--p', busy ? 1 - Math.max(0, rem[k]) / t.timeMs : 0);
        });
      }
      r.rate.textContent = `${ratePerMin(s, row).toFixed(0)}/min`;

      let state = `${running}/${active} running`;
      let cls = 'pstatus';
      if (!active) {
        state = `stopped (${row.n} idle)`;
      } else if (!running && row.starved) {
        state = row.noCash ? 'no cash for gates' : 'starved';
        cls += ' warn';
      } else if (row.starved) {
        state = `${running}/${active} running, ${row.noCash ? 'short of cash' : 'starved'}`;
        cls += ' warn';
      } else if (!running) {
        state = 'idle';
      }
      if (stopped && active) state += ` · ${stopped} stopped`;
      r.status.className = cls;
      r.status.textContent = state;
    }
  }

  return { render, onKey() {}, setPlacing() {} };
}
