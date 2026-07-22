// The harness runtime, on the phone.
//
// The server used LangGraph.js to execute the spec. Here it is a direct
// interpreter — roughly forty lines, because the spec is already a validated
// graph with bounded loops. Dropping the dependency is what keeps the client
// buildless: no bundler, no node_modules, just ES modules the browser loads.
//
// The spec format is unchanged, so the same JSON still drives the interpreter,
// the agent's editing tools, and the visualisation.

import { impls } from "./palette.js";
import { AbortedError } from "./llm.js";

// Belt and braces: validate.js already proves every cycle carries a maxLoops,
// but an interpreter should not be able to wedge the tab if that ever regresses.
const MAX_STEPS = 64;

/**
 * Run one solve attempt of `spec` for `ctx.challenge`.
 * ctx: { player, challenge, emit(event), submit(code), signal }
 * @returns {Promise<{status: "done"|"aborted"|"error", solved: boolean, error?: Error}>}
 */
export async function runHarness(spec, ctx) {
  const nodesById = new Map(spec.nodes.map((n) => [n.id, n]));
  const edgesFrom = new Map();
  for (const e of spec.edges) {
    if (!edgesFrom.has(e.from)) edgesFrom.set(e.from, []);
    edgesFrom.get(e.from).push(e);
  }

  const loopCounts = new Map(); // "from->to" -> times taken this run
  const state = {
    plan: null, code: null, feedback: null,
    notes: null, testResults: null, lastOutcome: null,
  };

  let current = spec.entry;
  let solved = false;
  let steps = 0;

  ctx.emit({ type: "run_started", challengeId: ctx.challenge.id });
  try {
    while (current && steps++ < MAX_STEPS) {
      if (ctx.signal?.aborted) throw new AbortedError();
      const node = nodesById.get(current);
      if (!node) break;

      ctx.emit({ type: "node_started", nodeId: node.id });
      const { patch, outcome } = await impls[node.type](node, state, ctx);
      Object.assign(state, patch, { lastOutcome: outcome });
      ctx.emit({ type: "node_finished", nodeId: node.id, outcome });

      if (node.type === "submitter" && outcome === "pass") {
        solved = true;
        break;
      }
      current = nextNode(node, outcome, edgesFrom, loopCounts, ctx);
    }
    ctx.emit({ type: "run_finished", challengeId: ctx.challenge.id, result: solved ? "solved" : "done" });
    return { status: "done", solved };
  } catch (err) {
    const aborted = err instanceof AbortedError;
    ctx.emit({
      type: "run_finished",
      challengeId: ctx.challenge.id,
      result: aborted ? "aborted" : "error",
      ...(aborted ? {} : { error: String(err?.message ?? err) }),
    });
    return { status: aborted ? "aborted" : "error", solved, error: err };
  }
}

/** Pick the outgoing edge matching this outcome, honouring per-edge loop caps. */
function nextNode(node, outcome, edgesFrom, loopCounts, ctx) {
  for (const e of edgesFrom.get(node.id) ?? []) {
    if (e.when && e.when !== "always" && e.when !== outcome) continue;
    if (e.maxLoops) {
      const key = `${e.from}->${e.to}`;
      const used = loopCounts.get(key) ?? 0;
      if (used >= e.maxLoops) continue; // budget spent — fall through
      loopCounts.set(key, used + 1);
    }
    ctx.emit({ type: "edge_taken", from: e.from, to: e.to });
    return e.to;
  }
  return null; // no edge matched: the run ends here
}
