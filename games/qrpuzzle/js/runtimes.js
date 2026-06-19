// Language runtimes for the playground. Each runtime exposes the same `qr`
// surface to player code — qr.current (the broken QR), qr.seen (previous broken
// QRs) and qr.show(result) — and reports { ok, output } from run().
//
// JavaScript runs natively (no download, the default). Python uses Pyodide in a
// Web Worker (so loading it never freezes the UI) and is lazy: it only loads when
// its tab is first selected. New runtimes can be added to the registry below.

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const serial = (flat) => ({ flat: Array.from(flat.data), shape: flat.shape });

// User JS is wrapped as `(async (qr, console) => {\n<code>\n})`, so reported
// line numbers are 1 higher than the editor's. Show "Name: message (line N)".
function fmtJsErr(e) {
  if (!(e instanceof Error)) return String(e);
  const head = (e.name || 'Error') + ': ' + (e.message || '');
  for (const f of String(e.stack || '').split('\n')) {
    const m = f.match(/qr-playground\.js:(\d+):/);
    if (m) return head + ' (line ' + Math.max(1, +m[1] - 1) + ')';
  }
  return head;
}

// wasmoon errors look like `[string "..."]:N: message`; the user code is its own
// chunk, so N is the editor line. Strip the chunk-name noise.
function fmtLuaErr(msg) {
  const m = String(msg).match(/\]:(\d+): ([\s\S]*)$/);
  return m ? 'Line ' + m[1] + ': ' + m[2] : String(msg);
}

// flat { data, shape:[n,n,3] } -> n×n×3 nested array of [r,g,b]
function nested(flat) {
  const n = flat.shape[0];
  const d = flat.data;
  const out = [];
  let i = 0;
  for (let y = 0; y < n; y++) {
    const row = [];
    for (let x = 0; x < n; x++) row.push([d[i++], d[i++], d[i++]]);
    out.push(row);
  }
  return out;
}

// Normalize a user-provided array to n×n×3 pixels (same rules as Python qr.show):
// an (n,n,3) array is RGB; a 2D array is a 0/1 mask (1 = black) or 0-255 grayscale.
function toPixels(arr) {
  const is3D = Array.isArray(arr[0]) && Array.isArray(arr[0][0]);
  if (is3D)
    return arr.map((row) => row.map((px) => [clamp(px[0]), clamp(px[1] ?? px[0]), clamp(px[2] ?? px[0])]));
  let max = 0;
  for (const row of arr) for (const v of row) if (v > max) max = v;
  const mask = max <= 1;
  return arr.map((row) => row.map((v) => {
    const g = mask ? (v >= 0.5 ? 0 : 255) : clamp(v);
    return [g, g, g];
  }));
}

const fmt = (x) => {
  if (typeof x === 'string') return x;
  try { return JSON.stringify(x); } catch { return String(x); }
};

