// A self-contained QR encoder (model 2, byte mode, versions 1–15).
//
// Written by hand rather than pulled from npm because the client has no build
// step and no node_modules, and because a projector QR must work when the venue
// wifi does not — an external image service would be a single point of failure
// at exactly the wrong moment.
//
// The two tables below are *generated* from segno, not transcribed: the
// error-correction block layout is where hand-written QR encoders usually go
// wrong, and a wrong row produces a code that looks fine and scans as garbage.
// The whole encoder is verified matrix-for-matrix against segno across every
// mask and error level by scripts/verify-qr.mjs.
//
// Versions 1–15 hold ~500 bytes at level M — far more than any URL needs.

/* ---- generated tables --------------------------------------------------- */

// Format: [ecCodewordsPerBlock, [[numBlocks, dataCodewordsPerBlock], ...]]
const ECC_TABLE = {
  L: {
    1: [7, [[1, 19]]],
    2: [10, [[1, 34]]],
    3: [15, [[1, 55]]],
    4: [20, [[1, 80]]],
    5: [26, [[1, 108]]],
    6: [18, [[2, 68]]],
    7: [20, [[2, 78]]],
    8: [24, [[2, 97]]],
    9: [30, [[2, 116]]],
    10: [18, [[2, 68], [2, 69]]],
    11: [20, [[4, 81]]],
    12: [24, [[2, 92], [2, 93]]],
    13: [26, [[4, 107]]],
    14: [30, [[3, 115], [1, 116]]],
    15: [22, [[5, 87], [1, 88]]],
  },
  M: {
    1: [10, [[1, 16]]],
    2: [16, [[1, 28]]],
    3: [26, [[1, 44]]],
    4: [18, [[2, 32]]],
    5: [24, [[2, 43]]],
    6: [16, [[4, 27]]],
    7: [18, [[4, 31]]],
    8: [22, [[2, 38], [2, 39]]],
    9: [22, [[3, 36], [2, 37]]],
    10: [26, [[4, 43], [1, 44]]],
    11: [30, [[1, 50], [4, 51]]],
    12: [22, [[6, 36], [2, 37]]],
    13: [22, [[8, 37], [1, 38]]],
    14: [24, [[4, 40], [5, 41]]],
    15: [24, [[5, 41], [5, 42]]],
  },
  Q: {
    1: [13, [[1, 13]]],
    2: [22, [[1, 22]]],
    3: [18, [[2, 17]]],
    4: [26, [[2, 24]]],
    5: [18, [[2, 15], [2, 16]]],
    6: [24, [[4, 19]]],
    7: [18, [[2, 14], [4, 15]]],
    8: [22, [[4, 18], [2, 19]]],
    9: [20, [[4, 16], [4, 17]]],
    10: [24, [[6, 19], [2, 20]]],
    11: [28, [[4, 22], [4, 23]]],
    12: [26, [[4, 20], [6, 21]]],
    13: [24, [[8, 20], [4, 21]]],
    14: [20, [[11, 16], [5, 17]]],
    15: [30, [[5, 24], [7, 25]]],
  },
  H: {
    1: [17, [[1, 9]]],
    2: [28, [[1, 16]]],
    3: [22, [[2, 13]]],
    4: [16, [[4, 9]]],
    5: [22, [[2, 11], [2, 12]]],
    6: [28, [[4, 15]]],
    7: [26, [[4, 13], [1, 14]]],
    8: [26, [[4, 14], [2, 15]]],
    9: [24, [[4, 12], [4, 13]]],
    10: [28, [[6, 15], [2, 16]]],
    11: [24, [[3, 12], [8, 13]]],
    12: [28, [[7, 14], [4, 15]]],
    13: [22, [[12, 11], [4, 12]]],
    14: [24, [[11, 12], [5, 13]]],
    15: [24, [[11, 12], [7, 13]]],
  },
};

const ALIGN = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
  11: [6, 30, 54],
  12: [6, 32, 58],
  13: [6, 34, 62],
  14: [6, 26, 46, 66],
  15: [6, 26, 48, 70],
};

const ECC_BITS = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

/* ---- GF(256) ------------------------------------------------------------ */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // primitive polynomial for QR
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function genPoly(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= mul(g[j], EXP[i]);
    }
    g = next;
  }
  return g;
}

/** Reed-Solomon remainder: the error-correction codewords for one block. */
function rsEncode(data, ecLen) {
  const gen = genPoly(ecLen);
  const buf = new Uint8Array(data.length + ecLen);
  buf.set(data);
  for (let i = 0; i < data.length; i++) {
    const coef = buf[i];
    if (!coef) continue;
    for (let j = 0; j < gen.length; j++) buf[i + j] ^= mul(gen[j], coef);
  }
  return buf.slice(data.length);
}

