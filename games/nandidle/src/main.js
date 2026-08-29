// main.js — boot, game loop, and the HTML panels around the two screens.

import {
  newGame, save, load, wipe, allTypes, typeOf, stockOf, procOf,
  addProcess, matchingTypes, runTestbench, testCost, matchNote, shipRowFor,
  renameType, deleteType, dependentsOf, procOf as processFor, sayRow, payFor, unlockBase, BAL, log,
  stageOf, stageLeft,
} from './state.js';
import { tick, isStalled, catchUp } from './sim.js';
import { createLineScreen } from './lineScreen.js';
import { createRecordScreen, truthRows, partGeom, termPins } from './recordScreen.js';
import { canonicalName, canonicalGate, essentialInputs, reduceToEssential } from './circuits.js';
import {
  STEPS, stepsOf, openChapter, initTutorial, currentStep, advanceTutorial, skipTutorial, restartTutorial,
} from './tutorial.js';
import { initAudio, sfx, setHum, isMuted, setMuted } from './audio.js';
import * as History from './undo.js';
import { initTips, dueTip, markTip } from './tips.js';
import { symbolSvg } from './symbols.js';
import { valuesOfPorts } from './clients.js';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (ch) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

let state = load() || newGame();
initTutorial(state);
initTips(state);
const ctx = { state };
const getCtx = () => ctx;

initAudio();
$('btnMute').classList.toggle('active', !isMuted());
$('btnMute').textContent = isMuted() ? 'MUTED' : 'SOUND';
$('btnMute').onclick = () => {
  setMuted(!isMuted());
  $('btnMute').classList.toggle('active', !isMuted());
  $('btnMute').textContent = isMuted() ? 'MUTED' : 'SOUND';
  if (!isMuted()) sfx('done');
};
// Every button in the chrome clicks; specific actions add their own voice.
document.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button, select, .part, .prow')) sfx('click');
}, true);

let toastT = null;
function toast(msg, kind = 'bad') {
  if (kind === 'bad') sfx('error');
  const el = $('toast');
  el.textContent = msg;
  el.className = kind === 'bad' ? '' : kind;
  el.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.hidden = true; }, 2800);
}

const line = createLineScreen($('lineSheet'), getCtx, toast);
const rec = createRecordScreen($('recCanvas'), getCtx);
const active = () => (state.screen === 'record' ? rec : line);

// ---------------------------------------------------------------- screens ---

function setScreen(name) {
  state.screen = name;
  $('lineSheet').hidden = name !== 'line';
  $('recCanvas').hidden = name !== 'record';
  $('testSheet').hidden = name !== 'test';
  $('recBar').hidden = name !== 'record';
  $('left').hidden = name === 'test';          // the test bench needs no library
  $('right').hidden = name !== 'record';
  $('btnLibrary').hidden = name === 'test';
  $('btnLibrary').textContent = name === 'line' ? '+ ADD PROCESS' : 'LIBRARY';
  $('btnSetup').hidden = name !== 'record';
  $('legendLine').hidden = name !== 'line';
  $('legendRec').hidden = name !== 'record';
  $('legendTest').hidden = name !== 'test';
  $('stage').className = name;
  $('paletteHint').textContent = name === 'record' ? 'tap to place on the sheet' : 'tap to run as a process';
  for (const b of document.querySelectorAll('.tab[data-screen]')) b.classList.toggle('active', b.dataset.screen === name);
  rec.ui.placing = null;
  closeDrawers();
  libraryDirty = true;
  if (name === 'line') line.render(true);
  if (name === 'record') rec.fit();
  if (name === 'test') renderOrders.sig = null;
}
for (const b of document.querySelectorAll('.tab[data-screen]')) b.onclick = () => setScreen(b.dataset.screen);

// On a phone the side panels are drawers that slide up over the stage; on a
// desktop they are columns and these are no-ops.
function openDrawer(id) { $(id).classList.add('open'); $('scrim').hidden = false; }
function closeDrawers() {
  for (const id of ['left', 'right']) $(id).classList.remove('open');
  $('scrim').hidden = true;
}
$('btnLibrary').onclick = () => openDrawer('left');
$('btnSetup').onclick = () => openDrawer('right');
$('scrim').onclick = closeDrawers;

$('btnMenu').onclick = () => {
  const open = $('menu').hidden;
  $('menu').hidden = !open;
  $('btnMenu').setAttribute('aria-expanded', String(open));
};
document.addEventListener('pointerdown', (e) => {
  if (!$('menu').hidden && !e.target.closest('#menu, #btnMenu')) {
    $('menu').hidden = true;
    $('btnMenu').setAttribute('aria-expanded', 'false');
  }
});

// --------------------------------------------------------- circuit library --

let libraryDirty = true;
const libRows = new Map();

/** What a supplied part costs to draw: gates are priced per gate, wiring is free. */
function mintPrice(t) {
  const cost = t.mintCost ?? BAL.gateCost;
  if (!cost) return 'free — wiring only';
  return t.id === 'nand' ? `$${cost.toFixed(2)} per gate` : `$${cost.toFixed(2)} each`;
}

