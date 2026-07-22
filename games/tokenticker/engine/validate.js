// Validates a harness graph spec per docs/graph-spec.md.
// Returns { ok: true, spec } with defaults normalized, or { ok: false, errors: [...] }.

import { LIMITS, MODELS, DEFAULT_MODEL } from "./config.js";

export const LLM_TYPES = new Set(["planner", "coder", "critic", "oracle"]);
export const MECH_TYPES = new Set(["test-runner", "submitter", "memory"]);
export const ALL_TYPES = new Set([...LLM_TYPES, ...MECH_TYPES]);

// Outcomes each node type can emit. "always" edges match any outcome.
export const EMITS = {
  planner: ["always"],
  coder: ["always"],
  oracle: ["always"],
  memory: ["always"],
  critic: ["approve", "reject"],
  "test-runner": ["pass", "fail"],
  submitter: ["pass", "fail"],
};

// `requireReachable: false` (used for incremental agent edits) skips the
// entry-reachability and path-to-submitter checks so a node can be added
// before its edges. Full connectivity is enforced when a run starts.
export function validateSpec(raw, player, { requireReachable = true } = {}) {
  const errors = [];
  const err = (m) => errors.push(m);

  if (!raw || typeof raw !== "object") return fail(["spec must be an object"]);
  const spec = {
    version: 1,
    entry: raw.entry,
    nodes: Array.isArray(raw.nodes) ? raw.nodes : null,
    edges: Array.isArray(raw.edges) ? raw.edges : null,
  };
  if (!spec.nodes) err("nodes must be an array");
  if (!spec.edges) err("edges must be an array");
  if (errors.length) return fail(errors);

  if (spec.nodes.length > LIMITS.maxNodes) err(`too many nodes (max ${LIMITS.maxNodes})`);
  if (spec.edges.length > LIMITS.maxEdges) err(`too many edges (max ${LIMITS.maxEdges})`);

  const byId = new Map();
  for (const n of spec.nodes) {
    if (!n || typeof n !== "object") { err("node must be an object"); continue; }
    if (typeof n.id !== "string" || !LIMITS.idPattern.test(n.id)) {
      err(`invalid node id: ${JSON.stringify(n.id)}`); continue;
    }
    if (byId.has(n.id)) { err(`duplicate node id: ${n.id}`); continue; }
    if (!ALL_TYPES.has(n.type)) { err(`node ${n.id}: unknown type ${JSON.stringify(n.type)}`); continue; }
    if (LLM_TYPES.has(n.type)) {
      if (typeof n.model !== "string") err(`node ${n.id}: LLM node requires a model`);
      else if (!MODELS[n.model]) err(`node ${n.id}: unknown model ${JSON.stringify(n.model)} (use ${Object.keys(MODELS).join(" | ")})`);
      if (n.prompt != null && typeof n.prompt !== "string") err(`node ${n.id}: prompt must be a string`);
      if (typeof n.prompt === "string" && n.prompt.length > LIMITS.maxPromptLen)
        err(`node ${n.id}: prompt exceeds ${LIMITS.maxPromptLen} chars`);
    }
    if (n.type === "memory") {
      const op = n.config?.op;
      if (op !== "read" && op !== "write") err(`node ${n.id}: memory requires config.op read|write`);
      if (typeof n.config?.key !== "string") err(`node ${n.id}: memory requires config.key`);
    }
    byId.set(n.id, n);
  }

  const submitters = spec.nodes.filter((n) => n.type === "submitter");
  if (submitters.length !== 1) err(`exactly one submitter required (found ${submitters.length})`);

  if (typeof spec.entry !== "string" || !byId.has(spec.entry)) err(`entry must name an existing node`);

  const edges = [];
  const seenEdge = new Set();
  for (const e of spec.edges) {
    if (!e || typeof e !== "object") { err("edge must be an object"); continue; }
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from) { err(`edge references unknown node: ${JSON.stringify(e.from)}`); continue; }
    if (!to) { err(`edge references unknown node: ${JSON.stringify(e.to)}`); continue; }
    const when = e.when ?? "always";
    const allowed = new Set(["always", ...(EMITS[from.type] ?? [])]);
    if (!allowed.has(when)) err(`edge ${e.from}->${e.to}: '${when}' is not an outcome ${from.type} emits`);
    let maxLoops;
    if (e.maxLoops != null) {
      maxLoops = Number(e.maxLoops);
      if (!Number.isInteger(maxLoops) || maxLoops < 1 || maxLoops > LIMITS.maxLoops)
        err(`edge ${e.from}->${e.to}: maxLoops must be 1-${LIMITS.maxLoops}`);
    }
    const key = `${e.from}->${e.to}`;
    if (seenEdge.has(key)) err(`duplicate edge ${key}`);
    seenEdge.add(key);
    edges.push({ from: e.from, to: e.to, when, ...(maxLoops ? { maxLoops } : {}) });
  }
  if (errors.length) return fail(errors);

  // Termination: with maxLoops edges removed, the graph must be acyclic.
  const unbounded = edges.filter((e) => !e.maxLoops);
  if (hasCycle(spec.nodes.map((n) => n.id), unbounded))
    err("every cycle must contain at least one edge with maxLoops");

  if (requireReachable) {
    // Reachability from entry.
    const reach = reachable(spec.entry, edges, (e) => e.from, (e) => e.to);
    for (const n of spec.nodes) if (!reach.has(n.id)) err(`node ${n.id} is unreachable from entry`);

    // At least one path reaches the submitter.
    const canReachSubmit = reachable(submitters[0].id, edges, (e) => e.to, (e) => e.from);
    if (!canReachSubmit.has(spec.entry)) err("no path from entry reaches the submitter");
  }

  if (errors.length) return fail(errors);

  const nodes = spec.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    ...(LLM_TYPES.has(n.type) ? { model: n.model, prompt: n.prompt ?? "" } : {}),
    ...(n.config ? { config: n.config } : {}),
  }));
  return { ok: true, spec: { version: 1, entry: spec.entry, nodes, edges } };

  function fail(errs) {
    return { ok: false, errors: errs };
  }
}

function reachable(start, edges, srcOf, dstOf) {
  const adj = new Map();
  for (const e of edges) {
    if (!adj.has(srcOf(e))) adj.set(srcOf(e), []);
    adj.get(srcOf(e)).push(dstOf(e));
  }
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    for (const next of adj.get(stack.pop()) ?? []) {
      if (!seen.has(next)) { seen.add(next); stack.push(next); }
    }
  }
  return seen;
}

function hasCycle(nodeIds, edges) {
  const adj = new Map(nodeIds.map((id) => [id, []]));
  for (const e of edges) adj.get(e.from)?.push(e.to);
  const state = new Map(); // 1 = visiting, 2 = done
  const visit = (id) => {
    state.set(id, 1);
    for (const next of adj.get(id) ?? []) {
      if (state.get(next) === 1) return true;
      if (!state.has(next) && visit(next)) return true;
    }
    state.set(id, 2);
    return false;
  };
  return nodeIds.some((id) => !state.has(id) && visit(id));
}

export function startingSpec() {
  // The deliberately-bad harness everyone begins with.
  return {
    version: 1,
    entry: "code",
    nodes: [
      { id: "code", type: "coder", model: DEFAULT_MODEL, prompt: "Solve the challenge." },
      { id: "ship", type: "submitter" },
    ],
    edges: [{ from: "code", to: "ship", when: "always" }],
  };
}
