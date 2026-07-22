// Node implementations, ported from the server. Each impl returns
// { patch, outcome }. LLM nodes stream from the pipe at full speed, then meter
// the text through the governor — that await is what makes compute matter.
//
// Only two things changed in the port: completions go through the pipe instead
// of the Anthropic SDK, and the test-runner judges in a Web Worker instead of
// isolated-vm. The game semantics are identical.

import { MODELS, DEFAULT_MODEL } from "./models.js";
import { converse, AbortedError } from "./llm.js";
import { meter } from "./governor.js";
import { runSampleTests } from "./judge.js";

const NODE_MAX_TOKENS = 2048;
const TEST_RUNNER_MS = 500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function challengeContext(ctx, state) {
  const c = ctx.challenge;
  const parts = [
    `## Challenge: ${c.title}`,
    c.prompt,
    `Starter code:\n\`\`\`js\n${c.starterCode}\n\`\`\``,
    `Sample tests: ${JSON.stringify(c.sampleTests)}`,
  ];
  if (state.plan) parts.push(`## Plan\n${state.plan}`);
  if (state.notes) parts.push(`## Notes\n${state.notes}`);
  if (state.code) parts.push(`## Current solution\n\`\`\`js\n${state.code}\n\`\`\``);
  if (state.feedback) parts.push(`## Reviewer feedback\n${state.feedback}`);
  if (state.testResults) parts.push(`## Last test results\n${JSON.stringify(state.testResults)}`);
  return parts.join("\n\n");
}

function extractCode(text) {
  const fence = text.match(/```(?:js|javascript)?\n([\s\S]*?)```/);
  return (fence ? fence[1] : text).trim();
}

const normalize = (s) => (s ?? "").replace(/\s+/g, " ").trim();

async function runLLMNode(node, state, ctx, { system, instruction, mockText }) {
  const model = MODELS[node.model] ?? MODELS[DEFAULT_MODEL];

  // Ask contract event: tell the UI what this node is about to ask the model,
  // as a compact one-liner (instruction + operator prompt, capped ~200 chars).
  const askText = `${instruction}${node.prompt ? ` — ${node.prompt}` : ""}`
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  ctx.emit({ type: "ask", nodeId: node.id, text: askText });

  const { text, cost } = await converse({
    model: node.model,
    system,
    messages: [
      {
        role: "user",
        content: [
          {
            text: `${challengeContext(ctx, state)}\n\n## Your task\n${instruction}${
              node.prompt ? `\n\nOperator instructions: ${node.prompt}` : ""
            }`,
          },
        ],
      },
    ],
    maxTokens: NODE_MAX_TOKENS,
    playerId: ctx.player.id,
    signal: ctx.signal,
    mockText,
  });

  // Real spend meter (mock mode returns 0). The governor makes speed the
  // in-game cost; this keeps the actual dollars honest for the results screen.
  ctx.player.cost = (ctx.player.cost ?? 0) + cost;

  // Pipe delivered at full speed; the player's compute decides how fast the
  // game actually sees it.
  await meter({
    text,
    getCompute: () => ctx.player.compute,
    weight: model.weight,
    onToken: (tok) => ctx.emit({ type: "tokens", nodeId: node.id, text: tok }),
    signal: ctx.signal,
  });
  return text;
}

export const impls = {
  async planner(node, state, ctx) {
    const text = await runLLMNode(node, state, ctx, {
      system: "You are the planning stage of a coding harness. Produce a short, concrete implementation plan. No code.",
      instruction: "Write a brief plan for solving this challenge.",
      mockText: `Plan: implement ${ctx.challenge.functionName} directly, mind the edge cases in the sample tests.`,
    });
    return { patch: { plan: text }, outcome: "always" };
  },

  async coder(node, state, ctx) {
    const c = ctx.challenge;
    // Mock behaviour teaches the loop: the first attempt ships the buggy
    // variant and only revises once feedback or a test failure exists.
    // reference/buggy are present only in the dev bundle.
    const hasSignal = !!state.feedback || state.testResults?.passed === false;
    const mockSolution = hasSignal || !c.buggy ? c.reference : c.buggy;
    const text = await runLLMNode(node, state, ctx, {
      system:
        "You are the coding stage of a coding harness. Output ONLY the complete solution as a single ```js fenced code block defining the required function. No commentary.",
      instruction: `Write (or revise) the complete implementation of ${c.functionName}.`,
      mockText: mockSolution ? `\`\`\`js\n${mockSolution}\n\`\`\`` : "```js\n// no dev solution bundled\n```",
    });
    return { patch: { code: extractCode(text) }, outcome: "always" };
  },

  async critic(node, state, ctx) {
    const c = ctx.challenge;
    const mockOk = normalize(state.code) === normalize(c.reference);
    const text = await runLLMNode(node, state, ctx, {
      system:
        "You are the review stage of a coding harness. Scrutinize the current solution for bugs and edge cases. End your review with exactly APPROVE or REJECT on its own line.",
      instruction: "Review the current solution against the challenge and sample tests.",
      mockText: mockOk
        ? "Looks correct for all cases I can construct.\nAPPROVE"
        : "I found an edge case this fails — re-read the challenge statement carefully.\nREJECT",
    });
    const outcome = /\bREJECT\b/i.test(text.slice(-200)) ? "reject" : "approve";
    return { patch: { feedback: text }, outcome };
  },

  async oracle(node, state, ctx) {
    const text = await runLLMNode(node, state, ctx, {
      system:
        "You are a custom stage of a coding harness. Follow the operator instructions; write your output as notes for downstream stages.",
      instruction: "Produce whatever the operator instructions ask for.",
      mockText: "Notes: nothing unusual; watch the empty-input case.",
    });
    return { patch: { notes: text }, outcome: "always" };
  },

  async "test-runner"(node, state, ctx) {
    await sleep(TEST_RUNNER_MS);
    if (ctx.signal?.aborted) throw new AbortedError();
    const res = await runSampleTests(ctx.challenge, state.code ?? "");
    return {
      patch: { testResults: { passed: res.passed, failedCount: res.failedCount } },
      outcome: res.passed ? "pass" : "fail",
    };
  },

  async memory(node, state, ctx) {
    const { op, key, source } = node.config ?? {};
    if (op === "write") {
      ctx.player.memory[key] = String(state[source ?? "notes"] ?? "");
      return { patch: {}, outcome: "always" };
    }
    const stored = ctx.player.memory[key];
    const patch = stored
      ? { notes: `${state.notes ? state.notes + "\n" : ""}[memory:${key}] ${stored}` }
      : {};
    return { patch, outcome: "always" };
  },

  async submitter(node, state, ctx) {
    const result = await ctx.submit(state.code ?? "");
    const testResults = result.cooldownRemaining
      ? { passed: false, cooldownRemaining: result.cooldownRemaining }
      : { passed: result.passed, failedCount: result.failedCount };
    ctx.emit({
      type: "submit_result",
      challengeId: ctx.challenge.id,
      passed: result.passed,
      failedCount: result.failedCount,
      firstBlood: result.firstBlood,
      prize: result.prize,
      cooldown: result.cooldown ?? 0,
      cooldownRemaining: result.cooldownRemaining ?? 0,
    });
    return { patch: { testResults }, outcome: result.passed ? "pass" : "fail" };
  },
};
