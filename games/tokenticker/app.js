/* Token Ticker client — ES modules, no build step.
   Everything below the transport layer is unchanged from the WebSocket build:
   the on-device engine emits the same message shapes the renderers already
   understood, so porting the game to the phone did not touch the UI. */

import { Match } from "./engine/match.js";
import { MODELS, MODEL_NAMES } from "./engine/models.js";
import { MOCK } from "./engine/llm.js";
import { createMutex } from "./engine/mutex.js";
import { chat as agentChat } from "./engine/agent.js";

const $ = (sel) => document.querySelector(sel);

// Emoji stay in text-only surfaces (token console); sprites cover everything visual.
const NODE_EMOJI = {
  planner: "🧠", coder: "⌨️", critic: "🔍", oracle: "🔮",
  "test-runner": "🧪", submitter: "🚀", memory: "💾",
};
const NODE_SPRITE = Object.fromEntries(
  Object.keys(NODE_EMOJI).map((t) => [t, spritePath(`node-${t}`)]),
);
function spritePath(name, ext = "png") {
  return `sprites/${name}.${ext}`;
}
// spriteFallback lives in an inline head script (index.html): inline onerror=
// handlers need a global that exists before this module has run.
function spriteImg(name, cls, alt = name) {
  return `<img class="${cls}" src="${spritePath(name)}" alt="${esc(alt)}" onerror="spriteFallback(this)">`;
}
const icon = (name, cls = "icon xs") => spriteImg(name, cls, name);
const NODE_W = 96, NODE_H = 64, GAP_X = 60, GAP_Y = 26;

const state = {
  ws: null,
  me: null,
  spec: null,
  challenges: [],
  shop: [],
  phase: "lobby",
  endsAt: null,
  players: [],
  cooldownUntil: {}, // challengeId -> ts
  runActive: false,
  rivals: new Map(), // playerId -> {activity, meter, el}
  agentBubble: null,
  // mobile session + reconnect plumbing
  name: null,
  tab: "solve",
};

/* ================= transport ================= */
/* There is no game server any more. `match` runs the whole sprint on this
   device; AWS is consulted only for the first-solve mutex. The dispatcher
   below keeps the old `send({type})` call sites working unchanged. */

let match = null;