/* ---- data encoding ------------------------------------------------------ */

const totalDataCodewords = (ecc, version) =>
  ECC_TABLE[ecc][version][1].reduce((sum, [blocks, data]) => sum + blocks * data, 0);

function pickVersion(byteLen, ecc, minVersion) {
  for (let v = Math.max(1, minVersion); v <= 15; v++) {
    const countBits = v <= 9 ? 8 : 16;
    const needed = 4 + countBits + byteLen * 8;
    if (needed <= totalDataCodewords(ecc, v) * 8) return v;
  }
  throw new Error(`content too long for QR versions 1-15 (${byteLen} bytes at level ${ecc})`);
}

function buildCodewords(bytes, ecc, version, quirkPad = false) {
  const capacity = totalDataCodewords(ecc, version);
  const bits = [];
  const push = (value, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);

  // Terminator, then pad to a whole codeword, then the standard pad bytes.
  for (let i = 0; i < 4 && bits.length < capacity * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  // ISO/IEC 18004 7.4.10 adds padding bits only "if the bit stream ... does not
  // end at a codeword boundary". segno computes `8 - length % 8`, which yields 8
  // when already aligned and so emits one spurious 0x00 codeword. Both scan
  // (decoders stop after the declared length), but ours is the canonical form.
  // scripts/verify-qr.mjs sets this flag to reproduce segno bit-for-bit, which
  // is what lets the rest of the encoder be diffed against it exactly.
  if (quirkPad) for (let i = 0; i < 8; i++) bits.push(0);
  const data = new Uint8Array(capacity);
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    data[i / 8] = byte;
  }
  for (let i = bits.length / 8; i < capacity; i++) {
    data[i] = (i - bits.length / 8) % 2 === 0 ? 0xec : 0x11;
  }

  // Split into blocks, RS each, then interleave data-then-ec as the spec requires.
  const [ecLen, groups] = ECC_TABLE[ecc][version];
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (const [numBlocks, blockLen] of groups) {
    for (let b = 0; b < numBlocks; b++) {
      const block = data.slice(offset, offset + blockLen);
      offset += blockLen;
      dataBlocks.push(block);
      ecBlocks.push(rsEncode(block, ecLen));
    }
  }

  const out = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ecLen; i++) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return out;
}

/* ---- matrix ------------------------------------------------------------- */

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function bch(value, poly, bitLen) {
  let v = value << (bitLen - 1);
  const top = 1 << (bitLen + (poly === 0x537 ? 4 : 5));
  void top;
  const polyBits = poly === 0x537 ? 10 : 12;
  v = value << polyBits;
  let rem = v;
  const degree = poly === 0x537 ? 15 : 18;
  for (let i = degree - 1; i >= polyBits; i--) {
    if (rem & (1 << i)) rem ^= poly << (i - polyBits);
  }
  return v | rem;
}

function buildMatrix(codewords, ecc, version, forcedMask) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Int8Array(size).fill(-1)); // -1 = free

  const setFn = (r, c, v) => {
    if (r >= 0 && r < size && c >= 0 && c < size) modules[r][c] = v ? 2 : 3; // 2/3 = function dark/light
  };

  // Finder patterns + separators.
  for (const [br, bc] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inRing = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const dark = inRing && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        setFn(br + r, bc + c, dark);
      }
    }
  }

  // Alignment patterns, skipping the three finder corners.
  const centers = ALIGN[version];
  for (const r of centers) {
    for (const c of centers) {
      const nearFinder =
        (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
      if (nearFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          setFn(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }

  // Dark module + reserved format areas.
  setFn(size - 8, 8, true);
  for (let i = 0; i < 9; i++) {
    if (modules[8][i] === -1) setFn(8, i, false);
    if (modules[i][8] === -1) setFn(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (modules[8][size - 1 - i] === -1) setFn(8, size - 1 - i, false);
    if (modules[size - 1 - i][8] === -1) setFn(size - 1 - i, 8, false);
  }
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const r = Math.floor(i / 3);
      const c = size - 11 + (i % 3);
      setFn(r, c, false);
      setFn(c, r, false);
    }
  }

  // Data placement: two-column zigzag from the bottom-right, skipping column 6.
  let bit = 0;
  const totalBits = codewords.length * 8;
  const nextBit = () => {
    if (bit >= totalBits) return 0; // remainder bits are zero
    const b = (codewords[bit >> 3] >> (7 - (bit & 7))) & 1;
    bit++;
    return b;
  };
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5; // the vertical timing column is not a data column
    for (let i = 0; i < size; i++) {
      const r = upward ? size - 1 - i : i;
      for (const c of [right, right - 1]) {
        if (modules[r][c] !== -1) continue;
        modules[r][c] = nextBit();
      }
    }
    upward = !upward;
  }

  // Mask selection.
  const isFn = (v) => v === 2 || v === 3;
  const candidates = forcedMask == null ? [0, 1, 2, 3, 4, 5, 6, 7] : [forcedMask];
  let best = null;
  for (const m of candidates) {
    const grid = modules.map((row, r) =>
      Array.from(row, (v, c) => (isFn(v) ? v === 2 : !!v !== !!MASKS[m](r, c) ? true : false)),
    );
    // Recompute properly: data modules XOR the mask, function modules pass through.
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const v = modules[r][c];
        grid[r][c] = isFn(v) ? v === 2 : (v === 1) !== MASKS[m](r, c) ? true : false;
      }
    }
    writeFormat(grid, ecc, m, size, version);
    const score = penalty(grid, size);
    if (!best || score < best.score) best = { score, grid, mask: m };
  }
  return { size, modules: best.grid, version, mask: best.mask };
}

