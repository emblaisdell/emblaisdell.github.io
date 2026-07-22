// The sandbox. Runs candidate solutions on the player's own device.
//
// This replaces the server's isolated-vm. The threat model changed with the
// architecture: the code came from the player's own agent and runs in the
// player's own tab, so the job is containment of *accidents* (infinite loops,
// runaway allocation), not defence against a hostile attacker. A dedicated
// Worker gives that — it has no DOM, no parent scope, and the host kills it
// with terminate() when it overruns, which nothing inside the Worker can block.

self.onmessage = (e) => {
  const { code, functionName, tests, id } = e.data;
  try {
    // Indirect eval: evaluates in global scope, so the worker's local bindings
    // (including `id` and the message handler) are not visible to the code.
    const factory = (0, eval)(`(function(){ ${code}\n; return typeof ${functionName} === "function" ? ${functionName} : null; })`);
    const fn = factory();
    if (typeof fn !== "function") {
      return self.postMessage({ id, passed: false, failedCount: tests.length, total: tests.length, error: `no function named ${functionName}` });
    }

    let failed = 0;
    const failures = [];
    for (const t of tests) {
      let ok = false;
      let got;
      try {
        got = fn(...t.args);
        ok = JSON.stringify(got) === JSON.stringify(t.expected);
      } catch (err) {
        got = `threw: ${err?.message ?? err}`;
      }
      if (!ok) {
        failed++;
        // Kept for the player's own token console; hidden-suite detail is only
        // as secret as the bundle, which under the honor system is fine.
        if (failures.length < 3) failures.push({ args: t.args, expected: t.expected, got });
      }
    }
    self.postMessage({ id, passed: failed === 0, failedCount: failed, total: tests.length, failures });
  } catch (err) {
    // Syntax error, TDZ, anything at parse time — counts as failing everything.
    self.postMessage({ id, passed: false, failedCount: tests.length, total: tests.length, error: String(err?.message ?? err) });
  }
};