export function createRuntimes(onFixed) {
  // ---- JavaScript (native, default, no load) ----
  let jsState = { cur: null, seen: [] };
  const js = {
    id: 'js',
    label: 'JavaScript',
    lazy: false,
    ready: true,
    defaultCode:
      `// qr.current is the broken QR: an (n, n, 3) array of [r, g, b], values 0-255.\n` +
      `// qr.seen is a list of previous broken QRs; qr.show(result) draws the fixed QR.\n` +
      `const img = qr.current;\n\n// TODO: repair the QR, then show it so you can scan it.\n\nqr.show(img);\n`,
    help:
      `<p><code>qr.current</code> &mdash; the broken QR as an <code>(n, n, 3)</code> array of <code>[r, g, b]</code> values 0&ndash;255 (black/white modules are <code>[0,0,0]</code> / <code>[255,255,255]</code>). <code>qr.n</code> is its size.</p>` +
      `<p><code>qr.seen</code> &mdash; an array of every previous broken QR, oldest first; <code>qr.seen[0]</code> is the first code you saw.</p>` +
      `<p><code>qr.show(result)</code> &mdash; draws the QR to scan. Pass an <code>(n, n, 3)</code> array (RGB), or a 2-D array (a 0/1 mask or 0&ndash;255 grayscale).</p>` +
      `<p><kbd>Ctrl/Cmd</kbd>+<kbd>Enter</kbd> or <kbd>Ctrl/Cmd</kbd>+<kbd>S</kbd> runs your code.</p>`,
    async ensureReady() {},
    loadQR(cur, seen) { jsState = { cur, seen }; },
    async run(code) {
      const buf = [];
      const sandboxConsole = {
        log: (...a) => buf.push(a.map(fmt).join(' ')),
        error: (...a) => buf.push(a.map(fmt).join(' ')),
        warn: (...a) => buf.push(a.map(fmt).join(' ')),
        info: (...a) => buf.push(a.map(fmt).join(' ')),
      };
      const qr = {
        n: jsState.cur.shape[0],
        current: nested(jsState.cur),
        seen: jsState.seen.map(nested),
        show: (a) => onFixed(toPixels(a)),
      };
      // sourceURL gives errors a clean filename + line numbers; the +'\n' keeps
      // the offset constant (1) so fmtJsErr can map back to the editor line.
      const wrapped = '(async (qr, console) => {\n' + code + '\n})\n//# sourceURL=qr-playground.js';
      let fn;
      try {
        fn = (0, eval)(wrapped);
      } catch (e) {
        return { ok: false, output: fmtJsErr(e) }; // syntax error
      }
      try {
        await fn(qr, sandboxConsole);
        return { ok: true, output: buf.join('\n') };
      } catch (e) {
        buf.push(fmtJsErr(e));
        return { ok: false, output: buf.join('\n') };
      }
    },
  };

  // ---- Python (Pyodide in a Web Worker, lazy) ----
  const python = {
    id: 'python',
    label: 'Python',
    lazy: true,
    ready: false,
    _worker: null,
    _runId: 0,
    _pending: new Map(),
    _onProgress: null,
    defaultCode:
      `# qr.current is the broken QR as an (n, n, 3) RGB array, values 0-255.\n` +
      `# qr.seen is a list of previous broken QRs; qr.show(result) draws the fixed QR.\n` +
      `import numpy as np\n\nimg = qr.current\n\n# TODO: repair the QR, then show it so you can scan it.\n\nqr.show(img)\n`,
    help:
      `<p><code>qr.current</code> &mdash; the broken QR as an <code>(n, n, 3)</code> NumPy array of RGB values 0&ndash;255 (black/white modules are <code>(0,0,0)</code> / <code>(255,255,255)</code>). <code>qr.n</code> is its size.</p>` +
      `<p><code>qr.seen</code> &mdash; a list of every previous broken QR, oldest first; <code>qr.seen[0]</code> is the first code you saw.</p>` +
      `<p><code>qr.show(result)</code> &mdash; draws the QR to scan. Pass an <code>(n, n, 3)</code> array (RGB), or a 2-D array (a 0/1 mask or 0&ndash;255 grayscale).</p>` +
      `<p><kbd>Ctrl/Cmd</kbd>+<kbd>Enter</kbd> or <kbd>Ctrl/Cmd</kbd>+<kbd>S</kbd> runs your code.</p>`,
    // Memoized so switching tabs mid-load doesn't spin up a second worker.
    ensureReady(onProgress) {
      this._onProgress = onProgress;
      if (this.ready) return Promise.resolve();
      if (!this._loading)
        this._loading = new Promise((resolve, reject) => {
          const w = new Worker(new URL('./sandbox-worker.js', import.meta.url));
          this._worker = w;
          w.onmessage = (e) => {
            const m = e.data;
            if (m.type === 'progress') this._onProgress && this._onProgress(m.msg);
            else if (m.type === 'show') onFixed(JSON.parse(m.json));
            else if (m.type === 'ready') { this.ready = true; resolve(); }
            else if (m.type === 'initerror') reject(new Error(m.msg));
            else if (m.type === 'result') {
              const done = this._pending.get(m.id);
              if (done) { this._pending.delete(m.id); done({ ok: m.ok, output: m.output }); }
            }
          };
          w.onerror = (err) => reject(new Error(err.message || 'worker failed'));
          w.postMessage({ type: 'init' });
        });
      return this._loading;
    },
    loadQR(cur, seen) {
      // Fire-and-forget; the worker processes messages in order, so this is
      // applied before the next run().
      if (this._worker) this._worker.postMessage({ type: 'loadQR', cur: serial(cur), seen: seen.map(serial) });
    },
    run(code) {
      const id = ++this._runId;
      return new Promise((resolve) => {
        this._pending.set(id, resolve);
        this._worker.postMessage({ type: 'run', id, code });
      });
    },
  };

  // ---- Lua (wasmoon = Lua 5.4 in WASM, lazy) ----
  const WASMOON = 'https://cdn.jsdelivr.net/npm/wasmoon@1.16.0/+esm';
  const WASMOON_WASM = 'https://cdn.jsdelivr.net/npm/wasmoon@1.16.0/dist/glue.wasm';
  const luaFlat = (flat) => '{' + Array.from(flat.data).join(',') + '}';
  let luaFactory = null;
  let luaState = { cur: null, seen: [] };
  const lua = {
    id: 'lua',
    label: 'Lua',
    lazy: true,
    ready: false,
    defaultCode:
      `-- qr.current is the broken QR: rows of {r, g, b} tables, 0-255 (tables are 1-indexed).\n` +
      `-- qr.seen is a list of previous broken QRs; qr.show(result) draws the fixed QR.\n` +
      `local img = qr.current\n\n-- TODO: repair the QR, then show it so you can scan it.\n\nqr.show(img)\n`,
    help:
      `<p><code>qr.current</code> &mdash; the broken QR as 1-indexed tables: <code>qr.current[y][x]</code> is <code>{r, g, b}</code>, values 0&ndash;255 (black/white modules are <code>{0,0,0}</code> / <code>{255,255,255}</code>). <code>qr.n</code> is its size.</p>` +
      `<p><code>qr.seen</code> &mdash; a list of every previous broken QR, oldest first; <code>qr.seen[1]</code> is the first code you saw.</p>` +
      `<p><code>qr.show(result)</code> &mdash; draws the QR to scan. Pass an <code>(n, n, 3)</code> table (RGB), or a 2-D table (a 0/1 mask or 0&ndash;255 grayscale). <code>print(...)</code> writes to the output.</p>` +
      `<p><kbd>Ctrl/Cmd</kbd>+<kbd>Enter</kbd> or <kbd>Ctrl/Cmd</kbd>+<kbd>S</kbd> runs your code.</p>`,
    // Memoized so switching tabs mid-load doesn't re-import wasmoon.
    ensureReady(onProgress) {
      this._onProgress = onProgress;
      if (this.ready) return Promise.resolve();
      if (!this._loading)
        this._loading = (async () => {
          this._onProgress && this._onProgress('Loading Lua…');
          const { LuaFactory } = await import(WASMOON);
          luaFactory = new LuaFactory(WASMOON_WASM);
          this.ready = true;
        })();
      return this._loading;
    },
    loadQR(cur, seen) { luaState = { cur, seen }; },
    async run(code) {
      const buf = [];
      // enableProxy:false -> Lua tables passed to JS are deep-converted to real
      // JS arrays (so qr.show's result is a plain nested array, not a proxy).
      const eng = await luaFactory.createEngine({ enableProxy: false }); // fresh state each run
      try {
        eng.global.set('_jsprint', (...a) => buf.push(a.map(fmt).join('\t')));
        eng.global.set('_jsshow', (img) => onFixed(toPixels(img)));
        const n = luaState.cur.shape[0];
        const prelude =
          `local N=${n}\n` +
          `local function _mk(t) local m={} local i=1 for y=1,N do local r={} for x=1,N do r[x]={t[i],t[i+1],t[i+2]} i=i+3 end m[y]=r end return m end\n` +
          `qr={n=N}\n` +
          `qr.current=_mk(${luaFlat(luaState.cur)})\n` +
          `qr.seen={${luaState.seen.map((s) => `_mk(${luaFlat(s)})`).join(',')}}\n` +
          `function print(...) _jsprint(...) end\n` +
          `function qr.show(im) _jsshow(im) end\n`;
        await eng.doString(prelude); // run separately so user code's lines start at 1
        await eng.doString(code);
        return { ok: true, output: buf.join('\n') };
      } catch (e) {
        buf.push(fmtLuaErr((e && e.message) || e));
        return { ok: false, output: buf.join('\n') };
      } finally {
        try { eng.global.close(); } catch {}
      }
    },
  };

  return { order: ['js', 'python', 'lua'], map: { js, python, lua } };
}

