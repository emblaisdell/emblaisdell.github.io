// main.js — boot, game loop, and the HTML side panels.

import { newGame, save, load, wipe, allTypes, typeOf, BAL, log } from './state.js';
import { tick, isStalled } from './sim.js';
import { createFabScreen, nodeGeom } from './fabScreen.js';
import { createRecordScreen, truthRows, partGeom, termPins } from './recordScreen.js';
import { canonicalName, INPUT_NAMES } from './circuits.js';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (ch) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
let state = load() || newGame();
const ctx = { state };
const getCtx = () => ctx;

const fab = createFabScreen($('fabCanvas'), getCtx);
const rec = createRecordScreen($('recCanvas'), getCtx);
const active = () => (state.screen === 'record' ? rec : fab);

// ---------------------------------------------------------------- screens ---

function setScreen(name) {
  state.screen = name;
  $('fabCanvas').hidden = name !== 'fab';
  $('recCanvas').hidden = name !== 'record';
  $('fabSide').hidden = name !== 'fab';
  $('recSide').hidden = name !== 'record';
  $('paletteHint').textContent = name === 'record' ? 'free copies while recording' : 'click, then click the sheet';
  for (const b of document.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.screen === name);
  fab.ui.placing = null; rec.ui.placing = null;
  paletteDirty = true;
}
for (const b of document.querySelectorAll('.tab')) b.onclick = () => setScreen(b.dataset.screen);

// --------------------------------------------------------------- palette ----

let paletteDirty = true;
let lastCashBucket = -1;

function renderPalette() {
  const host = $('palette');
  const placing = active().ui.placing;
  host.innerHTML = '';
  for (const t of allTypes(state)) {
    const div = document.createElement('div');
    const poor = state.screen === 'fab' && state.cash < t.cost;
    div.className = `part${placing === t.id ? ' sel' : ''}${poor ? ' poor' : ''}`;
    const bom = t.ingredients.length
      ? t.ingredients.map((g) => `${g.count}x ${esc(typeOf(state, g.typeId).name)}`).join(' + ')
      : 'minted at the source';
    const ports = `${(t.inNames || []).join(', ')} \u2192 ${t.outName || 'Y'}`;
    div.innerHTML = `
      <div class="name">${esc(t.name)}<em>${esc(ports)}</em></div>
      <div class="meta">${t.id === 'nand' ? 'from the source node' : `${(t.timeMs / 1000).toFixed(1)}s cycle`}
        <span class="cost">${state.screen === 'record' ? '· free copy' : t.id === 'nand' ? '' : `· $${t.cost}`}</span></div>
      <div class="bom">${bom}</div>`;
    div.onclick = () => {
      if (state.screen === 'fab' && t.id === 'nand') { fab.toast('NAND comes from the source node, not the inventory.', 'warn'); return; }
      active().setPlacing(placing === t.id ? null : t.id);
      paletteDirty = true;
    };
    host.appendChild(div);
  }
}

// --------------------------------------------------------------- readouts ---

function renderReadout() {
  const net = ((state.rateEarn || 0) - (state.rateSpend || 0)) * 60;
  $('readout').innerHTML = `
    <div class="cell"><span class="k">CASH</span><span class="v ${state.cash < 5 ? 'bad' : ''}">$${state.cash.toFixed(2)}</span></div>
    <div class="cell"><span class="k">NET / MIN</span><span class="v ${net >= 0 ? 'good' : 'bad'}">${net >= 0 ? '+' : ''}$${net.toFixed(0)}</span></div>
    <div class="cell"><span class="k">GATES MINTED</span><span class="v">${state.stats.gates}</span></div>
    <div class="cell"><span class="k">SHIPPED</span><span class="v">${state.stats.delivered}<small style="color:var(--bad)"> / ${state.stats.rejected}</small></span></div>`;
}