function buildLibrary() {
  const host = $('palette');
  host.innerHTML = '';
  libRows.clear();
  // The bench defines a recipe, so nothing there is priced or "free": prices
  // belong to the schedule, where a process actually runs.
  const recordMode = state.screen === 'record';
  for (const t of allTypes(state)) {
    const div = document.createElement('div');
    div.className = 'part';
    const bom = t.ingredients.length
      ? t.ingredients.map((g) => `${g.count}x ${esc(typeOf(state, g.typeId).name)}`).join(' + ')
      : (t.blurb || (recordMode ? 'supplied part' : 'minted on demand'));
    // A part with eight single-wire ports should not spell all eight out.
    const fmt = (ps) => {
      const named = ps.map((p) => p.name + (p.width > 1 ? `[${p.width}]` : ''));
      return named.length > 4 ? `${named[0]}…${named[named.length - 1]} (${named.length})` : named.join(', ');
    };
    const ports = `${fmt(t.inPorts || (t.inNames || []).map((n) => ({ name: n, width: 1 })))} → ${
      fmt(t.outPorts || (t.outNames || ['Y']).map((n) => ({ name: n, width: 1 })))}`;
    div.innerHTML = `
      <div class="name">${symbolSvg(t.symbol || 'box', { label: t.symbolLabel, inputs: t.arity, width: 34, bubbles: t.symbolBubbles || [] })}
        <span class="nm">${esc(t.name)}</span><em>${esc(ports)}</em>
        ${t.origin === 'base' ? '' : `<span class="tools">
          <button class="icon" data-act="rename" title="rename">&#9998;</button>
          <button class="icon" data-act="scrap" title="scrap this design">&times;</button>
        </span>`}</div>
      <div class="meta">${t.origin === 'base' ? (recordMode ? '' : mintPrice(t)) : `${(t.timeMs / 1000).toFixed(1)}s cycle`}
        <span class="cost"></span></div>
      <div class="bom">${bom}</div>
      <div class="tally"></div>`;
    div.querySelectorAll('.icon').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        if (b.dataset.act === 'rename') startRename(div, t);
        else scrapCircuit(t);
      };
    });
    div.onclick = () => {
      closeDrawers();                   // on a phone the library is a drawer over the stage
      if (state.screen === 'record') {
        rec.setPlacing(rec.ui.placing === t.id ? null : t.id);
        libraryDirty = true;
        return;
      }
      const r = addProcess(state, t.id);
      if (!r.ok) toast(r.error);
      else {
        sfx('place');
        History.push('line', `add ${t.name}`, () => {
          const row = processFor(state, t.id);
          if (!row) return;
          row.n--;
          if (row.n <= 0) state.rows = state.rows.filter((q) => q.id !== row.id);
          state.cash += BAL.processCost;      // a full refund: it never ran
          line.render(true);
        });
        if (r.duplicated) toast(`${t.name} duplicated — now ×${r.proc.n}.`, 'warn');
      }
      line.render(true);
    };
    host.appendChild(div);
    libRows.set(t.id, { el: div, tally: div.querySelector('.tally'), cost: div.querySelector('.cost') });
  }
}

function renderLibrary() {
  const sig = allTypes(state).map((t) => t.id).join('|') + ':' + state.screen;
  if (libraryDirty || sig !== renderLibrary.sig) {
    renderLibrary.sig = sig; libraryDirty = false; buildLibrary();
  }
  for (const t of allTypes(state)) {
    const r = libRows.get(t.id);
    if (!r) continue;
    const recordMode = state.screen === 'record';
    const proc = procOf(state, t.id);
    r.cost.textContent = recordMode || t.origin === 'base' ? '' : `· $${BAL.processCost} to run`;
    r.tally.innerHTML = t.origin === 'base'
      ? ''
      : `${proc ? `<span class="runs">×${proc.n} running</span> · ` : ''}stock <b>${stockOf(state, t.id)}</b>`;
    r.el.classList.toggle('sel', recordMode && rec.ui.placing === t.id);
    r.el.classList.toggle('poor', !recordMode && t.origin !== 'base' && state.cash < BAL.processCost);
  }
}

// ----------------------------------------------------------------- tutorial --

let glowing = null;
function setGlow(selector) {
  if (glowing === selector) return;
  document.querySelectorAll('.tut-glow').forEach((el) => el.classList.remove('tut-glow'));
  glowing = selector;
  if (!selector) return;
  document.querySelector(selector)?.classList.add('tut-glow');
}

