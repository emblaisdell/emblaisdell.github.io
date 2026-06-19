// Canvas rendering for QR matrices. Modules are drawn 1:1 pixel-exact then the
// canvas is upscaled with crisp (pixelated) rendering, plus a white quiet zone
// so phones can actually scan the corrected codes.

const QUIET = 4; // modules of white border (QR spec minimum)

// Decode the level `display` descriptor into either a bw matrix or rgb pixels.
export function decodeDisplay(display) {
  const n = display.n;
  if (display.mode === 'bw') {
    const bits = display.rows.map((r) => Array.from(r, (c) => (c === '1' ? 1 : 0)));
    return { mode: 'bw', n, bits };
  }
  // rgb: base64 -> Uint8Array length n*n*3
  const bin = atob(display.rgb);
  const rgb = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) rgb[i] = bin.charCodeAt(i);
  return { mode: 'rgb', n, rgb };
}

function fit(canvas, n, scale) {
  const px = (n + QUIET * 2) * scale;
  canvas.width = px;
  canvas.height = px;
  canvas.style.width = Math.min(px, 320) + 'px';
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, px, px);
  return ctx;
}

// Render a decoded display ({mode,n,bits|rgb}) to a canvas.
export function renderDisplay(canvas, decoded, scale = 8) {
  const { n } = decoded;
  const ctx = fit(canvas, n, scale);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const px = (x + QUIET) * scale;
      const py = (y + QUIET) * scale;
      if (decoded.mode === 'bw') {
        ctx.fillStyle = decoded.bits[y][x] ? '#000000' : '#ffffff';
      } else {
        const i = (y * n + x) * 3;
        ctx.fillStyle = `rgb(${decoded.rgb[i]},${decoded.rgb[i + 1]},${decoded.rgb[i + 2]})`;
      }
      ctx.fillRect(px, py, scale, scale);
    }
}

// Render an (n, n, 3) RGB matrix produced by qr.show() in the sandbox, exactly
// as given (no thresholding).
export function renderFixed(canvas, pixels, scale = 8) {
  const n = pixels.length;
  const ctx = fit(canvas, n, scale);
  for (let y = 0; y < n; y++) {
    const row = pixels[y] || [];
    for (let x = 0; x < row.length; x++) {
      const [r, g, b] = row[x];
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect((x + QUIET) * scale, (y + QUIET) * scale, scale, scale);
    }
  }
}

// Flat {data:Uint8Array, shape:[n,n,3]} for handing a display to Python. Always
// RGB 0-255 — black/white levels become (0,0,0)/(255,255,255) so player code can
// rely on a single uniform shape.
export function displayToImage(decoded) {
  const { n } = decoded;
  if (decoded.mode === 'bw') {
    const data = new Uint8Array(n * n * 3);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const v = decoded.bits[y][x] ? 0 : 255; // dark=black, light=white
        const i = (y * n + x) * 3;
        data[i] = data[i + 1] = data[i + 2] = v;
      }
    return { data, shape: [n, n, 3] };
  }
  return { data: decoded.rgb, shape: [n, n, 3] };
}
