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

async function call(token, body) {
  const init = {
    method: body ? 'POST' : 'GET',
    mode: 'cors',
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    headers: { 'Authorization': 'Bearer ' + token },
  };
  if (body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(ENDPOINT, init);
  if (res.status === 401) {
    const err = new Error('unauthorized');
    err.unauthorized = true;
    throw err;
  }
  if (!res.ok) {
    const err = new Error('HTTP ' + res.status);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const fetchBalance = (token) => call(token);
// The sk is the handle the server gave us for the charge we displayed, so the
// ignore lands on that one even if another charge arrived since.
const ignorePurchase = (token, sk) => call(token, { op: 'ignore', sk });

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
  // Donations and the like: real charges the ledger was told not to count.
  // Only worth a row when there are any.
  if (month.excluded > 0) rows.push(['excluded', money(month.excluded)]);

  const dl = $('facts');
  dl.textContent = '';
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value;
    dl.append(dt, dd);
  }

  const last = data.last_purchase;
  $('last').hidden = !last;
  if (last) {
    const when = new Date(last.at);
    $('last-desc').textContent = 'Last purchase: ' + money(last.amount) + ' on ' +
      when.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    $('ignore').dataset.sk = last.sk;
  }
  armIgnore(false);

  $('checked').textContent = 'Last checked ' +
    new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  show('readout');
}

// Two taps to ignore: the first reveals the confirmation, the second commits.
function armIgnore(armed) {
  $('ignore-ask').hidden = armed;
  $('ignore-confirm').hidden = !armed;
}

async function ignoreLast() {
  const token = loadToken();
  const sk = $('ignore').dataset.sk;
  if (!token || !sk) { show('gate'); return; }
  for (const id of ['ignore-yes', 'ignore-no']) $(id).disabled = true;
  try {
    render(await ignorePurchase(token, sk));
    $('ignore-message').textContent = 'Ignored.';
  } catch (e) {
    if (e.unauthorized) {
      clearToken();
      $('gate-message').textContent = 'Not accepted. Try again.';
      show('gate');
    } else if (e.status === 404 || e.status === 409) {
      // Already handled, or the ledger moved under us: show what's true now.
      $('ignore-message').textContent = 'Already handled.';
      await refresh();
    } else {
      $('ignore-message').textContent = 'Couldn\u2019t ignore it. Try again.';
      armIgnore(false);
    }
  } finally {
    for (const id of ['ignore-yes', 'ignore-no']) $(id).disabled = false;
  }
}

// ── Flow ────────────────────────────────────────────────────────────────────
async function refresh() {
  const token = loadToken();
  if (!token) { show('gate'); return; }

  $('refresh').disabled = true;
  $('refresh').classList.add('busy');
  try {
    render(await fetchBalance(token));
    $('ignore-message').textContent = '';
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

  $('ignore').addEventListener('click', () => {
    $('ignore-message').textContent = '';
    armIgnore(true);
  });
  $('ignore-no').addEventListener('click', () => armIgnore(false));
  $('ignore-yes').addEventListener('click', ignoreLast);

  $('forget').addEventListener('click', () => {
    clearToken();
    $('details').hidden = true;
    $('details-toggle').setAttribute('aria-expanded', 'false');
    $('gate-message').textContent = 'Cleared.';
    show('gate');
  });

  refresh();
});