function renderTutorial() {
  // A stateful order is where a player is most likely to think the game is
  // broken rather than that their circuit is oscillating.
  if (state.clients.some((c) => c.kind === 'seq' && !c.complete)) openChapter(state, 'memory');
  advanceTutorial(state, { state, rec: rec.rec });
  const step = currentStep(state);
  const card = $('tutorial');
  if (!step) {
    card.hidden = true;
    setGlow(null);
    return;
  }
  card.hidden = false;
  if (renderTutorial.id !== step.id) {
    renderTutorial.id = step.id;
    closeDrawers();                   // a drawer would sit over the card and its next target
    const n = state.tutorial.step;
    const chapterSteps = stepsOf(state);
    $('tutStep').textContent = `STEP ${n + 1} OF ${chapterSteps.length}`;
    $('tutMark').textContent = (state.tutorial.chapter || 'opening') === 'memory' ? 'MEMORY' : 'TUTORIAL';
    $('tutTitle').textContent = step.title;
    $('tutBody').textContent = step.body;
    $('tutNext').hidden = !step.last;
    $('tutSkip').textContent = step.last ? 'CLOSE' : 'SKIP TUTORIAL';
    const pips = $('tutPips');
    if (pips.children.length !== chapterSteps.length) {
      pips.innerHTML = chapterSteps.map(() => '<i></i>').join('');
    }
    [...pips.children].forEach((pip, i) => {
      pip.className = i < n ? 'on' : i === n ? 'now' : '';
    });
    card.classList.remove('flash');
    void card.offsetWidth;            // restart the animation on every step
    card.classList.add('flash');
  }
  // Only glow a control the player can actually see right now. On a phone the
  // control may be inside a closed drawer: then glow the button that opens it
  // and say so.
  const target = step.target ? document.querySelector(step.target) : null;
  const opener = target ? drawerOpener(target) : null;      // a closed drawer keeps offsetParent, so ask first
  const visible = !opener && !!target && target.offsetParent !== null;
  setGlow(visible ? step.target : opener ? `#${opener.id}` : null);
  const cta = $('tutCta');
  const want = `${step.cta ? `\u25b6 ${step.cta.toUpperCase()}` : ''}${opener ? ` <small>\u2014 under ${opener.textContent.trim()}</small>` : ''}`;
  if (cta.dataset.was !== want) { cta.dataset.was = want; cta.innerHTML = want; }
}

/** The button that reveals a control hidden in a closed drawer, if there is one to press. */
function drawerOpener(el) {
  const drawer = el.closest('#left, #right');
  if (!drawer || drawer.classList.contains('open')) return null;
  const btn = $(drawer.id === 'left' ? 'btnLibrary' : 'btnSetup');
  return btn && btn.offsetParent !== null ? btn : null;
}

// Notes fire once, when the thing they describe first happens, and never while
// the tutorial is still talking.
let shownTip = null;
let tipUntil = 0;
function renderTip() {
  const card = $('tip');
  if (currentStep(state)) { card.hidden = true; shownTip = null; return; }
  if (shownTip) {
    if (performance.now() > tipUntil) { card.hidden = true; shownTip = null; }
    return;
  }
  const tip = dueTip(state);
  if (!tip) { card.hidden = true; return; }
  markTip(state, tip.id);
  shownTip = tip.id;
  tipUntil = performance.now() + 20000;
  $('tipTitle').textContent = tip.title;
  $('tipBody').textContent = tip.body;
  card.hidden = false;
  sfx('client');
}
$('tipClose').onclick = () => { $('tip').hidden = true; shownTip = null; };

$('tutSkip').onclick = () => { skipTutorial(state); renderTutorial(); };
$('tutNext').onclick = () => { skipTutorial(state); renderTutorial(); };
$('btnTutorial').onclick = () => {
  restartTutorial(state);
  renderTutorial.id = null;
  renderTutorial();
};

/** Rename in place, so the library row stays where it is. */
function startRename(row, type) {
  const span = row.querySelector('.nm');
  const input = document.createElement('input');
  input.className = 'rename';
  input.value = type.name;
  input.maxLength = 22;
  span.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    if (commit) {
      const was = type.name;
      const r = renameType(state, type.id, input.value);
      if (!r.ok) toast(r.error);
      else if (type.name !== was) {
        History.push('line', `rename ${was}`, () => { renameType(state, type.id, was); libraryDirty = true; line.render(true); });
      }
    }
    libraryDirty = true;
    renderLibrary();
    line.render(true);
  };
  input.onblur = () => finish(true);
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  };
  input.onclick = (e) => e.stopPropagation();
}

function scrapCircuit(type) {
  const deps = dependentsOf(state, type.id);
  if (deps.length) {
    toast(`${deps.map((d) => d.name).join(', ')} ${deps.length > 1 ? 'are' : 'is'} built from ${type.name}.`);
    return;
  }
  const row = processFor(state, type.id);
  const held = stockOf(state, type.id);
  const warn = [row ? `its ×${row.n} process` : '', held ? `${held} in stock` : ''].filter(Boolean).join(' and ');
  if (!confirm(`Scrap ${type.name}?${warn ? ` This also dismantles ${warn}.` : ''}`)) return;
  const before = { type: JSON.parse(JSON.stringify(type)), stock: held,
    rows: JSON.parse(JSON.stringify(state.rows)), cash: state.cash };
  const r = deleteType(state, type.id);
  if (!r.ok) { toast(r.error); return; }
  History.push('line', `scrap ${type.name}`, () => {
    state.types[before.type.id] = before.type;
    if (before.stock) state.stock[before.type.id] = before.stock;
    state.rows = before.rows;
    state.cash = before.cash;
    libraryDirty = true;
    line.render(true);
  });
  sfx('scrap');
  toast(`${type.name} scrapped.`, 'warn');
  libraryDirty = true;
  renderOrders.sig = null;
  line.render(true);
}

