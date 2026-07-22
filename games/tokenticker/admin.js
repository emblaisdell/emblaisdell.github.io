// Host / projector view: a big QR to the game and a live leaderboard.
//
// Reads the same solved-ledger the phones claim against, so the board is
// whatever AWS actually recorded — no separate scoring path to drift out of
// sync with the game.

import { qrSvg } from "./engine/qr.js";

const $ = (s) => document.querySelector(s);

let started = false;
let lastTotals = new Map(); // name -> money, for the flash-on-change effect
let seenNames = new Set();  // so only genuinely new entrants animate in

/* ---- the gate ----------------------------------------------------------- */
// SHA-256 of the passphrase. Storing the hash rather than the literal keeps the
// word out of "view source", but this is a static page: the check runs on the
// client and is bypassable by anyone who opens devtools. It is a doorbell.
// Change it with:  echo -n 'your phrase' | shasum -a 256
const PASS_SHA256 = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"; // "test"
const SESSION_KEY = "tt.host.ok";

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function tryUnlock(value) {
  // crypto.subtle needs a secure context; localhost counts, plain-http LAN does not.
  if (!crypto?.subtle) return value === "";
  return (await sha256Hex(value)) === PASS_SHA256;
}

function unlock() {
  sessionStorage.setItem(SESSION_KEY, "1");
  $("#gate").classList.add("hidden");
  $("#stage").classList.remove("hidden");
  start();
}

$("#gateForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (await tryUnlock($("#gatePass").value)) return unlock();
  $("#gateErr").classList.remove("hidden");
  $("#gatePass").select();
});


/* ---- the QR ------------------------------------------------------------- */

/** Where the game lives, derived from where this page is served. Deriving it
 *  rather than hardcoding means the projected URL can never go stale — it is
 *  by construction the deployment you are actually running. */
function gameUrl() {
  const override = new URLSearchParams(location.search).get("url");
  if (override) return override;
  return new URL(".", location.href).href; // /games/tokenticker/admin.html -> /games/tokenticker/
}

function renderQr() {
  const url = gameUrl();
  // Level Q: a projector QR gets scanned at an angle, from a distance, by
  // twenty phones at once. The extra error correction is worth the density.
  $("#qrBox").innerHTML = qrSvg(url, { ecc: "Q", quiet: 2, dark: "#0d0a1e", light: "#ffffff" });
  $("#joinUrl").textContent = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/* ---- the leaderboard ---------------------------------------------------- */

const LEDGER = ($('meta[name="mutex-url"]')?.content ?? "").replace(/\/$/, "");
const LEDGER_KEY = $('meta[name="mutex-key"]')?.content ?? "";
const POLL_MS = 5000;

async function fetchClaims() {
  const res = await fetch(`${LEDGER}/solved?full=1`, {
    headers: LEDGER_KEY ? { "x-hf-key": LEDGER_KEY } : {},
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return body.claims ?? [];
}

/** Fold the raw claim log into standings. */
function tally(claims) {
  const byPlayer = new Map();
  for (const c of claims) {
    const name = String(c.by ?? "anon");
    const entry = byPlayer.get(name) ?? { name, solves: 0, money: 0, last: 0 };
    entry.solves += 1;
    entry.money += Number(c.prize) || 0;
    entry.last = Math.max(entry.last, Number(c.solvedAt) || 0);
    byPlayer.set(name, entry);
  }
  return [...byPlayer.values()].sort(
    (a, b) => b.money - a.money || b.solves - a.solves || a.last - b.last,
  );
}

const MEDALS = ["🥇", "🥈", "🥉"];
// Comfortably more than fits a projector at this row height; the container
// clips the rest rather than showing a half-cut row.
const MAX_ROWS = 10;

function renderBoard(standings, totalClaims) {
  $("#playerCount").textContent = totalClaims;
  const board = $("#board");
  const empty = $("#boardEmpty");

  if (!standings.length) {
    board.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  // The board is rebuilt on every poll, so animations must be opt-in per row:
  // a blanket fade-in would re-run every 5s and flicker for the whole room.
  board.innerHTML = standings
    .slice(0, MAX_ROWS)
    .map((s, i) => {
      const bumped = lastTotals.has(s.name) && lastTotals.get(s.name) !== s.money;
      const isNew = !seenNames.has(s.name);
      return `<li class="row ${i < 3 ? `top${i + 1}` : ""} ${bumped ? "bump" : ""} ${isNew ? "enter" : ""}">
        <span class="place">${MEDALS[i] ?? i + 1}</span>
        <span class="name">${esc(s.name)}</span>
        <span class="solves">${s.solves} solved</span>
        <span class="money">$${s.money}</span>
      </li>`;
    })
    .join("");

  lastTotals = new Map(standings.map((s) => [s.name, s.money]));
  seenNames = new Set(standings.map((s) => s.name));
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function poll() {
  try {
    const claims = await fetchClaims();
    $("#boardOffline").classList.add("hidden");
    renderBoard(tally(claims), claims.length);
    $("#status").textContent = `${claims.length} solves · live`;
  } catch (err) {
    // Surfaced to the console too — a host debugging at demo time needs the reason,
    // not just the badge.
    console.error("[leaderboard]", err?.message ?? err);
    // Show the failure rather than a frozen board that looks live.
    $("#boardOffline").classList.remove("hidden");
    $("#status").textContent = "ledger offline";
  }
}

/* ---- boot --------------------------------------------------------------- */

function start() {
  if (started) return;
  started = true;
  renderQr();
  addEventListener("resize", renderQr);
  poll();
  setInterval(poll, POLL_MS);
}

$("#fullscreen").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
});

// Resume an already-unlocked tab. This MUST be the last statement in the module:
// unlock() calls start(), which reaches LEDGER, POLL_MS and friends. Run any
// earlier and those `const`s are still in their temporal dead zone, so the host
// view comes up blank on every reload — with the QR drawn but the board dead,
// which looks like a network problem rather than a load-order bug.
if (sessionStorage.getItem(SESSION_KEY) === "1") unlock();
