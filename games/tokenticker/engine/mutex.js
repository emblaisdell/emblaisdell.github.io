// The first-solve mutex — the only game authority left on AWS.
//
// Judging happens on the phone (honor system, as chosen), so this endpoint
// takes the client's word that a suite passed. What it *does* guarantee is that
// exactly one player can claim a given challenge: the Lambda does a conditional
// DynamoDB write, so two phones finishing at once produce one winner and one
// "a rival got there first", not two prizes.
//
// Fails open. If AWS is unreachable the match keeps running and everyone wins
// their own prizes — a degraded leaderboard beats a stalled sprint.

const BASE = (document.querySelector('meta[name="mutex-url"]')?.content ?? "").replace(/\/$/, "");
const KEY = document.querySelector('meta[name="mutex-key"]')?.content ?? "";
const TIMEOUT_MS = 2500;

export function createMutex() {
  const claimedLocally = new Set();

  async function call(path, init = {}) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      return await fetch(`${BASE}${path}`, {
        ...init,
        signal: ac.signal,
        headers: { "content-type": "application/json", ...(KEY ? { "x-hf-key": KEY } : {}), ...init.headers },
      });
    } finally {
      clearTimeout(t);
    }
  }

  return {
    enabled: BASE !== "",

    /** Challenge ids already claimed, so the ladder deals fresh problems. */
    solvedIds() {
      return claimedLocally;
    },

    async refresh() {
      if (!BASE) return claimedLocally;
      try {
        const res = await call("/solved");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        for (const id of body.solved ?? []) claimedLocally.add(id);
      } catch {
        // Keep whatever we already know rather than reverting to "nothing solved".
      }
      return claimedLocally;
    },

    /**
     * @param {{challengeId: string, by: string, prize: number, room?: string}} claim
     * @returns {Promise<boolean>} true if this player won the claim
     */
    async claim({ challengeId, by, prize, room = "main" }) {
      if (!BASE) return true; // offline / local play: everything is first blood
      try {
        const res = await call("/solved", {
          method: "POST",
          // by/prize are what the host leaderboard tallies — without them every
          // row would read "anon $0".
          body: JSON.stringify({ challengeId, by, prize, room }),
        });
        if (res.status === 409) return false; // someone else got there first
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        claimedLocally.add(challengeId);
        return true;
      } catch {
        return true; // fail open
      }
    },
  };
}