// --------------------------------------------------------------- readouts ---

function renderReadout() {
  const net = ((state.rateEarn || 0) - (state.rateSpend || 0)) * 60;
  $('readout').innerHTML = `
    <div class="cell"><span class="k">CASH</span><span class="v ${state.cash < 5 ? 'bad' : ''}">$${state.cash.toFixed(2)}</span></div>
    <div class="cell"><span class="k">NET / MIN</span><span class="v ${net >= 0 ? 'good' : 'bad'}">${net >= 0 ? '+' : ''}$${net.toFixed(0)}</span></div>
    <div class="cell"><span class="k">PARTS MINTED</span><span class="v">${state.stats.gates}</span></div>
    <div class="cell"><span class="k">SHIPPED</span><span class="v">${state.stats.delivered}<small style="color:var(--bad)"> / ${state.stats.rejected}</small></span></div>`;
}

let knownClients = state.clients.length;
function announceNewClients() {
  if (state.clients.length <= knownClients) { knownClients = state.clients.length; return; }
  const arrived = state.clients.slice(knownClients);
  knownClients = state.clients.length;
  const c = arrived[arrived.length - 1];
  toast(`New client — ${c.company} wants ${c.want}. A shipping row is waiting at the bottom of the schedule.`, 'info');
  sfx('client');
}

const orderRows = new Map();
function renderOrders() {
  const host = $('clients');
  const sig = state.clients.map((c) => `${c.id}:${stageOf(c)}:${c.seen}:${c.report?.at || 0}`).join('|')
    + '#' + allTypes(state).map((t) => t.id).join(',');
  if (sig !== renderOrders.sig) {
    renderOrders.sig = sig;
    host.innerHTML = '';
    orderRows.clear();
    for (const c of state.clients) {
      const div = document.createElement('div');
      div.className = `client${c.complete ? ' done' : ''}${c.closed ? ' closed' : ''}`;
      const wanted = clientSymbol(c);
      const testable = allTypes(state).filter((t) => t.origin !== 'base');
      div.onclick = () => { if (!c.seen) { c.seen = true; renderOrders.sig = null; } };
      div.innerHTML = `
        <div class="co">${esc(c.company)}${c.seen ? '' : '<b class="new">NEW</b>'}</div>
        <div class="want">${symbolSvg(wanted?.symbol || 'box', { label: wanted?.label || '', inputs: c.arity, width: 32, bubbles: wanted?.bubbles || [] })}
          <span>${esc(c.want)}</span><b>$${payFor(c, matchingTypes(state, c)[0])}/ea</b></div>
        <div class="ports">${esc((c.inPorts || []).map((p) => p.name + (p.width > 1 ? `[${p.width}]` : '')).join(', '))}
          &rarr; ${esc((c.outPorts || []).map((p) => p.name + (p.width > 1 ? `[${p.width}]` : '')).join(', '))}${
  c.stream ? ' <b class="seqchip stream">STREAM</b>' : c.kind === 'seq' ? ' <b class="seqchip">HOLDS STATE</b>' : ''}</div>
        <div class="bar"><i></i></div>
        <div class="brief"></div>
        <div class="ships"></div>
        <div class="testrow">
          <select class="testPick" ${testable.length ? '' : 'disabled'}>
            ${testable.length
              ? testable.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')
              : '<option>nothing to test yet</option>'}
          </select>
          <button class="ghost small test" ${testable.length ? '' : 'disabled'}>TEST $${testCost(c)}</button>
        </div>
        <div class="report"></div>`;
      const pick = div.querySelector('.testPick');
      div.querySelector('.test').onclick = () => {
        const r = runTestbench(state, c.id, pick.value);
        if (!r.ok) { toast(r.error); return; }
        const n = r.report.fails.length;
        toast(r.report.arityMismatch
          ? `${c.company}: wrong number of inputs.`
          : n ? `${c.company}: ${n} of ${r.report.rows} cases wrong.`
              : `${c.company}: all cases correct.`, n || r.report.arityMismatch ? 'warn' : 'info');
        renderOrders.sig = null;
      };
      host.appendChild(div);
      orderRows.set(c.id, {
        div,
        bar: div.querySelector('.bar > i'),
        brief: div.querySelector('.brief'),
        ships: div.querySelector('.ships'),
        report: div.querySelector('.report'),
      });
    }
  }
  for (const c of state.clients) {
    const r = orderRows.get(c.id);
    if (!r) continue;
    r.bar.style.width = `${Math.min(100, (c.delivered / c.need) * 100)}%`;
    const stage = stageOf(c);
    r.brief.textContent = stage === 'closed' ? 'CONTRACT ENDED — they have all they need'
      : stage === 'discount' ? `ORDER FILLED — ${Math.round(BAL.discountPay * 100)}% for ${stageLeft(c)} more`
      : stage === 'maintenance' ? `MAINTENANCE — ${Math.round(BAL.maintenancePay * 100)}% for ${stageLeft(c)} more`
      : c.delivered === 0 ? c.brief : `${c.delivered} / ${c.need} shipped`;

    // Matching is automatic: anything that behaves like the order ships.
    const matches = matchingTypes(state, c);
    const at = state.rows.findIndex((row) => row.kind === 'ship' && row.clientId === c.id);
    r.ships.className = `ships${matches.length ? ' on' : ''}`;
    r.ships.textContent = c.closed
      ? 'no longer buying'
      : matches.length
        ? `shipping ${matches.map((t) => t.name).join(', ')}${at < 0 ? '' : ` from schedule row ${String(at + 1).padStart(2, '0')}`}`
        : 'no circuit of yours behaves like this yet';

    if (c.report !== r.shown) {
      r.shown = c.report;
      r.report.innerHTML = c.report ? reportHtml(c, c.report) : '';
    }
  }
  $('btnGrant').hidden = !isStalled(state);
}