function renderClients() {
  const host = $('clients');
  host.innerHTML = '';
  for (const c of state.nodes.filter((n) => n.kind === 'client')) {
    const div = document.createElement('div');
    div.className = `client${c.complete ? ' done' : ''}`;
    const pct = Math.min(100, (c.delivered / c.need) * 100);
    div.innerHTML = `
      <div class="co">${esc(c.company)}</div>
      <div class="want">${esc(c.want)}<span>$${c.complete ? Math.round(c.pay * BAL.maintenancePay) : c.pay}/ea</span></div>
      <div class="ports">${esc((c.inNames || []).join(', '))} &rarr; ${esc(c.outName || 'OUT')}</div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="brief">${c.complete ? 'ORDER FILLED — maintenance contract'
        : c.delivered === 0 ? esc(c.brief) : `${c.delivered} / ${c.need} shipped`}</div>
      ${c.lastError ? `<div class="err">${esc(c.lastError)}</div>` : ''}`;
    host.appendChild(div);
  }
  $('btnGrant').hidden = !isStalled(state);
}

function renderLog() {
  $('log').innerHTML = state.log.map((e) => `
    <div class="entry ${e.kind}">${esc(e.text)}${e.detail ? `<div class="d">${esc(e.detail)}</div>` : ''}</div>`).join('');
}

function renderAnalysis() {
  const host = $('analysis');
  const r = rec.preview();
  const partCount = rec.rec.parts.length;
  if (!r.ok) {
    host.innerHTML = `<div class="verdict err"><div class="t">INCOMPLETE</div><div class="small">${r.error}</div></div>
      <div class="kv"><span>circuits placed</span><span>${partCount}</span></div>`;
    $('btnDone').disabled = !rec.rec.recording;
    return;
  }
  const name = canonicalName(r.arity, r.table);
  const rows = truthRows(r.arity, r.table);
  const bom = [...r.used.entries()].map(([id, n]) => `${n}x ${esc(typeOf(state, id).name)}`).join(' + ');
  const gateEquiv = [...r.used.entries()].reduce((s, [id, n]) => s + n * typeOf(state, id).gateEquiv, 0);
  const cycle = Math.min(BAL.recordMaxMs, Math.max(BAL.recordMinMs, rec.rec.elapsed)) / 1000;
  host.innerHTML = `
    <div class="verdict ok">
      <div class="t">${esc(name || 'UNCATALOGUED CIRCUIT')}</div>
      <div class="small">${name ? 'matches a known circuit' : `arity ${r.arity}, table 0x${r.table.toString(16).toUpperCase()}`}</div>
    </div>
    <table class="tt">
      <tr>${rec.rec.inNames.slice(0, r.arity).map((n) => `<th>${esc(n)}</th>`).join('')}<th>${esc(rec.rec.outName)}</th></tr>
      ${rows.map((row) => `<tr>${row.ins.map((b) => `<td>${b}</td>`).join('')}<td class="o o${row.out}">${row.out}</td></tr>`).join('')}
    </table>
    <div class="kv"><span>bill of materials</span><span>${bom}</span></div>
    <div class="kv"><span>NAND equivalents</span><span>${gateEquiv} ($${(gateEquiv * BAL.gateCost).toFixed(2)}/unit)</span></div>
    <div class="kv"><span>cycle time</span><span>${cycle.toFixed(1)}s</span></div>
    <div class="kv"><span>place cost</span><span>$${Math.round(10 + 2 * gateEquiv)}</span></div>`;
  $('btnDone').disabled = !rec.rec.recording;
}

// ---------------------------------------------------------------- controls --

let termsDirty = true;

/** One text box per terminal. Rebuilt only when the terminal set changes, so
 *  typing is never clobbered by the HUD refresh. */
function renderTerminals() {
  const host = $('termNames');
  host.innerHTML = '';
  const add = (key, labelClass, read, write) => {
    const tag = document.createElement('div');
    tag.className = `t ${labelClass}`;
    tag.textContent = key;
    const input = document.createElement('input');
    input.value = read();
    input.maxLength = 6;
    input.spellcheck = false;
    const commit = () => { write(input.value); input.value = read(); };  // echo back the cleaned name
    input.onchange = commit;
    input.onblur = commit;
    input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); };
    host.append(tag, input);
  };
  for (let i = 0; i < rec.rec.arity; i++) {
    add(`IN ${i + 1}`, '', () => rec.rec.inNames[i], (v) => rec.setInName(i, v));
  }
  add('OUT', 'out', () => rec.rec.outName, (v) => rec.setOutName(v));
  $('arityVal').textContent = rec.rec.arity;
}