function writeFormat(grid, ecc, mask, size, version) {
  const fmt = bch((ECC_BITS[ecc] << 3) | mask, 0x537, 5) ^ 0x5412;
  for (let i = 0; i < 15; i++) {
    const bitVal = ((fmt >> i) & 1) === 1;
    // Copy 1, around the top-left finder.
    if (i < 6) grid[i][8] = bitVal;
    else if (i === 6) grid[7][8] = bitVal;
    else if (i === 7) grid[8][8] = bitVal;
    else if (i === 8) grid[8][7] = bitVal;
    else grid[8][14 - i] = bitVal;
    // Copy 2, split across the other two finders.
    if (i < 8) grid[8][size - 1 - i] = bitVal;
    else grid[size - 15 + i][8] = bitVal;
  }
  grid[size - 8][8] = true; // dark module

  if (version >= 7) {
    const vinfo = bch(version, 0x1f25, 6);
    for (let i = 0; i < 18; i++) {
      const bitVal = ((vinfo >> i) & 1) === 1;
      const r = Math.floor(i / 3);
      const c = size - 11 + (i % 3);
      grid[r][c] = bitVal;
      grid[c][r] = bitVal;
    }
  }
}

function penalty(grid, size) {
  let score = 0;

  // Rule 1: runs of five or more same-coloured modules.
  for (let i = 0; i < size; i++) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        const a = horizontal ? grid[i][j] : grid[j][i];
        const b = horizontal ? grid[i][j - 1] : grid[j - 1][i];
        if (a === b) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
  }

  // Rule 2: 2x2 blocks of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = grid[r][c];
      if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) score += 3;
    }
  }

  // Rule 3: finder-like 1:1:3:1:1 patterns with four light modules on one side.
  const P1 = [true, false, true, true, true, false, true, false, false, false, false];
  const P2 = [false, false, false, false, true, false, true, true, true, false, true];
  const matches = (get, start) =>
    [P1, P2].some((pat) => pat.every((want, k) => get(start + k) === want));
  for (let i = 0; i < size; i++) {
    for (let j = 0; j + 11 <= size; j++) {
      if (matches((k) => grid[i][k], j)) score += 40;
      if (matches((k) => grid[k][i], j)) score += 40;
    }
  }

  // Rule 4: deviation from a 50% dark ratio.
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (grid[r][c]) dark++;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/* ---- public API --------------------------------------------------------- */

/**
 * Non-ASCII input is encoded as UTF-8. ISO/IEC 18004 nominally defaults byte
 * mode to ISO-8859-1, but every modern decoder assumes UTF-8, and URLs should
 * be percent-encoded anyway. This is the encoder's only deliberate deviation
 * besides the padding note above.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {"L"|"M"|"Q"|"H"} [opts.ecc="M"]
 * @param {number} [opts.minVersion=1]
 * @param {number} [opts.mask] force a mask (verification only)
 * @returns {{size:number, modules:boolean[][], version:number, mask:number}}
 */
export function qrMatrix(text, { ecc = "M", minVersion = 1, mask, quirkPad = false } = {}) {
  const bytes = new TextEncoder().encode(text);
  const version = pickVersion(bytes.length, ecc, minVersion);
  const codewords = buildCodewords(bytes, ecc, version, quirkPad);
  return buildMatrix(codewords, ecc, version, mask);
}

/** Render as a standalone SVG string. Crisp at any projector size. */
export function qrSvg(text, { ecc = "M", quiet = 4, dark = "#0d0a1e", light = "#ffffff", minVersion = 1 } = {}) {
  const { size, modules } = qrMatrix(text, { ecc, minVersion });
  const dim = size + quiet * 2;
  let path = "";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img" aria-label="QR code">`
    + `<rect width="${dim}" height="${dim}" fill="${light}"/>`
    + `<path d="${path}" fill="${dark}"/></svg>`;
}
