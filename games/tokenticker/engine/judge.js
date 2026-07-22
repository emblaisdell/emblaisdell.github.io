// Host side of the on-device judge. Owns the Worker lifecycle and the timeout,
// because a timeout enforced *inside* the sandbox is not a timeout — an
// infinite loop never yields to check it. terminate() is the only real answer,
// and only the host can call it.

const SANDBOX_TIMEOUT_MS = 1000;

let worker = null;
let seq = 0;
const pending = new Map(); // id -> {resolve, timer}

function spawn() {
  worker = new Worker(new URL("./judge.worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const entry = pending.get(e.data.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(e.data.id);
    entry.resolve(e.data);
  };
  // A worker that dies (OOM, internal error) must not hang every caller.
  worker.onerror = () => hardReset("sandbox crashed");
}

function hardReset(reason) {
  worker?.terminate();
  worker = null;
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    entry.resolve({ passed: false, failedCount: entry.total, total: entry.total, error: reason });
  }
  pending.clear();
}

/**
 * Run `code` against `tests` in the sandbox.
 * @returns {Promise<{passed, failedCount, total, error?, failures?}>}
 */
export function runTests(code, functionName, tests, timeoutMs = SANDBOX_TIMEOUT_MS) {
  if (!worker) spawn();
  const id = ++seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      // The worker is wedged in a loop; the whole worker goes, and the next
      // call spawns a fresh one. Anything else queued dies with it, which is
      // why runs are serialised one challenge at a time.
      hardReset("timed out");
    }, timeoutMs);
    pending.set(id, { resolve, timer, total: tests.length });
    worker.postMessage({ id, code, functionName, tests });
  });
}

/** Public sample tests — the test-runner node's view. */
export function runSampleTests(challenge, code) {
  return runTests(code, challenge.functionName, challenge.sampleTests ?? []);
}

/** Hidden suite — the submitter node's view. Honor system: these ship in the
 *  bundle, and the mutex on AWS takes the client's word for a pass. */
export function runHiddenTests(challenge, code) {
  return runTests(code, challenge.functionName, challenge.hiddenTests ?? []);
}

export function disposeJudge() {
  hardReset("disposed");
}