/** A client's symbol: its own if it declared one, else the catalogue's. */
function clientSymbol(c) {
  if (c.symbol) return { symbol: c.symbol, label: c.label || '' };
  return c.table !== null && c.table !== undefined ? canonicalGate(c.arity, c.table) : null;
}

/** The testbench result: exactly which input assignments come back wrong. */
function reportHtml(c, rep) {
  if (rep.arityMismatch) {
    return `<div class="rhead bad">TESTBENCH · ${esc(rep.typeName)}</div>
      <div class="rline">Wrong shape: ${rep.arityMismatch.got} input${rep.arityMismatch.got === 1 ? '' : 's'},
      the order is a ${rep.arityMismatch.want}-input circuit.</div>`;
  }
  const unit = rep.sequential ? 'STEPS' : 'CASES';
  if (!rep.fails.length) {
    return `<div class="rhead good">TESTBENCH · ${esc(rep.typeName)} · ALL ${rep.rows} ${unit} PASS</div>`;
  }
  const outNames = c.outNames || [c.outName || 'OUT'];
  const ports = c.inPorts || (c.inNames || []).map((n) => ({ name: n, width: 1 }));
  const say = (bits) => valuesOfPorts(ports, bits).map((v, i) => `${esc(ports[i].name)}=${v}`).join(' ');
  const line = (f) => (rep.sequential
    ? `<div class="rline"><span>step ${f.step}: ${say(f.inputs)}</span>
        <b>${esc(outNames[f.out] || 'OUT')} should be ${f.want}</b></div>`
    : `<div class="rline"><span>${esc(sayRow(c, f.row))}</span>
        <b>${esc(outNames[f.out || 0] || 'OUT')} should be ${f.want}</b></div>`);
  return `<div class="rhead bad">TESTBENCH · ${esc(rep.typeName)} · ${rep.fails.length} OF ${rep.rows} ${unit} WRONG</div>
    ${rep.fails.slice(0, 12).map(line).join('')}
    ${rep.fails.length > 12 ? `<div class="rline"><span>and ${rep.fails.length - 12} more</span></div>` : ''}`;
}

