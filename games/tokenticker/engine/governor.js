// Token pacing, ported from the server unchanged in spirit:
//     effective tok/sec = player.compute / model.weight
// The pipe delivers at full speed; this is what turns "buy compute" into a
// felt mechanic. The rate is re-read every tick, so a purchase mid-stream
// speeds up the stream already running.
//
// The harness awaits metering, so downstream nodes genuinely wait — throttle
// decides races, not just visuals.

import { AbortedError } from "./llm.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Rough token split that reads naturally when streamed. */
export function tokenize(text) {
  return text.match(/\S{1,8}\s*|\s+/g) ?? [];
}

/**
 * Release `text` token-by-token at the player's current effective rate.
 * @param {object} opts
 * @param {string} opts.text
 * @param {() => number} opts.getCompute live compute reader
 * @param {number} opts.weight           model weight
 * @param {(tok: string) => void} opts.onToken
 * @param {AbortSignal} [opts.signal]
 */
export async function meter({ text, getCompute, weight, onToken, signal }) {
  for (const tok of tokenize(text)) {
    if (signal?.aborted) throw new AbortedError();
    const compute = Math.max(1, getCompute());
    await sleep((1000 * weight) / compute);
    if (signal?.aborted) throw new AbortedError();
    onToken(tok);
  }
}
