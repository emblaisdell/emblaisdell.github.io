// The match, on the phone.
//
// This replaces server/rooms.js + server/judge.js's Judge class. It emits the
// exact same event shapes the WebSocket client already renders, so the UI layer
// did not have to change: swapping the transport for a direct call is the whole
// port.
//
// AWS keeps only two jobs, and neither is in here: matchmaking (who is in the
// lobby) and the first-solve mutex (claimChallenge). Everything else — dealing
// the ladder, pacing tokens, running the harness, judging — is local.

import {
  MATCH_MS, RESULTS_MS, COUNTDOWN_MS, START_MONEY, START_COMPUTE,
  SUBMIT_COOLDOWNS_MS, LADDER_SHAPE, DIFFICULTY_RANK,
} from "./config.js";
import { startingSpec, validateSpec } from "./validate.js";
import { shopFor, buy } from "./economy.js";
import { runHarness } from "./harness.js";
import { runHiddenTests } from "./judge.js";

/* ---- ladder ------------------------------------------------------------- */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sample(arr, n, rng) {
  const pool = [...arr];
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

/** Deal one match's ladder, easy→hard. `exclude` comes from the AWS ledger. */
export function dealChallenges(pool, { seed = (Math.random() * 2 ** 32) >>> 0, exclude } = {}) {
  const rng = mulberry32(seed);
  const byTier = { easy: [], medium: [], hard: [], brutal: [] };
  for (const c of pool) byTier[c.difficulty]?.push(c);

  if (exclude?.size) {
    for (const [tier, list] of Object.entries(byTier)) {
      const fresh = list.filter((c) => !exclude.has(c.id));
      if (fresh.length >= (LADDER_SHAPE[tier] ?? 0)) byTier[tier] = fresh;
    }
  }

  let picked = [];
  for (const [tier, count] of Object.entries(LADDER_SHAPE)) {
    picked.push(...sample(byTier[tier] ?? [], count, rng));
  }
  picked.sort((a, b) => DIFFICULTY_RANK[a.difficulty] - DIFFICULTY_RANK[b.difficulty] || a.prize - b.prize);
  return picked.map((c) => ({ ...c, solvedBy: null }));
}

/* ---- match -------------------------------------------------------------- */

function freshPlayer(id, name) {
  return {
    id, name,
    money: START_MONEY,
    compute: START_COMPUTE,
    purchases: {},
    spec: startingSpec(),
    memory: {},
    solved: [],
    activeRun: null,
    cost: 0, // real USD spent this match, for the local meter
  };
}

export class Match {
  /**
   * @param {object} opts
   * @param {Array}  opts.pool      every challenge from challenges.json
   * @param {Function} opts.emit    receives the same messages the WS used to send
   * @param {object} [opts.mutex]   { claim(challengeId) -> Promise<boolean>, solvedIds() -> Set }
   */
  constructor({ pool, emit, mutex }) {
    this.pool = pool;
    this.emit = emit;
    this.mutex = mutex ?? { claim: async () => true, solvedIds: () => new Set() };
    this.phase = "lobby";
    this.endsAt = null;
    this.challenges = [];
    this.player = null;
    this.rivals = [];      // filled by the matchmaking socket, when there is one
    this.cooldowns = new Map(); // challengeId -> {fails, until}
    this.timer = null;
  }

  join(name) {
    this.player = freshPlayer(Math.random().toString(36).slice(2, 10), String(name || "anon").slice(0, 24));
    this.emit({ type: "joined", playerId: this.player.id, ...this.stateFor() });
    this.broadcastRoom();
  }

  start() {
    if (this.phase !== "lobby") return { ok: false, error: `cannot start from ${this.phase}` };
    this.phase = "countdown";
    this.endsAt = Date.now() + COUNTDOWN_MS;
    this.broadcastRoom();
    this.timer = setTimeout(() => this.begin(), COUNTDOWN_MS);
    return { ok: true };
  }

  begin() {
    this.phase = "running";
    this.endsAt = Date.now() + MATCH_MS;
    this.challenges = dealChallenges(this.pool, { exclude: this.mutex.solvedIds() });
    this.cooldowns.clear();
    Object.assign(this.player, freshPlayer(this.player.id, this.player.name));
    this.emit({ type: "snapshot", ...this.stateFor() });
    this.broadcastRoom();
    this.timer = setTimeout(() => this.end(), MATCH_MS);
  }

  end() {
    this.phase = "results";
    this.endsAt = Date.now() + RESULTS_MS;
    this.player.activeRun?.abort();
    this.emit({
      type: "results",
      standings: [
        {
          id: this.player.id, name: this.player.name,
          money: this.player.money, compute: this.player.compute,
          solved: this.player.solved, cost: this.player.cost,
          finalGraph: this.player.spec,
        },
        ...this.rivals,
      ].sort((a, b) => b.solved.length - a.solved.length || b.money - a.money),
    });
    this.broadcastRoom();
    this.timer = setTimeout(() => this.reset(), RESULTS_MS);
  }

  reset() {
    this.phase = "lobby";
    this.endsAt = null;
    this.challenges = [];
    Object.assign(this.player, freshPlayer(this.player.id, this.player.name));
    this.emit({ type: "snapshot", ...this.stateFor() });
    this.broadcastRoom();
  }

  /* ---- actions ---------------------------------------------------------- */

  cooldownRemaining(challengeId, now = Date.now()) {
    const entry = this.cooldowns.get(challengeId);
    return entry && entry.until > now ? entry.until - now : 0;
  }

  solve(challengeId) {
    if (this.phase !== "running") return { ok: false, error: "match is not running" };
    if (this.player.activeRun) return { ok: false, error: "a run is already in flight" };
    const challenge = this.challenges.find((c) => c.id === challengeId);
    if (!challenge) return { ok: false, error: `unknown challenge ${challengeId}` };
    if (challenge.solvedBy) return { ok: false, error: "already solved — the prize is gone" };
    const remaining = this.cooldownRemaining(challengeId);
    if (remaining > 0) return { ok: false, error: `submit cooldown: ${Math.ceil(remaining / 1000)}s left` };
    const valid = validateSpec(this.player.spec, this.player);
    if (!valid.ok) return { ok: false, error: `harness incomplete: ${valid.errors.join("; ")}` };

    const ac = new AbortController();
    this.player.activeRun = () => ac.abort();

    runHarness(structuredClone(this.player.spec), {
      player: this.player,
      challenge,
      signal: ac.signal,
      emit: (e) => this.emit(e),
      submit: (code) => this.submit(challenge, code),
    }).finally(() => {
      this.player.activeRun = null;
    });
    return { ok: true };
  }

  /** Judge locally, then ask AWS for the prize. The mutex is the only authority
   *  on who was first — two phones can both pass, only one can claim. */
  async submit(challenge, code) {
    const remaining = this.cooldownRemaining(challenge.id);
    if (remaining > 0) {
      return { passed: false, failedCount: null, firstBlood: false, prize: 0, cooldownRemaining: remaining };
    }

    const result = await runHiddenTests(challenge, code ?? "");

    if (!result.passed) {
      const entry = this.cooldowns.get(challenge.id) ?? { fails: 0, until: 0 };
      const idx = Math.min(entry.fails, SUBMIT_COOLDOWNS_MS.length - 1);
      entry.fails += 1;
      entry.until = Date.now() + SUBMIT_COOLDOWNS_MS[idx];
      this.cooldowns.set(challenge.id, entry);
      return {
        passed: false, failedCount: result.failedCount, firstBlood: false,
        prize: 0, cooldown: SUBMIT_COOLDOWNS_MS[idx],
      };
    }

    const firstBlood = await this.mutex.claim({
      challengeId: challenge.id,
      by: this.player.name,
      prize: challenge.prize,
    });
    let prize = 0;
    if (firstBlood) {
      challenge.solvedBy = this.player.id;
      prize = challenge.prize;
      this.player.money += prize;
      this.player.solved.push(challenge.id);
      this.emit({ type: "challenge_solved", challengeId: challenge.id, playerId: this.player.id, prize });
      this.playerUpdated();
    } else {
      challenge.solvedBy = "rival";
    }
    return { passed: true, failedCount: 0, firstBlood, prize };
  }

  buy(itemId) {
    const res = buy(this.player, itemId);
    if (res.ok) this.playerUpdated();
    return res;
  }

  /** Apply a validated spec (the agent's editing tools land here). */
  setSpec(spec) {
    const valid = validateSpec(spec, this.player);
    if (!valid.ok) return { ok: false, error: valid.errors.join("; ") };
    this.player.spec = valid.spec;
    // Harness surgery interrupts a run in flight — same rule as the server.
    this.player.activeRun?.();
    this.emit({ type: "graph_updated", spec: this.player.spec });
    return { ok: true };
  }

  /* ---- state ------------------------------------------------------------ */

  stateFor() {
    return {
      you: {
        id: this.player.id, name: this.player.name,
        money: this.player.money, compute: this.player.compute,
        solved: this.player.solved,
        cooldowns: Object.fromEntries(
          this.challenges.map((c) => [c.id, this.cooldownRemaining(c.id)]).filter(([, ms]) => ms > 0),
        ),
      },
      spec: this.player.spec,
      shop: shopFor(this.player),
      challenges: this.challenges,
      phase: this.phase,
      endsAt: this.endsAt,
    };
  }

  playerUpdated() {
    this.emit({
      type: "player_update",
      money: this.player.money, compute: this.player.compute,
      solved: this.player.solved, shop: shopFor(this.player),
    });
    this.broadcastRoom();
  }

  broadcastRoom() {
    this.emit({
      type: "room",
      phase: this.phase,
      endsAt: this.endsAt,
      players: [
        { id: this.player.id, name: this.player.name, money: this.player.money, compute: this.player.compute, solved: this.player.solved.length },
        ...this.rivals.map((r) => ({ ...r, solved: r.solved?.length ?? 0 })),
      ],
    });
  }
}
