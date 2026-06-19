// Game engine: loads the level chain, drives the multi-language playground, and
// gates progress on entering each level's 10-digit code (which decrypts the next).
import { fetchAndDecrypt } from './crypto.js';
import { decodeDisplay, renderDisplay, renderFixed, displayToImage } from './qrender.js';
import { createRuntimes } from './runtimes.js';

const ENTRY = 'levels/intro.json';
const KEY_SOL = 'qrgame.solutions';
const KEY_CODE = 'qrgame.code';

const $ = (id) => document.getElementById(id);
const el = {
  loading: $('loading'), loadingText: $('loading-text'),
  story: $('story'), broken: $('broken'), fixed: $('fixed'), fixedWrap: $('fixed-wrap'),
  codeEntry: $('code-entry'), secret: $('secret'), submit: $('submit'), feedback: $('feedback'),
  code: $('code'), gutter: $('gutter'), console: $('console'), run: $('run'), resetCode: $('reset-code'),
  right: $('right'),
  tabs: $('lang-tabs'), rtLoading: $('rt-loading'), rtLoadingText: $('rt-loading-text'),
};

let current = null; // current level object
let history = []; // [{image, id}] of previous levels, oldest first -> qr.seen
let currentImage = null; // displayToImage of the current level

const onFixed = (pixels) => renderFixed(el.fixed, pixels);
const runtimes = createRuntimes(onFixed);
let activeId = 'js'; // JavaScript is the default (native, no download)
const activeRt = () => runtimes.map[activeId];
const seenImages = () => history.map((h) => h.image);

// Feed the active runtime the pristine QR state (discards any in-place edits).
function loadActive() {
  const rt = activeRt();
  if (rt.ready && currentImage) rt.loadQR(currentImage, seenImages());
}

// ---- persistence (code is stored per level *and* language) ----------------
const loadSolutions = () => {
  try { return JSON.parse(localStorage.getItem(KEY_SOL)) || []; } catch { return []; }
};
const saveSolutions = (arr) => localStorage.setItem(KEY_SOL, JSON.stringify(arr));
const codeStore = () => {
  try { return JSON.parse(localStorage.getItem(KEY_CODE)) || {}; } catch { return {}; }
};
const codeKey = (id, lang) => id + ':' + lang;
const getCode = (id, lang) => codeStore()[codeKey(id, lang)];
const setCode = (id, lang, code) => {
  const s = codeStore(); s[codeKey(id, lang)] = code; localStorage.setItem(KEY_CODE, JSON.stringify(s));
};

// ---- editor ---------------------------------------------------------------
function updateGutter() {
  const lines = el.code.value.split('\n').length;
  let s = '';
  for (let i = 1; i <= lines; i++) s += i + '\n';
  el.gutter.textContent = s;
  el.gutter.scrollTop = el.code.scrollTop;
}
function setEditor(value) {
  el.code.value = value;
  updateGutter();
}

// ---- rendering ------------------------------------------------------------
function clearCanvas(c) {
  const ctx = c.getContext('2d');
  c.width = c.height = 0;
  ctx.clearRect(0, 0, c.width, c.height);
}

function renderLevel(level) {
  current = level;
  const decoded = decodeDisplay(level.display);
  currentImage = displayToImage(decoded);
  el.story.textContent = level.text;
  renderDisplay(el.broken, decoded);

  // A terminal level is just a message + image: no code box, no playground.
  if (level.terminal) {
    el.codeEntry.classList.add('hidden');
    el.fixedWrap.classList.add('hidden');
    el.right.classList.add('hidden');
    document.body.classList.add('is-message');
    return;
  }

  document.body.classList.remove('is-message');
  el.codeEntry.classList.remove('hidden');
  el.fixedWrap.classList.remove('hidden');
  el.right.classList.remove('hidden');

  setEditor(getCode(level.id, activeId) ?? activeRt().defaultCode);
  el.console.textContent = '';
  el.feedback.textContent = '';
  el.feedback.className = 'feedback';
  el.secret.value = '';
  clearCanvas(el.fixed);
  loadActive();
}

// ---- language tabs --------------------------------------------------------
function buildTabs() {
  for (const id of runtimes.order) {
    const b = document.createElement('button');
    b.className = 'tab' + (id === activeId ? ' active' : '');
    b.textContent = runtimes.map[id].label;
    b.dataset.id = id;
    b.addEventListener('click', () => switchLang(id));
    el.tabs.appendChild(b);
  }
}
function setActiveTabUI() {
  for (const b of el.tabs.children) b.classList.toggle('active', b.dataset.id === activeId);
}
async function switchLang(id) {
  if (id === activeId) return;
  if (current && !current.terminal) setCode(current.id, activeId, el.code.value); // keep outgoing code
  activeId = id;
  setActiveTabUI();
  if (current && !current.terminal)
    setEditor(getCode(current.id, id) ?? activeRt().defaultCode);
  await ensureActiveReady();
}

