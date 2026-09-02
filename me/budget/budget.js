// Daily budget readout: fetches the balance and renders it.
// Design notes and rationale live in the project README, not in this file.

'use strict';

const ENDPOINT = 'https://uegea67p3hy7ftwy5xkoynkd340muspa.lambda-url.us-east-1.on.aws/';
const TOKEN_KEY = 'budget.readToken';

// Guarded: localStorage throws rather than returning null in some modes.
function loadToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
}
function saveToken(token) {
  try { localStorage.setItem(TOKEN_KEY, token); } catch (e) { /* session-only */ }
}
function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* nothing to clear */ }
}

async function fetchBalance(token) {
  const res = await fetch(ENDPOINT, {
    method: 'GET',
    mode: 'cors',
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    headers: { 'Authorization': 'Bearer ' + token },
  });
  if (res.status === 401) {
    const err = new Error('unauthorized');
    err.unauthorized = true;
    throw err;
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// ── Rendering ───────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const money = (n) =>
  '$' + Math.abs(Number(n)).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function show(view) {
  for (const id of ['gate', 'readout', 'error']) $(id).hidden = (id !== view);
}

function render(data) {
  const over = data.balance < 0;
  // The label carries the sign, so the figure itself is always positive:
  // "Overspent By: $41.20" rather than a minus sign the eye can skip.
  $('label').textContent = over ? 'Overspent By:' : 'Available to Spend:';
  $('label').className = over ? 'label negative' : 'label';
  $('balance').textContent = money(Math.abs(data.balance));
  $('balance').className = over ? 'balance negative' : 'balance';

  const month = data.month || {};
  const rows = [
    ['daily rate', money(data.daily_rate)],
    ['spent today', money(data.spent_today)],
    ['month to date', money(month.net)],
    ['transactions', String(month.transactions ?? 0)],
  ];

  const dl = $('facts');
  dl.textContent = '';
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value;
    dl.append(dt, dd);
  }

  $('checked').textContent = 'Last checked ' +
    new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  show('readout');
}

// ── Flow ────────────────────────────────────────────────────────────────────
async function refresh() {
  const token = loadToken();
  if (!token) { show('gate'); return; }

  $('refresh').disabled = true;
  $('refresh').classList.add('busy');
  try {
    render(await fetchBalance(token));
  } catch (e) {
    if (e.unauthorized) {
      clearToken();
      $('gate-message').textContent = 'Not accepted. Try again.';
      show('gate');
    } else {
      $('error-message').textContent = 'Couldn\u2019t load. Try again.';
      show('error');
    }
  } finally {
    $('refresh').disabled = false;
    $('refresh').classList.remove('busy');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('gate-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const field = $('token');
    const token = field.value.trim();
    field.value = '';
    if (!token) return;
    saveToken(token);
    $('gate-message').textContent = '';
    refresh();
  });

  $('refresh').addEventListener('click', refresh);

  $('details-toggle').addEventListener('click', () => {
    const panel = $('details');
    panel.hidden = !panel.hidden;
    $('details-toggle').setAttribute('aria-expanded', String(!panel.hidden));
  });
  $('retry').addEventListener('click', refresh);

  $('forget').addEventListener('click', () => {
    clearToken();
    $('details').hidden = true;
    $('details-toggle').setAttribute('aria-expanded', 'false');
    $('gate-message').textContent = 'Cleared.';
    show('gate');
  });

  refresh();
});
