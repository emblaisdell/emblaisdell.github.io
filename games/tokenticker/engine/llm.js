// Browser-side model client. Talks NDJSON to the pipe (Lambda Function URL in
// production, the dev server locally) — identical contract either way.
//
// Zero dependencies on purpose: the pipe already decoded AWS's binary
// event-stream framing, so all this needs is fetch + a ReadableStream reader.
// That is what lets the game ship to GitHub Pages with no build step.

import { MODELS, costOf } from "./models.js";

// Same-origin "/pipe" during local dev; the deployed Function URL otherwise.
export const PIPE_URL =
  document.querySelector('meta[name="pipe-url"]')?.content?.trim() || "/pipe";

// ?mock=1 short-circuits the pipe entirely and returns each node's canned text.
// This is the fastest loop for UI work — no AWS, no tokens, no latency floor
// beyond the governor's — and it mirrors the server's old MOCK_LLM behaviour.
export const MOCK = new URLSearchParams(location.search).has("mock");

export class PipeError extends Error {
  constructor(message, retryable) {
    super(message);
    this.name = "PipeError";
    this.retryable = !!retryable;
  }
}

export class AbortedError extends Error {
  constructor() {
    super("run aborted");
    this.name = "AbortedError";
  }
}

/**
 * Stream one completion.
 *
 * @param {object} opts
 * @param {string} opts.model       game model key ("gpt-oss-20b" | "ministral-8b" | ...)
 * @param {Array}  opts.messages    Bedrock Converse messages
 * @param {string} [opts.system]
 * @param {number} [opts.maxTokens]
 * @param {object} [opts.toolConfig]
 * @param {string} [opts.playerId]  rate-limit key
 * @param {(text: string) => void} [opts.onDelta] raw arrival, pre-governor
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{text, toolUses, usage, cost, stopReason}>}
 */
export async function converse({
  model,
  messages,
  system,
  maxTokens = 1024,
  toolConfig,
  playerId,
  onDelta,
  signal,
  mockText,
}) {
  if (!MODELS[model]) throw new PipeError(`unknown model "${model}"`);
  if (signal?.aborted) throw new AbortedError();

  if (MOCK) {
    await new Promise((r) => setTimeout(r, 100 + Math.random() * 150));
    if (signal?.aborted) throw new AbortedError();
    const text = mockText ?? "(mock response)";
    const outputTokens = Math.ceil(text.length / 4);
    onDelta?.(text);
    return {
      text,
      toolUses: [],
      usage: { inputTokens: Math.ceil(JSON.stringify(messages).length / 4), outputTokens },
      stopReason: "end_turn",
      cost: 0,
    };
  }

  const res = await fetch(PIPE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      ...(system ? { system: [{ text: system }] } : {}),
      maxTokens,
      ...(toolConfig ? { toolConfig } : {}),
      playerId,
    }),
    signal,
  });
  if (!res.ok) throw new PipeError(`pipe HTTP ${res.status}`, res.status >= 500 || res.status === 429);

  let text = "";
  const toolUses = [];
  let usage = { inputTokens: 0, outputTokens: 0 };
  let stopReason = "end_turn";
  // Tool-use arguments arrive as a JSON string split across deltas, so they are
  // accumulated per content-block index and parsed once the block closes.
  const partialTools = new Map();

  for await (const event of ndjson(res.body, signal)) {
    if (event.error) throw new PipeError(event.error, event.retryable);

    const { contentBlockStart, contentBlockDelta, contentBlockStop, messageStop, metadata } = event;

    if (contentBlockStart?.start?.toolUse) {
      partialTools.set(contentBlockStart.contentBlockIndex, {
        ...contentBlockStart.start.toolUse,
        json: "",
      });
    }
    if (contentBlockDelta?.delta?.text) {
      text += contentBlockDelta.delta.text;
      onDelta?.(contentBlockDelta.delta.text);
    }
    if (contentBlockDelta?.delta?.toolUse) {
      const entry = partialTools.get(contentBlockDelta.contentBlockIndex);
      if (entry) entry.json += contentBlockDelta.delta.toolUse.input ?? "";
    }
    if (contentBlockStop) {
      const entry = partialTools.get(contentBlockStop.contentBlockIndex);
      if (entry) {
        let input = {};
        try {
          input = entry.json ? JSON.parse(entry.json) : {};
        } catch {
          // A truncated argument blob is a failed tool call, not a dead run.
        }
        toolUses.push({ toolUseId: entry.toolUseId, name: entry.name, input });
        partialTools.delete(contentBlockStop.contentBlockIndex);
      }
    }
    if (messageStop?.stopReason) stopReason = messageStop.stopReason;
    if (metadata?.usage) usage = metadata.usage;
  }

  return {
    text,
    toolUses,
    usage,
    stopReason,
    cost: costOf(model, usage.inputTokens ?? 0, usage.outputTokens ?? 0),
  };
}

/** Yield parsed objects from an NDJSON byte stream. */
async function* ndjson(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) throw new AbortedError();
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Keep the trailing fragment: a JSON object can straddle two chunks.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) yield JSON.parse(line);
      }
    }
    if (buffer.trim()) yield JSON.parse(buffer);
  } finally {
    reader.cancel().catch(() => {});
  }
}