// A 10-minute sprint should not be interrupted by the screen sleeping.
let wakeLock = null;
async function requestWakeLock() {
  if (!("wakeLock" in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch { /* denied or unsupported (e.g. insecure context) — not worth surfacing */ }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") requestWakeLock();
});

const buzz = (pattern) => navigator.vibrate?.(pattern);

async function connect(name) {
  state.name = name;
  const file = MOCK ? "challenges.dev.json" : "challenges.json";
  const pool = await fetch(file).then((r) => r.json()).then((d) => d.challenges);
  match = new Match({ pool, emit: handle, mutex: createMutex() });
  match.join(name);
}

const chatHistory = [];
let chatBusy = false;

function handleChat(text) {
  if (chatBusy) return handle({ type: "error", message: "agent is still replying" });
  chatBusy = true;
  agentChat(match, chatHistory, text, handle).finally(() => { chatBusy = false; });
}

function send(msg) {
  if (!match) return;
  let res = { ok: true };
  switch (msg.type) {
    case "start": res = match.start(); break;
    case "solve": res = match.solve(msg.challengeId); break;
    case "buy": res = match.buy(msg.itemId); break;
    case "chat": handleChat(msg.text); break;
  }
  if (!res.ok) handle({ type: "error", message: res.error });
}

function handle(msg) {
  switch (msg.type) {
    case "joined":
      state.me = msg.you;
    applyState(msg);
      $("#joinOverlay").classList.add("hidden");
      $("#app").classList.remove("hidden");
      requestWakeLock();
      break;
    case "snapshot":
      applyState(msg);
      break;
    case "room":
      state.phase = msg.phase;
      state.endsAt = msg.endsAt;
      state.players = msg.players;
      renderPhase();
      renderRivals();
      break;
    case "player_update":
      Object.assign(state.me, {
        money: msg.money, compute: msg.compute, solved: msg.solved,
      });
      state.shop = msg.shop;
      renderStats(); renderShop(); renderChallenges();
      break;
    case "graph_updated":
      state.spec = msg.spec;
      renderGraph();
      break;
    case "challenge_solved": {
      const c = state.challenges.find((c) => c.id === msg.challengeId);
      if (c) c.solvedBy = msg.playerId;
      renderChallenges();
      if (msg.playerId !== state.me.id) {
        const who = state.players.find((p) => p.id === msg.playerId);
        toast(`⚡ ${who?.name ?? "someone"} took "${c?.title}" for $${msg.prize}!`, true);
        buzz(20);
      }
      break;
    }
    case "results":
      showResults(msg.standings);
      break;
    case "chat_delta":
      closeThinking();
      agentDelta(msg.text);
      break;
    case "chat_thinking": chatThinking(msg.text); break;
    case "chat_done":
      closeThinking();
      agentDone();
      break;
    case "agent_tool": toolChip(msg); break;
    case "agent_status":
      $("#agentFace").src = msg.status === "overheat" ? spritePath("agent-overheat") : spritePath("agent");
      $("#statAgent").classList.toggle("overheat", msg.status === "overheat");
      if (msg.status === "overheat") toast("Agent overheated — token budget exhausted this match", true);
      break;
    case "run_started":
      state.runActive = true;
      $("#runBadge").classList.remove("hidden");
      endTokens();
      feedLine(`▶ run started: ${msg.challengeId}`, "feedRun");
      clearGraphStates();
      // The harness is the show — put the player in front of it automatically.
      showTab("harness");
      break;
    case "node_started":
      closeThinking();
      setNodeState(msg.nodeId, "active");
      endTokens();
      feedLine(nodeTag(msg.nodeId), "feedNode");
      break;
    case "ask": {
      // Emitted right before an LLM node calls out — a dim one-line preview.
      const text = String(msg.text ?? "").replace(/\s+/g, " ").trim();
      feedLine(`→ [${msg.nodeId}] ask: ${text.length > 120 ? text.slice(0, 120) + "…" : text}`, "feedAsk");
      break;
    }
    case "tokens": tokensAppend(msg.text); break;
    case "node_finished":
      setNodeState(msg.nodeId, msg.outcome === "fail" || msg.outcome === "reject" ? "bad" : "ok");
      break;
    case "edge_taken": pulseEdge(msg.from, msg.to); break;
    case "submit_result": onSubmitResult(msg); break;
    case "run_finished":
      state.runActive = false;
      $("#runBadge").classList.add("hidden");
      endTokens();
      feedLine(`■ run finished: ${msg.result}${msg.error ? ` (${msg.error})` : ""}`, "feedRun");
      renderChallenges();
      // No auto-switch on failure: the feed strip shows the result on every
      // tab, and yanking the player off a tab they chose is worse than useless.
      break;
    case "spectate": onSpectate(msg); break;
    case "error": toast(msg.message, true); break;
  }
}

function applyState(msg) {
  state.me = msg.you;
  state.spec = msg.spec;
  state.challenges = msg.challenges;
  state.shop = msg.shop;
  state.phase = msg.phase;
  state.endsAt = msg.endsAt;
  state.cooldownUntil = {};
  for (const [id, ms] of Object.entries(msg.you.cooldowns ?? {})) {
    state.cooldownUntil[id] = Date.now() + ms;
  }
  renderAll();
}

/* ================= rendering ================= */

function renderAll() {
  renderStats(); renderChallenges(); renderShop(); renderGraph(); renderPhase(); renderRivals();
}

function renderStats() {
  $("#statMoney b").textContent = state.me.money;
  $("#statCompute b").textContent = state.me.compute;
}

function renderPhase() {
  $("#phasePill").textContent = state.phase;
  const lobby = $("#lobbyOverlay");
  if (state.phase === "lobby" && state.me) {
    lobby.classList.remove("hidden");
    $("#lobbyTitle").textContent = "Lobby";
    $("#startBtn").disabled = false;
    renderLobbyPlayers();
  } else if (state.phase === "countdown") {
    lobby.classList.remove("hidden");
    $("#startBtn").disabled = true;
    renderLobbyPlayers();
  } else {
    lobby.classList.add("hidden");
  }
  if (state.phase !== "results") $("#resultsOverlay").classList.add("hidden");
}

function renderLobbyPlayers() {
  $("#lobbyPlayers").innerHTML = state.players
    .map((p) => `<span class="lobbyChip">${esc(p.name)}${p.id === state.me?.id ? " (you)" : ""}</span>`)
    .join("");
}

function renderChallenges() {
  const list = $("#challengeList");
  list.innerHTML = "";
  for (const c of state.challenges) {
    const el = document.createElement("div");
    el.className = "challenge" + (c.solvedBy ? " solved" : "");
    const mine = c.solvedBy === state.me.id;
    const cool = Math.max(0, (state.cooldownUntil[c.id] ?? 0) - Date.now());
    el.innerHTML = `
      <div class="row">
        <span class="diff diff-${esc(c.difficulty ?? "medium")}">${esc(c.difficulty ?? "")}</span>
        <span class="title">${esc(c.title)}</span>
        <span class="prize">$${c.prize}</span>
      </div>
      <div class="desc">${esc(c.prompt)}</div>
      ${c.solvedBy
        ? `<div class="solvedTag">${mine ? "✅ you solved it!" : "⚡ claimed by a rival"}</div>`
        : cool > 0
          ? `<div class="cool">⏳ cooldown ${Math.ceil(cool / 1000)}s</div>`
          : `<button data-id="${c.id}" ${state.phase !== "running" || state.runActive ? "disabled" : ""}>Solve ▶</button>`}
    `;
    el.querySelector("button")?.addEventListener("click", (e) => {
      send({ type: "solve", challengeId: e.target.dataset.id });
    });
    list.appendChild(el);
  }
}

function renderShop() {
  $("#computeSummary").innerHTML =
    `${icon("gpu", "icon")} <b>${Number(state.me?.compute) || 0}</b> tok/s` +
    ` <span class="sep">·</span> ${icon("coin", "icon")} <b>$${Number(state.me?.money) || 0}</b> to spend`;
  const list = $("#shopList");
  list.innerHTML = "";
  for (const item of state.shop) {
    const el = document.createElement("div");
    el.className = "shopItem";
    const afford = state.me.money >= item.price;
    el.innerHTML = `
      ${spriteImg(item.id, "icon shopIcon", item.title)}
      <span class="name">${esc(item.title)}
        <span class="owned">${item.owned ? `owned ×${item.owned}` : "none owned yet"}</span>
      </span>
      <button ${!afford ? "disabled" : ""}>$${item.price}</button>`;
    el.querySelector("button").addEventListener("click", () => send({ type: "buy", itemId: item.id }));
    list.appendChild(el);
  }
}

/* ---- graph ---- */

let graphLayout = null; // { pos: Map<id,{x,y}>, edgePaths: Map<'a->b', pathEl> }

function layoutSpec(spec) {
  const depth = new Map([[spec.entry, 0]]);
  const queue = [spec.entry];
  while (queue.length) {
    const id = queue.shift();
    for (const e of spec.edges) {
      if (e.from === id && !depth.has(e.to)) {
        depth.set(e.to, depth.get(id) + 1);
        queue.push(e.to);
      }
    }
  }
  const cols = new Map();
  for (const n of spec.nodes) {
    const d = depth.get(n.id) ?? 0;
    if (!cols.has(d)) cols.set(d, []);
    cols.get(d).push(n);
  }
  const maxRows = Math.max(...[...cols.values()].map((c) => c.length));
  const height = maxRows * (NODE_H + GAP_Y);
  const pos = new Map();
  for (const [d, nodes] of cols) {
    const colH = nodes.length * NODE_H + (nodes.length - 1) * GAP_Y;
    nodes.forEach((n, i) => {
      pos.set(n.id, { x: 20 + d * (NODE_W + GAP_X), y: (height - colH) / 2 + i * (NODE_H + GAP_Y) + 10 });
    });
  }
  const width = 40 + (Math.max(...[...cols.keys()]) + 1) * (NODE_W + GAP_X) - GAP_X;
  return { pos, width, height: height + 20 };
}

function renderGraph() {
  const svg = $("#graph");
  svg.innerHTML = "";
  if (!state.spec) return;
  const { pos, width, height } = layoutSpec(state.spec);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const ns = "http://www.w3.org/2000/svg";
  const edgePaths = new Map();

  for (const e of state.spec.edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) continue;
    const path = document.createElementNS(ns, "path");
    const back = b.x <= a.x;
    let d;
    if (back) {
      // loop-back: swing underneath
      const y = Math.max(a.y, b.y) + NODE_H + 18;
      d = `M ${a.x + NODE_W / 2} ${a.y + NODE_H} C ${a.x + NODE_W / 2} ${y}, ${b.x + NODE_W / 2} ${y}, ${b.x + NODE_W / 2} ${b.y + NODE_H}`;
    } else {
      const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
      const mx = (x1 + x2) / 2;
      d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
    }
    path.setAttribute("d", d);
    path.setAttribute("class", "gEdge");
    svg.appendChild(path);
    edgePaths.set(`${e.from}->${e.to}`, path);
    if (e.when !== "always" || e.maxLoops) {
      const label = document.createElementNS(ns, "text");
      label.setAttribute("class", "gEdgeLabel");
      const mid = path.getPointAtLength(path.getTotalLength() / 2);
      label.setAttribute("x", mid.x);
      label.setAttribute("y", mid.y - 4);
      label.setAttribute("text-anchor", "middle");
      label.textContent = `${e.when !== "always" ? e.when : ""}${e.maxLoops ? ` ↺${e.maxLoops}` : ""}`;
      svg.appendChild(label);
    }
  }

  for (const n of state.spec.nodes) {
    const p = pos.get(n.id);
    const g = document.createElementNS(ns, "g");
    g.setAttribute("class", "gNode");
    g.dataset.id = n.id;
    g.setAttribute("transform", `translate(${p.x}, ${p.y})`);
    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("width", NODE_W); rect.setAttribute("height", NODE_H);
    rect.setAttribute("rx", 14);
    g.appendChild(rect);
    if (NODE_SPRITE[n.type]) {
      const img = document.createElementNS(ns, "image");
      img.setAttribute("href", NODE_SPRITE[n.type]);
      img.addEventListener("error", () => img.setAttribute("href", NODE_SPRITE[n.type].replace(/\.png$/, ".svg")), { once: true });
      img.setAttribute("x", NODE_W / 2 - 23);
      img.setAttribute("y", -3);
      img.setAttribute("width", 46);
      img.setAttribute("height", 46);
      img.setAttribute("class", "gSprite");
      g.appendChild(img);
    } else {
      g.appendChild(svgText(ns, NODE_W / 2, 26, "❓", "emoji"));
    }
    g.appendChild(svgText(ns, NODE_W / 2, 44, n.id, "label"));
    if (n.model) {
      // Model names are real slugs now — a text chip, no sprite to 404 on.
      g.appendChild(svgText(ns, NODE_W / 2, 57, MODELS[n.model]?.short ?? n.model, "chip"));
    }
    svg.appendChild(g);
  }
  graphLayout = { edgePaths };
  fitGraph();
}

