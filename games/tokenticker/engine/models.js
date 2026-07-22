// The model roster. Shared verbatim by the browser, the Lambda pipe, and the
// local dev server — plain ESM with no imports so it loads everywhere.
//
// Game rule unchanged: every model is free to use, the cost is speed.
//     effective tok/sec = player.compute / model.weight
// Prices are USD per 1M tokens, used only for the local cost meter and flavor.
//
// Weight derivation — weights are PROPORTIONAL to model cost/heft:
//   blended  = sqrt(price.in * price.out)          (geometric mean, $/1M)
//   weight   = round((blended / cheapestBlended) ^ (2/3))
// The 2/3 exponent compresses the ~7x real price spread into a playable 1–4
// band while preserving order. Computed:
//   gpt-oss-20b     blended 0.149  ratio 1.00  → 1
//   ministral-8b    blended 0.150  ratio 1.00  → 1
//   gpt-oss-120b    blended 0.309  ratio 2.07  → 2
//   mistral-large-3 blended 0.866  ratio 5.80  → 3
//   deepseek-v3     blended 1.071  ratio 7.17  → 4
//
// ⚠️ Bedrock model ids drift, and several models are only reachable through a
// regional *inference profile* ("us." prefix) rather than the bare id. Run
//     npm run models:verify
// against your deploy region before the demo — it lists what the account can
// actually invoke and tells you exactly which ids to correct here.

export const MODELS = {
  "gpt-oss-20b": {
    title: "GPT-OSS 20B",
    short: "20B",
    bedrockId: "openai.gpt-oss-20b-1:0",
    weight: 1,
    price: { in: 0.0721, out: 0.309 },
    blurb: "OpenAI's small open-weight model. Tiny and instant — great for planners and critics where speed wins.",
  },
  "ministral-8b": {
    title: "Ministral 8B",
    short: "Min-8B",
    bedrockId: "mistral.ministral-8b-2410-v1:0",
    weight: 1,
    price: { in: 0.15, out: 0.15 },
    blurb: "Mistral's edge model. Cheap, even in and out — a steady all-rounder.",
  },
  "gpt-oss-120b": {
    title: "GPT-OSS 120B",
    short: "120B",
    bedrockId: "openai.gpt-oss-120b-1:0",
    weight: 2,
    price: { in: 0.1545, out: 0.618 },
    blurb: "The big open-weight sibling — six times the parameters of the 20B, half the speed.",
  },
  "mistral-large-3": {
    title: "Mistral Large 3",
    short: "Large3",
    bedrockId: "mistral.mistral-large-3-675b-instruct-v1:0",
    weight: 3,
    price: { in: 0.5, out: 1.5 },
    blurb: "Mistral's 675B flagship. Strong general coder — streams slowly until you buy compute.",
  },
  "deepseek-v3": {
    title: "DeepSeek V3",
    short: "DSv3",
    bedrockId: "deepseek.v3-1:0",
    weight: 4,
    price: { in: 0.62, out: 1.85 },
    blurb: "Reasoning-heavy. Brilliant on brutal challenges, glacial on a GPU.",
  },
};

export const DEFAULT_MODEL = "gpt-oss-20b";
export const MODEL_NAMES = Object.keys(MODELS); // ordered cheap → expensive

/** Resolve a game model key to the id the pipe should send to Bedrock. */
export function bedrockId(key) {
  return MODELS[key]?.bedrockId ?? key;
}

/** USD for one call. The whole roster is cheap; this exists so the UI can show
 *  players what their harness actually costs to run. */
export function costOf(key, inputTokens, outputTokens) {
  const p = MODELS[key]?.price;
  if (!p) return 0;
  return (inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out;
}