function renderAnalysis() {
  const host = $('analysis');
  const r = rec.preview();
  const partCount = rec.rec.parts.length;
  if (!r.ok) {
    host.innerHTML = `<div class="verdict err"><div class="t">INCOMPLETE</div><div class="small">${esc(r.error)}</div></div>
      <div class="kv"><span>circuits placed</span><span>${partCount}</span></div>`;
    return;
  }
  const named = r.kind === 'comb' && r.outCount === 1 && r.table !== null;
  const match = named ? canonicalGate(r.arity, r.table) : null;
  const name = match?.name || null;
  const typed = $('recName').value.trim();
  const inPorts = r.inPorts || rec.rec.inNames.slice(0, r.arity).map((name) => ({ name, width: 1 }));
  const outPorts = r.outPorts || rec.rec.outNames.slice(0, r.outCount).map((name) => ({ name, width: 1 }));
  const bom = [...r.used.entries()].map(([id, n]) => `${n}x ${esc(typeOf(state, id).name)}`).join(' + ');
  const cycle = Math.min(BAL.recordMaxMs, Math.max(BAL.recordMinMs, rec.rec.elapsed)) / 1000;

  // A port eight wires wide is a byte: show it as one, not as eight columns.
  const wide = [...inPorts, ...outPorts].some((p) => p.width > 1);
  const cell = (v, port) => (port.width > 1
    ? `<td class="val">${v}</td>`
    : `<td class="o o${v}">${v}</td>`);
  const head = `<tr>${inPorts.map((p) => `<th>${esc(p.name)}${p.width > 1 ? `[${p.width}]` : ''}</th>`).join('')}${
    outPorts.map((p) => `<th>${esc(p.name)}${p.width > 1 ? `[${p.width}]` : ''}</th>`).join('')}</tr>`;

  let body;
  if (r.kind !== 'comb') {
    // No truth table: what it did, step by step, which is also how it is judged.
    const shown = r.rows.slice(0, 10);
    body = `
      <table class="tt">
        <tr><th>STEP</th>${head.slice(4)}
        ${shown.map((row, i) => {
    const ins = valuesOfPorts(inPorts, row.inputs);
    const outs = valuesOfPorts(outPorts, row.outs);
    return `<tr><td>${i}</td>${ins.map((v, k) => cell(v, inPorts[k])).join('')}${
      outs.map((v, k) => cell(v, outPorts[k])).join('')}</tr>`;
  }).join('')}
      </table>
      <div class="kv"><span>exercise</span><span>${shown.length} of ${r.rows.length} steps shown</span></div>`;
  } else {
    const rows = 1 << r.inBits;
    const cap = Math.min(rows, wide ? 12 : 16);
    const cells = [];
    for (let row = 0; row < cap; row++) {
      const inBits = Array.from({ length: r.inBits }, (_, b) => (row >>> b) & 1);
      const outBits = r.tables.map((t) => t[row]);
      const ins = valuesOfPorts(inPorts, inBits);
      const outs = valuesOfPorts(outPorts, outBits);
      cells.push(`<tr>${ins.map((v, k) => cell(v, inPorts[k])).join('')}${
        outs.map((v, k) => cell(v, outPorts[k])).join('')}</tr>`);
    }
    body = `
      <table class="tt">${head}${cells.join('')}</table>
      ${rows > cap ? `<div class="kv"><span>truth table</span><span>${cap} of ${rows} rows shown</span></div>` : ''}`;
  }

  const headline = r.kind === 'wide'
    ? `${r.inBits}-BIT CIRCUIT`
    : r.kind === 'seq'
      ? 'HOLDS STATE'
    : (name || (r.outCount > 1 ? `${r.outCount}-OUTPUT CIRCUIT` : 'UNCATALOGUED CIRCUIT'));
  const sub = r.kind === 'wide'
    ? `too wide to tabulate — ${r.inBits} inputs is ${2 ** Math.min(r.inBits, 30)} rows`
    : r.kind === 'seq'
      ? 'feedback: what it does depends on what it did'
    : name ? 'matched on behaviour — its truth table is in the catalogue'
      : `${r.arity} in, ${r.outCount} out`;
  const note = r.kind !== 'comb'
    ? `Identified by its response to a standard ${r.rows.length}-step exercise rather than a truth table.${
      r.stable ? '' : ' It never settles — treated as free-running.'}${
      r.orderSensitive ? ` ${r.raced.length} of those steps come out differently depending on which gate settles first — a race, and not counted as behaviour.` : ''}${
      r.startDependent ? ' It cannot be driven into a known state from cold, so what it does depends on how it wakes up.' : ''}${
      r.coarse ? ' Too large to examine closely: it is watched briefly, so two designs this size may look alike to the library.' : ''}`
    : name
      ? (typed ? `Your name is kept; the ${esc(name)} symbol will be applied automatically.`
        : `Will be named ${esc(name)} and given its symbol automatically. Type a name to override.`)
      : `No catalogue match — it will be drawn as a generic block labelled with its name.${esc(unusedNote(r))}`;

  host.innerHTML = `
    <div class="verdict ${r.stable ? 'ok' : 'err'}">
      <div class="vhead">
        ${symbolSvg(match?.symbol || 'box', {
          label: match?.label || (r.kind === 'seq' ? 'ST' : (typed || 'NEW').slice(0, 5).toUpperCase()),
          inputs: r.arity, width: 54, bubbles: match?.bubbles || [],
        })}
        <div>
          <div class="t">${esc(headline)}</div>
          <div class="small">${sub}</div>
        </div>
      </div>
      <div class="note">${note}</div>
    </div>
    ${body}
    <div class="kv"><span>draws per cycle</span><span>${bom}</span></div>
    <div class="kv"><span>ports</span><span>${inPorts.map((p) => p.width).join('+')} in, ${outPorts.map((p) => p.width).join('+')} out</span></div>
    <div class="kv"><span>NAND gates</span><span>${r.flat.gates.length} ($${(r.flat.gates.length * BAL.gateCost).toFixed(2)}/unit)</span></div>
    <div class="kv"><span>cycle time</span><span>${cycle.toFixed(1)}s</span></div>
    <div class="kv"><span>process cost</span><span>$${BAL.processCost}</span></div>`;
}