function svgText(ns, x, y, str, cls) {
  const t = document.createElementNS(ns, "text");
  t.setAttribute("x", x); t.setAttribute("y", y);
  t.setAttribute("text-anchor", "middle");
  t.setAttribute("class", cls);
  t.textContent = str;
  return t;
}

function setNodeState(id, cls) {
  const g = $(`#graph .gNode[data-id="${CSS.escape(id)}"]`);
  if (!g) return;
  g.classList.remove("active", "ok", "bad");
  g.classList.add(cls);
}
function clearGraphStates() {
  document.querySelectorAll("#graph .gNode").forEach((g) => g.classList.remove("active", "ok", "bad"));
}
function pulseEdge(from, to) {
  const path = graphLayout?.edgePaths.get(`${from}->${to}`);
  if (!path) return;
  path.classList.add("active");
  setTimeout(() => path.classList.remove("active"), 700);
}

/* ---- feed ---- */
/* One persistent strip on every tab: chat bubbles, agent thinking, tool chips,
   the harness token stream and run lifecycle lines interleave in #feedLog. */

const feedLog = () => $("#feedLog");
function feedScroll() {
  const el = feedLog();
  el.scrollTop = el.scrollHeight;
}
function feedEl(cls, tag = "div") {
  const el = document.createElement(tag);
  el.className = cls;
  const log = feedLog();
  log.appendChild(el);
  while (log.childElementCount > 250) log.firstElementChild.remove();
  return el;
}
function feedLine(text, cls) {
  feedEl(cls).textContent = text;
  feedScroll();
}