// Lazily initialize the active runtime, showing a spinner over the playground.
async function ensureActiveReady() {
  const rt = activeRt();
  if (rt.ready) {
    el.rtLoading.classList.add('hidden');
    el.run.disabled = false;
    loadActive();
    return;
  }
  el.run.disabled = true;
  el.rtLoading.classList.remove('hidden');
  el.rtLoadingText.textContent = 'Loading ' + rt.label + '…';
  try {
    // progress only updates the overlay while this runtime is still the active tab
    await rt.ensureReady((msg) => { if (activeId === rt.id) el.rtLoadingText.textContent = msg; });
    if (activeId !== rt.id) return; // user switched away while it loaded

    el.rtLoading.classList.add('hidden');
    el.run.disabled = false;
    loadActive();
  } catch (e) {
    if (activeId === rt.id) el.rtLoadingText.textContent = rt.label + ' failed to load: ' + (e.message || e);
  }
}

// ---- actions --------------------------------------------------------------
async function run() {
  if (!current || current.terminal) return;
  const rt = activeRt();
  if (!rt.ready) { el.console.textContent = rt.label + ' is still loading…'; return; }
  rt.loadQR(currentImage, seenImages()); // restore pristine qr.current / qr.seen before running
  setCode(current.id, activeId, el.code.value);
  const { ok, output } = await rt.run(el.code.value);
  el.console.textContent = output || (ok ? '(no output)' : '');
  el.console.className = ok ? 'console' : 'console err';
}

// `code` is optional: if a string is passed it is used, otherwise the text box.
async function submit(code) {
  if (!current || !current.next) return;
  const val = (typeof code === 'string' ? code : el.secret.value).trim();
  if (!/^\d{10}$/.test(val)) { feedback('Incorrect code.', false); return; }
  el.submit.disabled = true;
  try {
    const next = await fetchAndDecrypt(current.next, val);
    history.push({ image: currentImage, id: current.id }); // solved level joins qr.seen
    const sols = loadSolutions();
    sols.push(val);
    saveSolutions(sols);
    await advanceTo(next);
  } catch {
    feedback('Incorrect code.', false);
  } finally {
    el.submit.disabled = false;
  }
}

function feedback(msg, ok) {
  el.feedback.textContent = msg;
  el.feedback.className = 'feedback ' + (ok ? 'ok' : 'bad');
  if (!ok) {
    el.secret.classList.remove('shake');
    void el.secret.offsetWidth;
    el.secret.classList.add('shake');
  }
}

// ---- progress / replay ----------------------------------------------------
async function advanceTo(level) { renderLevel(level); }

// Walk the chain from intro using saved solutions; tolerate stale/invalid data.
// Pure crypto, no runtime needed, so the game renders before any runtime loads.
async function replay(intro) {
  const sols = loadSolutions();
  let level = intro;
  const valid = [];
  const previous = [];
  for (const sol of sols) {
    if (!level.next) break;
    try {
      const next = await fetchAndDecrypt(level.next, sol);
      previous.push({ image: displayToImage(decodeDisplay(level.display)), id: level.id });
      level = next;
      valid.push(sol);
    } catch {
      break;
    }
  }
  if (valid.length !== sols.length) saveSolutions(valid);
  return { level, previous };
}

// ---- wiring ---------------------------------------------------------------
function wireEvents() {
  el.run.addEventListener('click', run);
  el.submit.addEventListener('click', submit);
  el.resetCode.addEventListener('click', () => setEditor(activeRt().defaultCode));
  el.code.addEventListener('input', updateGutter);
  el.code.addEventListener('scroll', () => { el.gutter.scrollTop = el.code.scrollTop; });
  el.secret.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); run(); }
  });
  el.code.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = el.code.selectionStart, en = el.code.selectionEnd;
      el.code.value = el.code.value.slice(0, s) + '    ' + el.code.value.slice(en);
      el.code.selectionStart = el.code.selectionEnd = s + 4;
      updateGutter();
    }
  });
}

async function main() {
  buildTabs();
  wireEvents();
  window.submit = submit;
  ensureActiveReady(); // JS is ready instantly; lazy runtimes load on tab select

  try {
    const res = await fetch(ENTRY, { cache: 'no-store' });
    if (!res.ok) throw new Error('cannot load ' + ENTRY);
    const intro = await res.json();
    const { level, previous } = await replay(intro);
    history = previous;
    renderLevel(level);
  } catch (e) {
    el.loadingText.textContent = 'Failed to start: ' + (e.message || e);
    return;
  }
  el.loading.classList.add('hidden');
}

main();