/** Say when a circuit ignores an input — usually why it failed to match. */
function unusedNote(r) {
  if (r.table === null || r.arity > 5) return '';
  const keep = essentialInputs(r.arity, r.table);
  if (keep.length === r.arity) return '';
  const names = rec.rec.inNames.slice(0, r.arity);
  const idle = names.filter((_, i) => !keep.includes(i));
  const red = reduceToEssential(r.arity, r.table);
  const asName = canonicalName(red.arity, red.table);
  const on = keep.map((i) => names[i]).join(', ');
  return ` Output ignores ${idle.join(', ')}${asName ? `; on ${on} alone this is ${asName}.` : '.'}`;
}

// ---------------------------------------------------------------- controls --

let termsDirty = true;

/** What the terminal panel is currently showing, so it can notice for itself
 *  when the bench's terminals have changed under it. */
function terminalSignature() {
  const r = rec.rec;
  return [
    r.arity, r.outCount,
    r.inNames.slice(0, r.arity).join(','), r.inWidths.slice(0, r.arity).join(','),
    r.outNames.slice(0, r.outCount).join(','), r.outWidths.slice(0, r.outCount).join(','),
  ].join('|');
}

/** One text box per terminal. Rebuilt only when the terminal set changes — which
 *  it works out itself, so no caller has to remember — and never while the value
 *  in a box differs from the state behind it, so typing is not clobbered. */
function renderTerminals() {
  renderTerminals.sig = terminalSignature();
  const host = $('termNames');
  host.innerHTML = '';
  const add = (key, labelClass, read, write, side, index) => {
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
    // How many wires this port carries: one is a wire, eight is a byte.
    const width = document.createElement('select');
    width.className = 'w';
    width.innerHTML = [1, 2, 3, 4, 8].map((w) =>
      `<option value="${w}"${(side === 'in' ? rec.rec.inWidths[index] : rec.rec.outWidths[index]) === w ? ' selected' : ''}>${w === 1 ? 'wire' : `${w} bit`}</option>`).join('');
    width.onchange = () => { rec.setWidth(side, index, +width.value); termsDirty = true; };
    host.append(tag, input, width);
  };
  for (let i = 0; i < rec.rec.arity; i++) {
    add(`IN ${i + 1}`, '', () => rec.rec.inNames[i], (v) => rec.setInName(i, v), 'in', i);
  }
  for (let i = 0; i < rec.rec.outCount; i++) {
    add(`OUT ${i + 1}`, 'out', () => rec.rec.outNames[i], (v) => rec.setOutName(i, v), 'out', i);
  }
  $('arityVal').textContent = rec.rec.arity;
  $('outsVal').textContent = rec.rec.outCount;
}

function renderImportPicker() {
  const sel = $('importPick');
  const want = state.clients.map((c) => `${c.id}:${c.company}:${c.want}`).join('|');
  if (sel.dataset.sig === want) return;
  sel.dataset.sig = want;
  sel.innerHTML = state.clients.map((c) =>
    `<option value="${esc(c.id)}">${esc(c.want)} — ${esc(c.company)}${c.complete ? ' (filled)' : ''}</option>`).join('');
  const open = state.clients.find((c) => !c.complete);
  if (open) sel.value = open.id;   // default to the commission still owed
}

$('btnImport').onclick = () => {
  const client = state.clients.find((c) => c.id === $('importPick').value);
  const name = rec.importCommission(client);
  if (name !== null && name !== undefined) $('recName').value = name;
  termsDirty = true;
};
$('arityUp').onclick = () => { rec.setArity(rec.rec.arity + 1); termsDirty = true; };
$('arityDown').onclick = () => { rec.setArity(rec.rec.arity - 1); termsDirty = true; };
$('outsUp').onclick = () => { rec.setOutCount(rec.rec.outCount + 1); termsDirty = true; };
$('outsDown').onclick = () => { rec.setOutCount(rec.rec.outCount - 1); termsDirty = true; };
// One button: it starts the stopwatch, and while the clock runs it stops it and
// commits the recording. The dot pulses while recording.
$('btnRecord').onclick = () => {
  if (!rec.rec.recording) {
    rec.start();
    sfx('record');
    renderRecordBar();
    return;
  }
  const t = rec.finish($('recName').value);
  if (!t) return;
  sfx('done');
  toast(matchNote(t), t.matched ? 'info' : 'warn');
  $('recName').value = '';
  resetRecordControls();
  libraryDirty = true;
  setScreen('line');
};
$('btnDiscard').onclick = () => { rec.reset(); resetRecordControls(); };
$('btnFit').onclick = () => rec.fit();
function renderRecordBar() {
  const on = rec.rec.recording;
  const b = $('btnRecord');
  b.classList.toggle('on', on);
  b.querySelector('.lbl').textContent = on ? 'STOP' : 'RECORD';
  b.querySelector('.clock').textContent = on ? `${(rec.rec.elapsed / 1000).toFixed(1)}s` : '';
  $('btnDiscard').hidden = !on;
}
function resetRecordControls() {
  termsDirty = true;
  renderRecordBar();
  renderTerminals();
}
$('btnGrant').textContent = `ADVANCE ($${BAL.grantAmount})`;
$('btnGrant').onclick = () => {
  sfx('cash');
  state.cash += BAL.grantAmount;
  log(state, 'warn', 'Investor advance drawn', `$${BAL.grantAmount} added to keep the line moving.`);
};
$('btnReset').onclick = () => {
  if (!confirm('Scrap the shop and start a new game?')) return;
  wipe();
  state = newGame();
  initTutorial(state);
  initTips(state);
  shownTip = null;
  renderTutorial.id = null;
  ctx.state = state;
  rec.reset(); resetRecordControls();
  renderOrders.sig = null;
  libraryDirty = true;
  setScreen('line');
};

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    runUndo();
    return;
  }
  active().onKey(e);
});