// Harness token output streams into a monospace block; a fresh one starts per
// node (and after anything else interrupted the stream).
let tokenPre = null;
function tokensAppend(text) {
  if (!tokenPre) tokenPre = feedEl("feedTokens", "pre");
  tokenPre.textContent = (tokenPre.textContent + text).slice(-4000);
  feedScroll();
}
function endTokens() { tokenPre = null; }

function nodeTag(id) {
  const n = state.spec?.nodes.find((n) => n.id === id);
  return `[${NODE_EMOJI[n?.type] ?? "❓"} ${id}]`;
}

// Agent thinking (summarized) renders as a dim entry in the same feed.
let thinkEl = null;
function chatThinking(text) {
  if (!thinkEl) {
    thinkEl = feedEl("feedThink");
    thinkEl.textContent = "💭 ";
  }
  thinkEl.textContent = (thinkEl.textContent + text).slice(-1200);
  feedScroll();
}
function closeThinking() { thinkEl = null; }

/* ---- submit + fx ---- */

function onSubmitResult(msg) {
  endTokens();
  if (msg.passed && msg.firstBlood) {
    confetti();
    floatCash(`+$${msg.prize}`);
    feedLine(`🏆 SOLVED! +$${msg.prize}`, "feedRun");
    buzz([0, 60, 50, 60, 50, 140]);
    toast(`🏆 Solved — +$${msg.prize}!`);
  } else if (msg.passed) {
    feedLine(`✅ correct — but a rival got there first. No prize.`, "feedRun");
  } else if (msg.cooldownRemaining) {
    feedLine(`⛔ submit rejected — cooldown ${Math.ceil(msg.cooldownRemaining / 1000)}s`, "feedRun");
  } else {
    state.cooldownUntil[msg.challengeId] = Date.now() + (msg.cooldown ?? 0);
    feedLine(`❌ hidden suite: ${msg.failedCount} failing — cooldown ${Math.ceil((msg.cooldown ?? 0) / 1000)}s`, "feedRun");
    buzz(35);
  }
  renderChallenges();
}