function renderImportPicker() {
  const sel = $('importPick');
  const clients = state.nodes.filter((n) => n.kind === 'client');
  const want = clients.map((c) => `${c.id}:${c.company}:${c.want}`).join('|');
  if (sel.dataset.sig === want) return;
  sel.dataset.sig = want;
  sel.innerHTML = clients.map((c) =>
    `<option value="${esc(c.id)}">${esc(c.want)} \u2014 ${esc(c.company)}${c.complete ? ' (filled)' : ''}</option>`).join('');
  const open = clients.find((c) => !c.complete);
  if (open) sel.value = open.id;   // default to the commission still owed
}

$('btnImport').onclick = () => {
  const client = state.nodes.find((n) => n.id === $('importPick').value);
  const name = rec.importCommission(client);
  if (name !== null && name !== undefined) $('recName').value = name;
  termsDirty = true;
};
$('arityUp').onclick = () => { rec.setArity(rec.rec.arity + 1); termsDirty = true; };
$('arityDown').onclick = () => { rec.setArity(rec.rec.arity - 1); termsDirty = true; };
$('btnRecord').onclick = () => {
  rec.start();
  $('btnRecord').disabled = true;
  $('btnRecord').textContent = 'RECORDING';
  $('btnRecord').classList.add('rec');
  $('recHint').textContent = 'Stopwatch running. Place circuits, wire them to the terminals, then press DONE.';
};
$('btnDone').onclick = () => {
  const t = rec.finish($('recName').value);
  if (!t) return;
  $('recName').value = '';
  resetRecordControls();
  paletteDirty = true;
  setScreen('fab');
};
$('btnDiscard').onclick = () => { rec.reset(); resetRecordControls(); };
function resetRecordControls() {
  termsDirty = true;
  $('btnRecord').disabled = false;
  $('btnRecord').textContent = 'RECORD';
  $('btnRecord').classList.remove('rec');
  $('recHint').textContent = 'Set the input count, then press RECORD. The stopwatch runs until you press DONE, and that time becomes the subfab\'s cycle time.';
  renderTerminals();
}
$('btnGrant').onclick = () => {
  state.cash += BAL.grantAmount;
  log(state, 'warn', 'Investor advance drawn', `$${BAL.grantAmount} added to keep the line moving.`);
};
$('btnReset').onclick = () => {
  if (!confirm('Scrap the fab and start a new game?')) return;
  wipe();
  state = newGame();
  ctx.state = state;
  rec.reset(); resetRecordControls();
  setScreen('fab');
};

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  active().onKey(e);
});

// ------------------------------------------------------------------- loop ---

let last = performance.now();
let hudAcc = 0;
let saveAcc = 0;

function frame(now) {
  const dt = Math.min(250, now - last);
  last = now;

  tick(state, dt);                       // the fab runs on both screens
  active().render(dt);

  hudAcc += dt;
  if (hudAcc > 120) {
    hudAcc = 0;
    renderReadout();
    const bucket = Math.floor(state.cash / 5);
    if (paletteDirty || bucket !== lastCashBucket) { lastCashBucket = bucket; paletteDirty = false; renderPalette(); }
    if (state.screen === 'fab') {
      renderClients(); renderLog();
    } else {
      renderAnalysis();
      renderImportPicker();
      if (termsDirty) { termsDirty = false; renderTerminals(); }
    }
  }
  saveAcc += dt;
  if (saveAcc > 5000) {
    saveAcc = 0;
    $('saveNote').textContent = save(state) ? `saved ${new Date().toLocaleTimeString()}` : 'save failed';
  }
  requestAnimationFrame(frame);
}

setScreen('fab');
resetRecordControls();
renderPalette();
renderClients();
renderLog();
requestAnimationFrame(frame);

// Handy in the console, and the handle tools/browsertest.mjs drives.
window.game = {
  get state() { return state; },
  fab, rec, setScreen,
  fabGeom: (n) => nodeGeom(state, n),
  recGeom: (p) => partGeom(state, p),
  recTerms: () => termPins(rec.rec),
};

// Optional scripted scenario for screenshots and manual testing:
//   index.html?scenario=demo   (see tools/scenario.js)
const scenario = new URLSearchParams(location.search).get('scenario');
if (scenario) {
  import('../tools/scenario.js').then((m) => {
    m.run(scenario, { state, ctx, fab, rec, setScreen });
    paletteDirty = true;
  });
}