function runUndo() {
  const scope = state.screen === 'record' ? 'bench' : 'line';
  const label = History.undo(scope);
  if (!label) { toast('Nothing to undo.', 'warn'); return; }
  sfx('unwire');
  toast(`Undid: ${label}`, 'warn');
  libraryDirty = true;
  renderOrders.sig = null;
  if (scope === 'line') line.render(true);
}
$('btnUndo').onclick = runUndo;

// The shop keeps working while the tab is shut; the first thing you see on
// coming back is what it did.
if (state.awayMs > 60000) {
  const away = catchUp(state, state.awayMs, BAL.offlineStepMs);
  state.awayMs = 0;
  const mins = Math.round(away.ms / 60000);
  const spell = mins >= 120 ? `${(mins / 60).toFixed(1)} hours` : `${mins} minutes`;
  log(state, 'good', `Ran unattended for ${spell}`,
    `${away.produced} circuits made, ${away.delivered} shipped, $${away.earned.toFixed(2)} banked.`,
    'Output while away is counted conservatively — a cycle shorter than a second only runs once a second.');
  setTimeout(() => toast(`Back after ${spell}: $${away.earned.toFixed(2)} banked, ${away.delivered} shipped.`, 'info'), 400);
}

// ------------------------------------------------------------------- loop ---

let last = performance.now();
let hudAcc = 0;
let saveAcc = 0;

function frame(now) {
  const dt = Math.min(250, now - last);      // never longer than BAL.recordMinMs
  last = now;

  const before = state.stats.delivered;
  tick(state, dt);                        // the shop runs on both screens
  if (state.stats.delivered > before) sfx('ship');
  if (state.screen === 'record') rec.render(dt);

  hudAcc += dt;
  if (hudAcc > 120) {
    hudAcc = 0;
    const busy = state.rows.reduce((n, r) => n + (r.timers?.length || 0), 0);
    setHum(Math.min(1, busy / 12));
    renderReadout();
    renderLibrary();
    renderTutorial();
    renderTip();
    announceNewClients();
    const label = History.peek(state.screen === 'record' ? 'bench' : 'line');
    $('btnUndo').disabled = !label;
    $('btnUndo').textContent = label ? `UNDO ${label.toUpperCase()}`.slice(0, 26) : 'UNDO';
    renderOrders();                       // the test bench, and the advance button
    if (state.screen === 'line') {
      line.render();
    } else if (state.screen === 'record') {
      renderAnalysis();
      renderImportPicker();
      renderRecordBar();
      if (termsDirty || renderTerminals.sig !== terminalSignature()) {
        termsDirty = false;
        renderTerminals();
      }
    }
  }
  saveAcc += dt;
  if (saveAcc > 5000) {
    saveAcc = 0;
    $('saveNote').textContent = save(state) ? `saved ${new Date().toLocaleTimeString()}` : 'save failed';
  }
  requestAnimationFrame(frame);
}

setScreen('line');
resetRecordControls();
renderTutorial();
renderLibrary();
renderOrders();
requestAnimationFrame(frame);

// Handy in the console, and the handle tools/browsertest.mjs drives.
window.game = {
  get state() { return state; },
  line, rec, setScreen, toast, BAL,
  unlock: (id) => unlockBase(state, id),
  tutorialStep: () => currentStep(state)?.id || null,
  recGeom: (p) => partGeom(state, p),
  recTerms: () => termPins(rec.rec),
};

// Optional scripted scenario for screenshots and manual testing:
//   index.html?scenario=demo   (see tools/scenario.js)
const scenario = new URLSearchParams(location.search).get('scenario');
if (scenario) {
  import('../tools/scenario.js').then((m) => {
    m.run(scenario, { state, ctx, line, rec, setScreen });
    libraryDirty = true;
    renderOrders.sig = null;
    line.render(true);
  }).catch(() => {
    // The scenarios are a development tool and are not deployed; asking for one
    // on a published build should do nothing rather than throw.
    toast('That scenario is not available in this build.', 'warn');
  });
}