function confetti() {
  const fx = $("#fx");
  const emo = ["🎉", "✨", "💛", "🪙", "🎊", "⭐"];
  for (let i = 0; i < 36; i++) {
    const s = document.createElement("span");
    s.className = "confetto";
    s.textContent = emo[i % emo.length];
    s.style.left = Math.random() * 100 + "vw";
    s.style.animationDuration = 1.4 + Math.random() * 1.6 + "s";
    s.style.animationDelay = Math.random() * 0.4 + "s";
    fx.appendChild(s);
    setTimeout(() => s.remove(), 3600);
  }
}
function floatCash(text) {
  const s = document.createElement("div");
  s.className = "floatCash";
  s.textContent = text;
  s.style.left = "48%"; s.style.top = "40%";
  $("#fx").appendChild(s);
  setTimeout(() => s.remove(), 1700);
}
let toastTimer = null;
function toast(text, err = false) {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div");
  t.className = "toast" + (err ? " err" : "");
  t.textContent = text;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3500);
}

/* ---- rivals ---- */

function renderRivals() {
  const list = $("#rivalList");
  const rivals = state.players.filter((p) => p.id !== state.me?.id);
  for (const p of rivals) {
    let r = state.rivals.get(p.id);
    if (!r) {
      const el = document.createElement("div");
      el.className = "rival";
      el.innerHTML = `<div class="name"></div><div class="sub"></div><div class="activity"></div><div class="meterBar"><i></i></div>`;
      list.appendChild(el);
      r = { el, meter: 0, activity: "" };
      state.rivals.set(p.id, r);
    }
    r.el.querySelector(".name").textContent = p.name;
    r.el.querySelector(".sub").innerHTML =
      `${icon("coin")}${Number(p.money) || 0} · ${icon("gpu")}${Number(p.compute) || 0} · ${icon("trophy")}${Number(p.solved) || 0}`;
  }
  for (const [id, r] of state.rivals) {
    if (!rivals.some((p) => p.id === id)) { r.el.remove(); state.rivals.delete(id); }
  }
  // The panel is a tab destination on mobile — show an empty state, never a blank screen.
  let empty = list.querySelector(".emptyRivals");
  if (!rivals.length && !empty) {
    empty = document.createElement("p");
    empty.className = "emptyRivals tag";
    empty.textContent = "No rivals yet — share the link to fill the lobby.";
    list.appendChild(empty);
  } else if (rivals.length && empty) {
    empty.remove();
  }
}

