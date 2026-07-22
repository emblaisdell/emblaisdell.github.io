// Game tuning, phone-side. Everything the old server/config.js held that is
// still meaningful now that the match runs on the device.
//
// Gone from here: MATCH_TOKEN_CAP / ROOM_TOKEN_CAP / MAX_CONCURRENCY. Those
// were server-side ops guards; spend is now bounded by the Lambda pipe's
// per-player rate limit and the account budget alarm.

export { MODELS, MODEL_NAMES, DEFAULT_MODEL } from "./models.js";

export const MATCH_MS = 10 * 60 * 1000;
export const RESULTS_MS = 30 * 1000;
export const COUNTDOWN_MS = 5 * 1000;

export const START_MONEY = 0;
export const START_COMPUTE = 4; // tokens/sec at weight 1

// Every tier is repeatable and gets pricier per repeat purchase; higher tiers
// give better $/compute, so banking a big prize beats hoarding GPUs.
export const COMPUTE_SHOP = [
  { id: "gpu", title: "GPU", gain: 3, basePrice: 40, growth: 1.5 },
  { id: "rig", title: "GPU rig", gain: 12, basePrice: 130, growth: 1.5 },
  { id: "rack", title: "Server rack", gain: 35, basePrice: 330, growth: 1.5 },
  { id: "datacenter", title: "Data center", gain: 120, basePrice: 900, growth: 1.5 },
];

// Doubling per-challenge submit cooldown, capped (ms).
export const SUBMIT_COOLDOWNS_MS = [10_000, 20_000, 40_000, 80_000];

export const LIMITS = {
  maxNodes: 12,
  maxEdges: 20,
  maxPromptLen: 800,
  maxLoops: 5,
  idPattern: /^[a-z0-9-]{1,16}$/,
};

// How many of each tier a single match deals (the in-match ramp).
export const LADDER_SHAPE = { easy: 3, medium: 4, hard: 5, brutal: 2 };
export const DIFFICULTY_RANK = { easy: 0, medium: 1, hard: 2, brutal: 3 };
