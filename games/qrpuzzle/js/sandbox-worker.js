// Pyodide runs here, in a Web Worker, so loading it (WASM compile + numpy) never
// blocks the main thread — the UI (and tab switching) stays responsive while it
// downloads. Messages with the main thread:
//   in:  {type:'init'} | {type:'loadQR', cur, seen} | {type:'run', id, code}
//   out: {type:'progress', msg} | {type:'ready'} | {type:'initerror', msg}
//        {type:'show', json} | {type:'result', id, ok, output}
const PYODIDE_BASE = 'https://cdn.jsdelivr.net/pyodide/v0.27.2/full/';

let pyodide = null;
const outBuf = [];
const post = (type, data) => self.postMessage(Object.assign({ type }, data));

// Trim a Pyodide traceback to the player's own code: drop internal frames (any
// File that isn't the executed code) and the "File "<exec>", " noise.
function cleanTraceback(msg) {
  const lines = String(msg).split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].match(/^\s*File "([^"]*)", line/);
    if (f && f[1] !== '<exec>') {
      // skip this internal frame and its indented source line, if present
      if (i + 1 < lines.length && /^\s/.test(lines[i + 1]) && !/^\s*File "/.test(lines[i + 1])) i++;
      continue;
    }
    // drop Python 3.11+ caret/squiggle marker lines (only spaces, ^ and ~)
    if (/[\^~]/.test(lines[i]) && /^[\s\^~]+$/.test(lines[i])) continue;
    out.push(lines[i]);
  }
  return out.join('\n').replace(/File "<exec>", /g, '');
}

const BOOTSTRAP = `
import numpy as np, json

class QRHelper:
    """The QR currently being repaired, plus every earlier broken QR seen."""
    def __init__(self):
        self.current = None
        self.n = None
        self.seen = []          # all previous broken QRs, oldest first
        self._ids = set()
    def _mk(self, flat, shape):
        return np.array(flat, dtype=np.uint8).reshape(tuple(shape))
    def set_current(self, flat, shape):
        self.current = self._mk(flat, shape)
        self.n = int(shape[0])
    def push_seen(self, flat, shape, level_id):
        if level_id in self._ids:
            return
        self._ids.add(level_id)
        self.seen.append(self._mk(flat, shape))
    def reset(self):
        self.seen = []
        self._ids = set()
    def show(self, arr):
        """Render an array as the QR to scan. An (n, n, 3) array is drawn exactly
        as RGB (values 0-255) — so for a scannable QR use black (0,0,0) and white
        (255,255,255) modules. A 2D array is a shorthand: a 0/1 mask (1 = black)
        or a 0-255 grayscale image."""
        a = np.asarray(arr)
        if a.ndim == 3:
            img = np.clip(a[..., :3], 0, 255).astype(np.uint8)
        else:
            a = np.asarray(a, dtype=float)
            if a.size and a.max() <= 1:
                gray = np.where(a >= 0.5, 0, 255)      # 0/1 mask: 1 -> black
            else:
                gray = np.clip(a, 0, 255)              # grayscale image
            img = np.stack([gray, gray, gray], axis=-1).astype(np.uint8)
        _js_render_fixed(json.dumps(img.tolist()))

qr = QRHelper()
`;

async function init() {
  importScripts(PYODIDE_BASE + 'pyodide.js');
  post('progress', { msg: 'Loading Python runtime…' });
  pyodide = await self.loadPyodide({ indexURL: PYODIDE_BASE });
  pyodide.setStdout({ batched: (s) => outBuf.push(s) });
  pyodide.setStderr({ batched: (s) => outBuf.push(s) });
  post('progress', { msg: 'Loading numpy…' });
  await pyodide.loadPackage(['numpy']);
  pyodide.globals.set('_js_render_fixed', (jsonStr) => post('show', { json: jsonStr }));
  post('progress', { msg: 'Starting sandbox…' });
  pyodide.runPython(BOOTSTRAP);
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try { await init(); post('ready', {}); }
    catch (err) { post('initerror', { msg: String((err && err.message) || err) }); }
  } else if (m.type === 'loadQR') {
    pyodide.runPython('qr.reset()');
    m.seen.forEach((s, i) => {
      pyodide.globals.set('_flat', s.flat);
      pyodide.globals.set('_shape', s.shape);
      pyodide.runPython(`qr.push_seen(_flat, _shape, ${i})`);
    });
    pyodide.globals.set('_flat', m.cur.flat);
    pyodide.globals.set('_shape', m.cur.shape);
    pyodide.runPython('qr.set_current(_flat, _shape)');
  } else if (m.type === 'run') {
    outBuf.length = 0;
    try {
      pyodide.runPython(m.code);
      post('result', { id: m.id, ok: true, output: outBuf.join('\n') });
    } catch (err) {
      const tb = cleanTraceback((err && err.message) || err);
      post('result', { id: m.id, ok: false, output: (outBuf.join('\n') + '\n' + tb).trim() });
    }
  }
};