function onSpectate(msg) {
  const r = state.rivals.get(msg.playerId);
  if (!r) return;
  const e = msg.event;
  const set = (text) => (r.el.querySelector(".activity").textContent = text);
  if (e.type === "meter") {
    const total = Object.values(e.nodes).reduce((a, b) => a + b, 0);
    r.meter = Math.min(100, total * 3);
  } else if (e.type === "node_started") set(`${nodeEmojiFor(msg.playerId, e.nodeId)} ${e.nodeId}…`);
  else if (e.type === "run_started") set("▶ starting a run");
  else if (e.type === "run_finished") { set(e.result === "solved" ? "🏆 solved!" : "■ idle"); r.meter = 0; }
  else if (e.type === "submit_result" && !e.passed) set("❌ submit failed");
  else if (e.type === "graph_updated") set("🔧 rebuilding harness");
  r.el.querySelector(".meterBar i").style.width = r.meter + "%";
}
function nodeEmojiFor() { return "⚡"; }

// decay rival meters
setInterval(() => {
  for (const r of state.rivals.values()) {
    r.meter = Math.max(0, r.meter - 8);
    r.el.querySelector(".meterBar i").style.width = r.meter + "%";
  }
}, 500);

/* ---- chat ---- */

function agentDelta(text) {
  if (!state.agentBubble) {
    endTokens(); // the next token burst starts below this bubble
    state.agentBubble = feedEl("bubble agent");
  }
  state.agentBubble.textContent += text;
  feedScroll();
}
function agentDone() {
  state.agentBubble = null;
  $("#chatInput").disabled = false;
  $("#chatSend").disabled = false;
  // Don't re-focus on phones: it re-summons the keyboard over the board.
  if (!phone.matches) $("#chatInput").focus();
}
function toolChip(msg) {
  state.agentBubble = null; // next delta starts a fresh bubble after the chip
  endTokens();
  const chip = feedEl("toolChip" + (msg.ok ? "" : " err"));
  chip.textContent = `🔧 ${msg.name} ${msg.ok ? "✓" : "✗ " + (msg.error ?? "")}`;
  feedScroll();
}

/* ---- timer + cooldown ticks ---- */

setInterval(() => {
  const t = $("#timer");
  if (!state.endsAt) { t.textContent = "--:--"; t.classList.remove("low"); return; }
  const ms = Math.max(0, state.endsAt - Date.now());
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
  t.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  t.classList.toggle("low", state.phase === "running" && ms < 60000);
  if (state.phase === "countdown") $("#lobbyTitle").textContent = `Starting in ${s}…`;
}, 250);

// re-render challenge cooldown badges while any are ticking
setInterval(() => {
  if (Object.values(state.cooldownUntil).some((t) => t > Date.now() - 1500)) renderChallenges();
}, 1000);

/* ---- results ---- */

function showResults(standings) {
  const medals = ["🥇", "🥈", "🥉"];
  $("#standings").innerHTML = standings
    .map(
      (s, i) => `
      <div class="standing">
        <span class="place">${medals[i] ?? i + 1}</span>
        <span class="name">${esc(s.name)}</span>
        <span class="detail">${icon("trophy")} ${s.solved.length} solved · ${icon("coin")} $${s.money} · ${icon("gpu")} ${s.compute} · ${s.tokensSpent} tok · ${s.finalGraph.nodes.length}-node harness</span>
      </div>`,
    )
    .join("");
  $("#resultsOverlay").classList.remove("hidden");
}

