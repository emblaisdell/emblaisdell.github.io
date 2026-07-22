// The player's chat companion, on the phone.
//
// Ported from server/agent.js. The tool loop is the same shape; the difference
// is Bedrock's Converse tool format instead of Anthropic's, which is why this
// is a rewrite rather than a copy. Tools mutate the local Match directly.
//
// Note the model choice: the companion runs on gpt-oss-120b, a mid-size pick
// rather than the roster's top end. It is a conversational sidekick, and
// wall-clock is the scarce resource in a 10-minute sprint — a slow brilliant
// reply is a worse companion than a fast decent one.

import { converse } from "./llm.js";
import { MODELS, MODEL_NAMES, DEFAULT_MODEL } from "./models.js";
import { LIMITS, COMPUTE_SHOP } from "./config.js";

const AGENT_MODEL = "gpt-oss-120b";
const AGENT_MAX_TOKENS = 1536;
const MAX_TURNS = 6;

const SYSTEM = `You are a player's agent inside "Token Ticker", a 10-minute competitive game about LLM harness design.

The player races others to solve coding challenges by running their HARNESS — a graph of stages you edit with your tools. Prize money buys compute (faster token delivery) on a ladder: ${COMPUTE_SHOP.map((i) => `${i.id} (+${i.gain} compute, from $${i.basePrice})`).join(" → ")}. Higher tiers are better $/compute, so banking a big prize for a rack or datacenter can beat buying GPUs one at a time.

Node palette:
- LLM nodes (need "model", optional "prompt" ≤ ${LIMITS.maxPromptLen} chars): planner, coder, critic (emits approve/reject), oracle (free-form).
- Mechanical nodes: test-runner (runs public sample tests; emits pass/fail), submitter (submits to the hidden suite; exactly one per graph; failed submits cost an escalating cooldown), memory (config: {op:"read"|"write", key}).

Edges: {from, to, when?, maxLoops?}. "when" filters on the source's outcome (always/pass/fail/approve/reject). Every cycle needs an edge with maxLoops (1-${LIMITS.maxLoops}). Limits: ${LIMITS.maxNodes} nodes, ${LIMITS.maxEdges} edges.

Model roster (real models, cheap → expensive):
${MODEL_NAMES.map((n) => `- ${n} — ${MODELS[n].title} (weight ${MODELS[n].weight}, $${MODELS[n].price.in}/$${MODELS[n].price.out} per 1M in/out): ${MODELS[n].blurb}`).join("\n")}
Every model is free to use in-game; the prices are flavor for the cost meter. The real cost is SPEED: effective tok/sec = compute / weight, so a heavy model on weak compute crawls. Model is set per node and hot-swappable at any time mid-match with set_node_model. The default every node starts on is ${DEFAULT_MODEL} (${MODELS[DEFAULT_MODEL].title}) — the small open-weight model.

Be a sharp, fast teammate. Make requested harness changes with tools immediately, then explain in one or two sentences. Wall-clock time is the scarce resource — keep replies short. If a tool returns a validation error, fix your edit and retry.`;

const tool = (name, description, properties, required = []) => ({
  toolSpec: {
    name,
    description,
    inputSchema: { json: { type: "object", properties, required } },
  },
});

const TOOLS = [
  tool("get_state", "Get money, compute, shop prices, challenges, and the current harness spec.", {}),
  tool("replace_graph", "Replace the entire harness spec. Prefer this for restructures.", {
    spec: { type: "object", description: "{entry, nodes, edges}" },
  }, ["spec"]),
  tool("list_models", "List the model roster: id, title, weight (speed divisor), price per 1M tokens, and blurb.", {}),
  tool("set_node_model", `Switch which model an LLM node runs on — free, anytime. Model ids: ${MODEL_NAMES.join(" | ")}.`, {
    id: { type: "string" },
    model: { type: "string", description: MODEL_NAMES.join(" | ") },
  }, ["id", "model"]),
  tool("buy_item", `Buy compute. Item ids: ${COMPUTE_SHOP.map((i) => i.id).join(" | ")}.`, {
    itemId: { type: "string" },
  }, ["itemId"]),
  tool("start_solve", "Start a harness run on a challenge id. One run at a time.", {
    challengeId: { type: "string" },
  }, ["challengeId"]),
];

/** Execute one tool against the local match. Mirrors server/agent.js executeTool. */
function executeTool(match, name, input) {
  switch (name) {
    case "get_state": {
      const s = match.stateFor();
      return { ok: true, data: { you: s.you, shop: s.shop, spec: s.spec, challenges: s.challenges.map((c) => ({ id: c.id, title: c.title, difficulty: c.difficulty, prize: c.prize, solvedBy: c.solvedBy })) } };
    }
    case "list_models":
      return {
        ok: true,
        data: {
          default: DEFAULT_MODEL,
          models: MODEL_NAMES.map((id) => {
            const m = MODELS[id];
            return { id, title: m.title, weight: m.weight, price: m.price, blurb: m.blurb };
          }),
        },
      };
    case "replace_graph":
      return match.setSpec(input.spec);
    case "set_node_model": {
      const spec = structuredClone(match.player.spec);
      const node = spec.nodes.find((n) => n.id === input.id);
      if (!node) return { ok: false, error: `no node ${input.id}` };
      if (!node.model) return { ok: false, error: `${input.id} is a mechanical node — it has no model` };
      node.model = input.model;
      return match.setSpec(spec);
    }
    case "buy_item":
      return match.buy(input.itemId);
    case "start_solve":
      return match.solve(input.challengeId);
    default:
      return { ok: false, error: `unknown tool ${name}` };
  }
}

/**
 * One chat turn, including the tool loop.
 * @param {Match} match
 * @param {Array} history  Converse messages, mutated in place
 * @param {string} text
 * @param {(msg: object) => void} emit  same event shapes the UI already renders
 */
export async function chat(match, history, text, emit) {
  history.push({ role: "user", content: [{ text }] });

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await converse({
        model: AGENT_MODEL,
        system: SYSTEM,
        messages: history,
        maxTokens: AGENT_MAX_TOKENS,
        toolConfig: { tools: TOOLS },
        playerId: match.player.id,
        onDelta: (delta) => emit({ type: "chat_delta", text: delta }),
        mockText: "On it — try adding a critic before the submitter so bad code never costs you a cooldown.",
      });

      match.player.cost = (match.player.cost ?? 0) + res.cost;

      const content = [];
      if (res.text) content.push({ text: res.text });
      for (const t of res.toolUses) {
        content.push({ toolUse: { toolUseId: t.toolUseId, name: t.name, input: t.input } });
      }
      history.push({ role: "assistant", content });

      if (!res.toolUses.length) break;

      const results = [];
      for (const t of res.toolUses) {
        const out = executeTool(match, t.name, t.input ?? {});
        emit({ type: "agent_tool", name: t.name, ok: out.ok, ...(out.ok ? {} : { error: out.error }) });
        results.push({
          toolResult: {
            toolUseId: t.toolUseId,
            content: [{ json: out.ok ? out.data ?? { ok: true } : { error: out.error } }],
            status: out.ok ? "success" : "error",
          },
        });
      }
      history.push({ role: "user", content: results });
    }
  } catch (err) {
    emit({ type: "chat_delta", text: `…${err?.retryable ? "the datacenter is busy" : "something glitched"}. Try that again?` });
  } finally {
    emit({ type: "chat_done" });
  }
}