/* ================= mobile shell ================= */
/* Phones show one panel group at a time behind a thumb-reachable tab bar.
   Above 900px every panel is on screen at once and this whole layer is inert. */

const phone = window.matchMedia("(max-width: 899px)");
const TAB_PANELS = () => document.querySelectorAll("#layout .panel[data-tab]");

function showTab(tab) {
  state.tab = tab;
  if (!phone.matches) return;
  for (const el of TAB_PANELS()) el.hidden = el.dataset.tab !== tab;
  for (const btn of document.querySelectorAll("#tabbar .tab")) {
    const on = btn.dataset.tab === tab;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", String(on));
  }
  if (tab === "harness") fitGraph();
}
// No unread dots any more: the feed strip is on every tab, so nothing streams
// out of sight.

function applyLayoutMode() {
  if (phone.matches) return showTab(state.tab);
  for (const el of TAB_PANELS()) el.hidden = false; // desktop: everything visible
}
phone.addEventListener("change", applyLayoutMode);

document.querySelectorAll("#tabbar .tab").forEach((btn) => {
  btn.addEventListener("click", () => { buzz(8); showTab(btn.dataset.tab); });
});

/* ---- graph fit / zoom ---- */
// Default is fit-to-width so nothing is cut off; tapping ⤢ switches to a
// readable 1:1 scale you pan horizontally.
let graphZoomed = false;
function fitGraph() {
  const svg = $("#graph");
  const vb = svg.getAttribute("viewBox");
  if (!vb) return;
  const [, , w, h] = vb.split(" ").map(Number);
  const box = $("#graphScroll").getBoundingClientRect();
  if (graphZoomed) {
    svg.classList.add("zoomed");
    svg.style.width = `${Math.max(w * (box.height / Math.max(h, 1)), box.width)}px`;
  } else {
    svg.classList.remove("zoomed");
    svg.style.width = "";
  }
}
$("#graphFit").addEventListener("click", () => {
  graphZoomed = !graphZoomed;
  $("#graphFit").textContent = graphZoomed ? "⤡" : "⤢";
  fitGraph();
});

/* ---- quick prompts ---- */
// Typing full sentences on a phone mid-sprint is the biggest friction point in
// the whole game; these cover the edits players actually ask for.
const QUICK_PROMPTS = [
  "Add a critic before the submitter",
  "Use the fastest model on every node — speed matters",
  "Add a test-runner and loop back to the coder on fail",
  "Put the planner on the strongest model",
  "Simplify: drop everything but coder → submitter",
  "What models can I use?",
  "What should I buy next?",
];
(function mountSuggestions() {
  const bar = document.createElement("div");
  bar.id = "chatSuggest";
  for (const text of QUICK_PROMPTS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "suggest";
    b.textContent = text;
    b.addEventListener("click", () => {
      $("#chatInput").value = text;
      $("#chatForm").requestSubmit();
    });
    bar.appendChild(b);
  }
  $("#feedStrip").insertBefore(bar, $("#chatForm"));
})();

// Keyboard-safe: on browsers without interactive-widget support, nudge the
// composer back above the on-screen keyboard.
$("#chatInput").addEventListener("focus", () => {
  setTimeout(() => $("#chatForm").scrollIntoView({ block: "end", behavior: "smooth" }), 250);
});

/* ---- boot ---- */

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

$("#joinForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  connect($("#nameInput").value.trim() || "anon").catch((err) => {
    btn.disabled = false;
    toast(`Could not load challenges: ${err.message}`, true);
  });
});

$("#startBtn").addEventListener("click", () => send({ type: "start" }));

$("#chatForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("#chatInput");
  const text = input.value.trim();
  if (!text) return;
  endTokens();
  const bubble = feedEl("bubble me");
  bubble.textContent = text;
  feedScroll();
  input.value = "";
  input.disabled = true;
  $("#chatSend").disabled = true;
  send({ type: "chat", text });
});

applyLayoutMode();
if (!phone.matches) $("#nameInput").focus(); // autofocus on a phone = keyboard over the logo
