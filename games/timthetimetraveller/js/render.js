// Canvas rendering for the game. Everything is drawn in cell units scaled by
// CELL, offset by the camera.

import { CELL, COLORS, T, DIRS, VORTEX_R, TIM_W, TIM_H, WIN_ENERGY, TT_WARMUP, DELAY_TIME, key } from './constants.js';

export class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.cam = { x: 0, y: 0 };
    this.t = 0;
    this.dpr = 1;
    this.vw = canvas.width; this.vh = canvas.height;  // logical (CSS px) size
    this.isTouch = false;   // set by main.js; picks the restart prompt wording
    this.alpha = 1;         // interpolation fraction between prev/current sim step
  }

  // Size the backing store to the device's pixel ratio so it stays crisp on
  // high-DPI screens (retina / most phones), while pinning the CSS size in px so
  // the browser can't stretch the canvas (e.g. Safari's 100vh vs visible-area
  // mismatch). All drawing then happens in logical CSS pixels (this.vw/this.vh),
  // with the context pre-scaled by dpr each frame.
  resize(w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.vw = w; this.vh = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  // Convert cell coords to screen px.
  sx(x) { return (x - this.cam.x) * CELL; }
  sy(y) { return (y - this.cam.y) * CELL; }

  // Where the camera wants to be to centre the focused Tim (unbounded world, so
  // no clamping). Null if there's no Tim yet.
  cameraTarget() {
    const f = this.world.focused;
    if (!f) return null;
    // Follow the interpolated position so the camera tracks Tim's smooth
    // rendered motion, not the quantized sim position. Fall back to the current
    // position if there's no previous snapshot yet (never produce NaN).
    const a = this.alpha;
    const ppx = f.px ?? f.x, ppy = f.py ?? f.y;
    const fx = ppx + (f.x - ppx) * a;
    const fy = ppy + (f.y - ppy) * a;
    return {
      x: fx + TIM_W / 2 - this.vw / 2 / CELL,
      y: fy + TIM_H / 2 - this.vh / 2 / CELL,
    };
  }

  // Jump straight to the target -- used at game start / restart so the view
  // opens already centred on Tim instead of sliding over from the origin.
  snapCamera() {
    const t = this.cameraTarget();
    if (t) { this.cam.x = t.x; this.cam.y = t.y; }
  }

  updateCamera() {
    const t = this.cameraTarget();
    if (!t) return;
    // Smooth follow.
    this.cam.x += (t.x - this.cam.x) * 0.15;
    this.cam.y += (t.y - this.cam.y) * 0.15;
  }

  draw(dt) {
    this.t += dt;
    this.dt = dt;
    // End-of-life clock: drives the topple animation and the end-screen fade-in
    // (the world sim is frozen once the round ends, so we time these on render).
    this.endT = this.world.status !== 'play' ? (this.endT || 0) + dt : 0;
    this.updateCamera();
    const ctx = this.ctx, w = this.world;
    // Reset to a dpr-scaled transform so everything below is drawn in CSS px.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Background gradient.
    const g = ctx.createLinearGradient(0, 0, 0, this.vh);
    g.addColorStop(0, COLORS.bg1);
    g.addColorStop(1, COLORS.bg0);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.vw, this.vh);
    this.drawGridLines();

    // Visible cell range. Stored so the vortex/piston passes can cull too --
    // the world is unbounded and can hold hundreds of entities, but only the
    // handful on screen are worth drawing.
    const x0 = Math.floor(this.cam.x) - 1, x1 = Math.ceil(this.cam.x + this.vw / CELL) + 1;
    const y0 = Math.floor(this.cam.y) - 1, y1 = Math.ceil(this.cam.y + this.vh / CELL) + 1;
    this.view = { x0, y0, x1, y1 };
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const c = w.grid.get(key(x, y));
        if (c) this.drawCell(c);
      }
    }
    this.drawPistons();
    this.drawVortices();
    if (w.blueVortex) this.drawBlue(w.blueVortex);
    this.drawTims();
    this.drawParticles();
    this.drawHUD();
    this.drawInfoMessage();
  }

  drawGridLines() {
    const ctx = this.ctx;
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    const startX = -((this.cam.x % 1) * CELL);
    const startY = -((this.cam.y % 1) * CELL);
    ctx.beginPath();
    for (let x = startX; x < this.vw; x += CELL) { ctx.moveTo(x, 0); ctx.lineTo(x, this.vh); }
    for (let y = startY; y < this.vh; y += CELL) { ctx.moveTo(0, y); ctx.lineTo(this.vw, y); }
    ctx.stroke();
  }

  drawCell(c) {
    const ctx = this.ctx;
    const px = this.sx(c.x), py = this.sy(c.y), s = CELL;
    switch (c.t) {
      case T.WALL: this.drawWall(px, py, s, c.variant); break;
      case T.WIRE: this.drawWire(px, py, s, c); break;
      case T.BUTTON: this.drawButton(px, py, s, c); break;
      case T.NOT: this.drawNot(px, py, s, c); break;
      case T.DELAY: this.drawDelay(px, py, s, c); break;
      case T.COIN: this.drawCoin(px, py, s, c); break;
      case T.INFO: this.drawInfo(px, py, s, c); break;
      case T.TEMPLE: this.drawTemple(px, py, s, c.variant); break;
      case T.TABLE: this.drawTable(px, py, s); break;
      case T.LIGHT: this.drawLight(px, py, s); break;
      case T.TORCH: this.drawTorch(px, py, s); break;
      // pistons drawn separately so the head overlays neighbours
    }
  }

  drawWall(px, py, s, variant = 0) {
    const ctx = this.ctx;
    if (variant === 2) { this.drawCaution(px, py, s); return; }
    ctx.fillStyle = COLORS.wall;
    ctx.fillRect(px, py, s, s);
    ctx.fillStyle = COLORS.wallEdge;
    ctx.fillRect(px, py, s, 3);
    ctx.fillRect(px, py, 3, s);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
    if (variant === 1) { // bolted plate
      ctx.fillStyle = COLORS.wallBolt;
      const r = 2;
      for (const [bx, by] of [[5, 5], [s - 5, 5], [5, s - 5], [s - 5, s - 5]]) {
        ctx.beginPath(); ctx.arc(px + bx, py + by, r, 0, 7); ctx.fill();
      }
    }
  }

  // Yellow/black diagonal caution stripes, clipped to the cell. The stripes are
  // anchored to WORLD space (not the cell), so a block of caution tiles lines up
  // into one continuous hazard pattern with no zigzag at the seams.
  drawCaution(px, py, s) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath(); ctx.rect(px, py, s, s); ctx.clip();
    ctx.fillStyle = COLORS.caution;
    ctx.fillRect(px, py, s, s);
    ctx.fillStyle = COLORS.cautionDark;
    const bw = Math.max(6, s * 0.28), P = bw * 2;
    // Each stripe is a band of constant (screen x+y). `base` is the screen x+y
    // of the world's diagonal origin, so the band lattice is shared by every
    // cell in the frame regardless of where it sits.
    const base = -(this.cam.x + this.cam.y) * CELL;
    const k0 = Math.floor((px + py - base) / P) - 1;
    const k1 = Math.ceil((px + py + 2 * s - base) / P) + 1;
    for (let k = k0; k <= k1; k++) {
      const xTop = base + k * P - py;        // x on the top edge for this band
      ctx.beginPath();
      ctx.moveTo(xTop, py);
      ctx.lineTo(xTop + bw, py);
      ctx.lineTo(xTop + bw - s, py + s);
      ctx.lineTo(xTop - s, py + s);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
  }

  // Ancient-temple stone block. variant 0 brick, 1 hieroglyph, 2 cracked.
  drawTemple(px, py, s, variant = 0) {
    const ctx = this.ctx;
    ctx.fillStyle = COLORS.temple;
    ctx.fillRect(px, py, s, s);
    ctx.fillStyle = COLORS.templeHi; ctx.fillRect(px, py, s, 2);
    ctx.fillStyle = COLORS.templeDark; ctx.fillRect(px, py + s - 3, s, 3);
    ctx.strokeStyle = COLORS.templeLine;
    ctx.lineWidth = 1.5;
    if (variant === 1) {
      // A carved Maya glyph: a rounded cartouche framing bar-and-dot numerals
      // (the unmistakable Maya counting marks) above a small 'U' infix.
      const cx = px + s / 2;
      this.roundRect(px + 4, py + 4, s - 8, s - 8, 5); ctx.stroke(); // cartouche
      ctx.fillStyle = COLORS.glyph;
      ctx.strokeStyle = COLORS.glyph;
      ctx.lineWidth = 2;
      const dotR = Math.max(1.6, s * 0.06);
      ctx.beginPath(); ctx.arc(cx - s * 0.12, py + s * 0.30, dotR, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + s * 0.12, py + s * 0.30, dotR, 0, 7); ctx.fill();
      ctx.fillRect(cx - s * 0.20, py + s * 0.45, s * 0.40, Math.max(2, s * 0.09)); // bar = 5
      ctx.beginPath();
      ctx.arc(cx, py + s * 0.66, s * 0.15, 0.12 * Math.PI, 0.88 * Math.PI);        // 'U' infix
      ctx.stroke();
    } else if (variant === 2) {
      // cracked stone
      ctx.beginPath();
      ctx.moveTo(px + s * 0.2, py); ctx.lineTo(px + s * 0.35, py + s * 0.4);
      ctx.lineTo(px + s * 0.25, py + s * 0.7); ctx.lineTo(px + s * 0.4, py + s);
      ctx.moveTo(px + s * 0.7, py + s * 0.1); ctx.lineTo(px + s * 0.6, py + s * 0.5);
      ctx.lineTo(px + s * 0.8, py + s * 0.8);
      ctx.stroke();
    } else {
      // brick courses
      ctx.beginPath();
      ctx.moveTo(px, py + s / 2); ctx.lineTo(px + s, py + s / 2);
      ctx.moveTo(px + s / 2, py); ctx.lineTo(px + s / 2, py + s / 2);
      ctx.moveTo(px + s / 4, py + s / 2); ctx.lineTo(px + s / 4, py + s);
      ctx.moveTo(px + 3 * s / 4, py + s / 2); ctx.lineTo(px + 3 * s / 4, py + s);
      ctx.stroke();
    }
  }

  // A lab table: solid; stand on the top.
  drawTable(px, py, s) {
    const ctx = this.ctx;
    ctx.fillStyle = COLORS.tableLeg;
    ctx.fillRect(px + 3, py + s * 0.35, 4, s * 0.65);
    ctx.fillRect(px + s - 7, py + s * 0.35, 4, s * 0.65);
    ctx.fillStyle = COLORS.tableTop;
    ctx.fillRect(px + 1, py + s * 0.28, s - 2, s * 0.14);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(px + 1, py + s * 0.28, s - 2, 2);
  }

  // A ceiling lamp with a soft glow (decorative, non-solid).
  drawLight(px, py, s) {
    const ctx = this.ctx;
    const cx = px + s / 2, flick = 0.85 + 0.15 * Math.sin(this.t * 9 + px);
    // glow
    const grd = ctx.createRadialGradient(cx, py + s * 0.3, 2, cx, py + s * 0.3, s * 1.1);
    grd.addColorStop(0, `rgba(255,236,150,${0.5 * flick})`);
    grd.addColorStop(1, 'rgba(255,236,150,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(px - s * 0.5, py, s * 2, s * 1.4);
    // fixture
    ctx.fillStyle = COLORS.metalDark;
    ctx.fillRect(px + s * 0.2, py + 2, s * 0.6, 5);
    // bulb
    ctx.fillStyle = COLORS.lamp;
    ctx.beginPath(); ctx.ellipse(cx, py + s * 0.28, s * 0.22, s * 0.16, 0, 0, 7); ctx.fill();
  }

  // A wall torch with a flickering flame (decorative, non-solid).
  drawTorch(px, py, s) {
    const ctx = this.ctx;
    const cx = px + s / 2;
    // bracket + handle
    ctx.fillStyle = COLORS.torchWood;
    ctx.fillRect(cx - 2, py + s * 0.45, 4, s * 0.4);
    ctx.fillStyle = COLORS.metalDark;
    ctx.fillRect(cx - 6, py + s * 0.45, 12, 4);
    // glow
    const flick = 0.8 + 0.2 * Math.sin(this.t * 14 + px);
    const grd = ctx.createRadialGradient(cx, py + s * 0.3, 1, cx, py + s * 0.3, s * 0.9 * flick);
    grd.addColorStop(0, 'rgba(255,170,80,0.45)');
    grd.addColorStop(1, 'rgba(255,170,80,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(px - s * 0.4, py - s * 0.2, s * 1.8, s);
    // flame (two flickering lobes)
    const h = s * (0.34 + 0.06 * Math.sin(this.t * 17 + px));
    ctx.fillStyle = COLORS.flameHot;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.12, py + s * 0.46);
    ctx.quadraticCurveTo(cx - s * 0.16, py + s * 0.46 - h * 0.6, cx, py + s * 0.46 - h);
    ctx.quadraticCurveTo(cx + s * 0.16, py + s * 0.46 - h * 0.6, cx + s * 0.12, py + s * 0.46);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = COLORS.flame;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.07, py + s * 0.46);
    ctx.quadraticCurveTo(cx - s * 0.09, py + s * 0.46 - h * 0.5, cx, py + s * 0.46 - h * 0.7);
    ctx.quadraticCurveTo(cx + s * 0.09, py + s * 0.46 - h * 0.5, cx + s * 0.07, py + s * 0.46);
    ctx.closePath(); ctx.fill();
  }

  // Wires read as solid bare-metal blocks; only the live animation overlays.
  drawWire(px, py, s, c) {
    const ctx = this.ctx;
    const live = c.powered;
    const m = s / 2;
    // bare metal plate with a bevel.
    ctx.fillStyle = COLORS.metal;
    ctx.fillRect(px, py, s, s);
    ctx.fillStyle = COLORS.metalLight;            // top/left highlight
    ctx.fillRect(px, py, s, 3); ctx.fillRect(px, py, 3, s);
    ctx.fillStyle = COLORS.metalDark;             // bottom/right shadow
    ctx.fillRect(px, py + s - 3, s, 3); ctx.fillRect(px + s - 3, py, 3, s);
    // brushed-metal striations
    ctx.strokeStyle = 'rgba(0,0,0,0.07)';
    ctx.lineWidth = 1;
    for (let yy = 7; yy < s - 4; yy += 6) {
      ctx.beginPath(); ctx.moveTo(px + 4, py + yy); ctx.lineTo(px + s - 4, py + yy); ctx.stroke();
    }
    // corner rivets
    ctx.fillStyle = COLORS.rivet;
    for (const [bx, by] of [[5, 5], [s - 5, 5], [5, s - 5], [s - 5, s - 5]]) {
      ctx.beginPath(); ctx.arc(px + bx, py + by, 1.7, 0, 7); ctx.fill();
    }

    if (live) {
      ctx.save();
      ctx.globalAlpha = 0.4 + 0.28 * Math.sin(this.t * 20 + px);
      ctx.fillStyle = COLORS.wireLive;
      ctx.fillRect(px, py, s, s);
      ctx.restore();
      this.drawArc(px + m, py + m, s);
    }
  }

  drawArc(cx, cy, s) {
    const ctx = this.ctx;
    ctx.strokeStyle = COLORS.spark;
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.8;
    const n = 3;
    for (let i = 0; i < n; i++) {
      const a = (this.t * 9 + i * 2.1) % (Math.PI * 2);
      const len = s * 0.4;
      ctx.beginPath();
      let x = cx, y = cy;
      ctx.moveTo(x, y);
      for (let k = 0; k < 3; k++) {
        x += Math.cos(a) * len / 3 + (Math.sin(this.t * 30 + k * 7 + i) * 3);
        y += Math.sin(a) * len / 3 + (Math.cos(this.t * 25 + k * 5 + i) * 3);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Buttons are walk-through; only a low housing + cap is drawn at the very
  // bottom of the cell (it rests on the wire/floor below).
  drawButton(px, py, s, c) {
    const ctx = this.ctx;
    const pressed = this.world.pressedNow?.has?.(c.x + ',' + c.y);
    // mounting feet / housing on the floor
    ctx.fillStyle = COLORS.metalDark;
    ctx.fillRect(px + 3, py + s - 5, s - 6, 5);
    ctx.fillRect(px + 3, py + s - 9, 3, 5);
    ctx.fillRect(px + s - 6, py + s - 9, 3, 5);
    // the cap (depresses when pressed)
    const capH = pressed ? 4 : 9;
    const capY = py + s - 5 - capH;
    ctx.fillStyle = pressed ? COLORS.buttonDown : COLORS.button;
    this.roundRect(px + 5, capY, s - 10, capH, 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(px + 6, capY + 1, s - 12, 1.5);
  }

  // Bare-metal block with a simple bevel, shared by wires/pistons.
  metalBlock(px, py, s, base, light, dark, inset = 0) {
    const ctx = this.ctx;
    const x = px + inset, y = py + inset, w = s - inset * 2;
    ctx.fillStyle = base; ctx.fillRect(x, y, w, w);
    ctx.fillStyle = light; ctx.fillRect(x, y, w, 3); ctx.fillRect(x, y, 3, w);
    ctx.fillStyle = dark; ctx.fillRect(x, y + w - 3, w, 3); ctx.fillRect(x + w - 3, y, 3, w);
  }

  drawPistons() {
    const ctx = this.ctx, s = CELL;
    for (const p of this.world.circuit.pistons) {
      // Margin 2 covers the extended head reaching into a neighbouring cell.
      if (!this.inView(p.x, p.y, 2)) continue;
      const px = this.sx(p.x), py = this.sy(p.y);
      const cx = px + s / 2, cy = py + s / 2;
      // Smoothly animate extension 0..1 toward the on/off target.
      const target = p.on ? 1 : 0;
      p.extAnim = p.extAnim ?? target;
      p.extAnim += (target - p.extAnim) * Math.min(1, (this.dt || 0.016) * 16);
      const e = p.extAnim;
      const ang = Math.atan2(DIRS[p.dir][1], DIRS[p.dir][0]);

      // Body housing.
      this.metalBlock(px, py, s, COLORS.piston, '#c6cdda', COLORS.metalDark, 2);
      // Rod + head, drawn in piston-local space (out = +x).
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      const face = s * 0.5;                 // body face along the out axis
      const headOuter = face + e * s;        // leading edge of the head
      // dark mouth the rod emerges from
      ctx.fillStyle = '#1b1f2b';
      ctx.fillRect(face - 3, -s * 0.28, 4, s * 0.56);
      // rod
      ctx.fillStyle = '#7e8aa0';
      ctx.fillRect(face, -s * 0.16, Math.max(0, headOuter - face - s * 0.18), s * 0.32);
      ctx.fillStyle = '#9aa3b5';
      ctx.fillRect(face, -s * 0.16, Math.max(0, headOuter - face - s * 0.18), 2);
      // head plate (the pusher / platform)
      ctx.fillStyle = COLORS.pistonHead;
      this.roundRectXY(headOuter - s * 0.2, -s * 0.42, s * 0.2, s * 0.84, 2);
      ctx.fill();
      ctx.fillStyle = COLORS.pistonHeadHi;
      ctx.fillRect(headOuter - s * 0.2, -s * 0.42, s * 0.06, s * 0.84);
      ctx.restore();
    }
  }

  // roundRect that fills a path (caller fills); used inside transformed space.
  roundRectXY(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Coin/dice random source: a die that, when its roll came up "active", lights
  // its pips and bleeds power into adjacent wires. Inactive dice read as dark.
  drawCoin(px, py, s, c) {
    const ctx = this.ctx;
    const on = !!c.active;
    // metal housing
    this.metalBlock(px, py, s, COLORS.piston, '#c6cdda', COLORS.metalDark, 2);
    // die face
    const m = s * 0.16, fx = px + m, fy = py + m, fw = s - m * 2;
    ctx.fillStyle = on ? COLORS.coinFace : COLORS.coinOff;
    this.roundRect(fx, fy, fw, fw, 4); ctx.fill();
    ctx.strokeStyle = on ? COLORS.coin : '#2c3142'; ctx.lineWidth = 1.5;
    this.roundRect(fx, fy, fw, fw, 4); ctx.stroke();
    // five pips (a die "5"): corners + centre
    ctx.fillStyle = on ? COLORS.coinPip : '#2c3344';
    const a = fx + fw * 0.27, b = fx + fw * 0.5, d = fx + fw * 0.73;
    const e = fy + fw * 0.27, g = fy + fw * 0.5, h = fy + fw * 0.73;
    const pip = fw * 0.085;
    for (const [qx, qy] of [[a, e], [d, e], [b, g], [a, h], [d, h]]) {
      ctx.beginPath(); ctx.arc(qx, qy, pip, 0, 7); ctx.fill();
    }
    // active glow overlay
    if (on) {
      ctx.save();
      ctx.globalAlpha = 0.30 + 0.18 * Math.sin(this.t * 6 + px);
      ctx.fillStyle = COLORS.coinLive;
      this.roundRect(fx, fy, fw, fw, 4); ctx.fill();
      ctx.restore();
    }
  }

  // A wall-mounted info terminal (walk-through). Tim touching it raises the
  // message box drawn by drawInfoMessage().
  drawInfo(px, py, s, c) {
    const ctx = this.ctx;
    const touched = this.world.activeInfo && this.world.activeInfo === c.text;
    // frame
    ctx.fillStyle = COLORS.infoFrame;
    this.roundRect(px + 3, py + 3, s - 6, s - 6, 4); ctx.fill();
    // screen
    const lit = 0.7 + 0.3 * Math.sin(this.t * 4 + px);
    ctx.fillStyle = touched ? COLORS.infoScreen
                            : `rgba(57,192,230,${0.35 + 0.25 * lit})`;
    ctx.fillRect(px + 7, py + 7, s - 14, s - 16);
    // a glowing "i"
    ctx.fillStyle = COLORS.infoText;
    ctx.font = `bold ${Math.round(s * 0.42)}px Georgia, serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('i', px + s / 2, py + s * 0.42);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    // little stand
    ctx.fillStyle = COLORS.metalDark;
    ctx.fillRect(px + s / 2 - 2, py + s - 9, 4, 6);
    ctx.fillRect(px + s * 0.3, py + s - 4, s * 0.4, 3);
  }

  drawNot(px, py, s, c) {
    const ctx = this.ctx;
    ctx.fillStyle = COLORS.chip;
    ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
    ctx.strokeStyle = '#1b1f2b';
    ctx.strokeRect(px + 1.5, py + 1.5, s - 3, s - 3);
    // pins along the sides
    ctx.fillStyle = '#5b6275';
    for (let i = 0; i < 3; i++) {
      const o = 7 + i * 8;
      ctx.fillRect(px, py + o, 3, 4); ctx.fillRect(px + s - 3, py + o, 3, 4);
    }
    // NOT-gate triangle pointing along out dir + bubble.
    const cx = px + s / 2, cy = py + s / 2;
    const [dx, dy] = DIRS[c.dir];
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.fillStyle = COLORS.chipEtch;
    ctx.beginPath();
    ctx.moveTo(-7, -6); ctx.lineTo(5, 0); ctx.lineTo(-7, 6); ctx.closePath();
    ctx.fill();
    ctx.beginPath(); ctx.arc(8, 0, 2.6, 0, 7); ctx.fill();
    ctx.restore();
  }

  // Value of a delay line's input at time `tt`, from its change-point history.
  sampleDelay(hist, tt) {
    let v = hist[0].v;
    for (let k = 0; k < hist.length; k++) { if (hist[k].t <= tt) v = hist[k].v; else break; }
    return v;
  }

  // Directional delay line, drawn as a little clock. The input's on/off pattern
  // is shown as a bright highlight sweeping across the face from the in side to
  // the out side over DELAY_TIME -- when an "on" band reaches the out edge the
  // output fires. A small arrow on the rim marks the out direction.
  drawDelay(px, py, s, c) {
    const ctx = this.ctx;
    const cx = px + s / 2, cy = py + s / 2, r = s * 0.42;
    const [dx, dy] = DIRS[c.dir];
    const ang = Math.atan2(dy, dx);

    // chip base
    ctx.fillStyle = COLORS.delay;
    ctx.fillRect(px + 1, py + 1, s - 2, s - 2);

    // clock face + the signal pattern shifting through it (clipped to the dial)
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.clip();
    ctx.fillStyle = '#162033';
    ctx.fillRect(px, py, s, s);
    const hist = c.delayHist;
    if (hist && hist.length) {
      const now = this.world.circuit.time;
      const N = 16;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);                       // local +x points along out dir
      ctx.fillStyle = COLORS.wireLive;
      ctx.globalAlpha = 0.5;
      const band = (2 * r) / N;
      for (let i = 0; i < N; i++) {
        const u = (i + 0.5) / N;              // 0 = in edge .. 1 = out edge
        if (!this.sampleDelay(hist, now - u * DELAY_TIME)) continue;
        ctx.fillRect((u - 0.5) * 2 * r - band / 2, -r, band + 1, 2 * r);
      }
      ctx.restore();
    }
    ctx.restore();

    // rim
    ctx.strokeStyle = COLORS.delayEtch; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
    // hour ticks
    ctx.lineWidth = 1;
    for (let k = 0; k < 12; k++) {
      const a = k * Math.PI / 6;
      const r1 = r * (k % 3 === 0 ? 0.72 : 0.84), r2 = r * 0.95;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.stroke();
    }
    // slowly turning hands (decorative clock motif)
    const mh = this.t * 0.9 - Math.PI / 2, hh = mh / 12;
    ctx.strokeStyle = COLORS.delayEtch; ctx.lineCap = 'round';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(hh) * r * 0.42, cy + Math.sin(hh) * r * 0.42); ctx.stroke();
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(mh) * r * 0.66, cy + Math.sin(mh) * r * 0.66); ctx.stroke();
    ctx.fillStyle = COLORS.delayEtch;
    ctx.beginPath(); ctx.arc(cx, cy, 1.6, 0, 7); ctx.fill();
    // out-direction marker on the rim (brightens when the output is firing)
    ctx.save();
    ctx.translate(cx + dx * (r + 2.5), cy + dy * (r + 2.5));
    ctx.rotate(ang);
    ctx.fillStyle = c.delayOn ? COLORS.wireLive : COLORS.delayEtch;
    ctx.beginPath(); ctx.moveTo(-2.5, -3); ctx.lineTo(2.5, 0); ctx.lineTo(-2.5, 3); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // Is (cell) x,y within the visible viewport (+ margin)? Used to skip drawing
  // entities that are off screen.
  inView(x, y, m = 1) {
    const v = this.view;
    return v && x >= v.x0 - m && x <= v.x1 + m && y >= v.y0 - m && y <= v.y1 + m;
  }

  drawVortices() {
    for (const v of this.world.vortices) {
      if (!v.alive) continue;
      if (!this.inView(v.x, v.y)) continue;   // skip off-screen orbs
      const col = v.color === 'red' ? COLORS.vRed : v.color === 'green' ? COLORS.vGreen : COLORS.vBlue;
      this.drawOrb(this.sx(v.x), this.sy(v.y), col, v.scale ?? 1);
    }
  }

  drawBlue(b) {
    this.drawOrb(this.sx(b.x + TIM_W / 2), this.sy(b.y + TIM_H / 2), COLORS.vBlue);
  }

  drawOrb(cx, cy, col, scale = 1) {
    const ctx = this.ctx;
    const r = VORTEX_R * CELL * scale;
    // Bright "popping" orb: a white-hot core blooming out to the colour, with
    // three swirling rings -- the same look as the time-travel button.
    const pulse = 1 + 0.12 * Math.sin(this.t * 5);
    const grd = ctx.createRadialGradient(cx, cy, 1, cx, cy, r * 1.8 * pulse);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.3, col);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.8 * pulse, 0, 7); ctx.fill();
    // swirling rings
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      const a = this.t * 3 + i * 2.1;
      ctx.arc(cx, cy, r * (0.6 + i * 0.18), a, a + 2.4);
      ctx.stroke();
    }
  }

  drawTims() {
    const w = this.world, a = this.alpha;
    for (let i = 0; i < w.tims.length; i++) {
      const t = w.tims[i];
      const focused = i === w.focus;
      // Interpolate between the previous and current sim positions for smooth
      // motion regardless of the display refresh rate (fall back to current).
      const tpx = t.px ?? t.x, tpy = t.py ?? t.y;
      const ix = tpx + (t.x - tpx) * a, iy = tpy + (t.y - tpy) * a;
      const px = this.sx(ix), py = this.sy(iy), bw = t.w * CELL, bh = t.h * CELL;
      this.drawTim(t, i, px, py, bw, bh, focused);
      if (focused && w.tims.length > 1) this.drawReticle(px, py, bw, bh);
    }
  }

  // A little square-ish scientist: head with hair + glasses, lab coat, and
  // arms/legs that swing when walking and tuck when airborne.
  drawTim(t, i, px, py, bw, bh, focused) {
    const ctx = this.ctx;
    const cx = px + bw / 2, baseY = py + bh, f = t.facing;
    const moving = Math.abs(t.vx) > 0.1;
    const air = !t.onGround;
    const sw = moving ? Math.sin(t.walk) : 0;                 // stride phase -1..1
    const bob = (!moving && !air) ? Math.sin(this.t * 2.4 + i) * 1.1 : 0;

    ctx.save();
    // All Tims render fully (unfocused ones are NOT dimmed); the focus reticle
    // is what marks the active Tim.

    // Time-travel entrance/exit: a Tim spins and scales up from nothing as he
    // arrives, and spins + shrinks back to nothing as he departs into time.
    const POP = 0.5;
    const wt = this.world.time;
    let popScale = 1, popSpin = 0;
    if (t.appearAt != null && wt - t.appearAt < POP) {
      const k = Math.max(0, (wt - t.appearAt) / POP);   // 0 -> 1
      popScale = k; popSpin = (1 - k) * Math.PI * 3;
    } else if (t.vanishAt != null && t.vanishAt - wt < POP) {
      const k = Math.max(0, (t.vanishAt - wt) / POP);   // 1 -> 0
      popScale = k; popSpin = (1 - k) * Math.PI * 3;
    }
    if (popScale !== 1) {
      const acx = px + bw / 2, acy = py + bh / 2;
      ctx.translate(acx, acy);
      ctx.rotate(popSpin);
      ctx.scale(popScale, popScale);
      ctx.translate(-acx, -acy);
    }

    // If Tim was knocked over (e.g. by a piston), topple about his feet.
    if (t.topple) {
      const ang = Math.min(Math.PI * 0.46, (this.endT || 0) * 7) * (t.toppleDir || 1);
      ctx.translate(cx, baseY);
      ctx.rotate(ang);
      ctx.translate(-cx, -baseY);
    }

    // Vertical layout.
    const headH = bh * 0.40;
    const headW = bw * 0.74;
    const headTop = py + bob;
    const headBot = headTop + headH;
    const legLen = bh * 0.24;
    const bodyTop = headBot - 2;
    const bodyBot = baseY - legLen;
    const legW = bw * 0.3;
    const coatColor = COLORS.timCoat;

    // --- legs (pants + shoes) ---
    const stride = legW * 0.55;
    const legCfg = air
      ? [[-legW * 0.7, -stride * 0.6], [legW * 0.7 - legW, stride * 0.6]] // tucked apart
      : [[-legW - 1, sw * stride], [1, -sw * stride]];
    ctx.fillStyle = COLORS.timLeg;
    for (let li = 0; li < 2; li++) {
      const [lx, dx] = legCfg[li];
      const lift = (!air && moving) ? Math.max(0, (li === 0 ? sw : -sw)) * legLen * 0.35 : 0;
      const x = cx + lx + dx;
      this.roundRect(x, bodyBot, legW, legLen - lift, 3); ctx.fill();
      ctx.fillStyle = COLORS.timShoe;
      ctx.fillRect(x - 1 + Math.sign(dx || f) * 1, bodyBot + legLen - lift - 3, legW + 2, 4);
      ctx.fillStyle = COLORS.timLeg;
    }

    // --- back arm (behind coat, on the leading/facing side) ---
    const armSwing = moving ? sw * bh * 0.10 : 0;
    ctx.strokeStyle = coatColor;
    ctx.lineWidth = bw * 0.2;
    ctx.lineCap = 'round';
    this.limb(cx + f * headW * 0.42, bodyTop + 3, cx + f * bw * 0.34, bodyTop + bh * 0.30 - armSwing);

    // --- lab coat (flared body) ---
    ctx.fillStyle = coatColor;
    ctx.beginPath();
    const topW = headW * 0.92, botW = bw * 0.98;
    ctx.moveTo(cx - topW / 2, bodyTop);
    ctx.lineTo(cx + topW / 2, bodyTop);
    ctx.lineTo(cx + botW / 2, bodyBot + 2);
    ctx.lineTo(cx - botW / 2, bodyBot + 2);
    ctx.closePath();
    ctx.fill();
    // coat seam + lapels
    ctx.strokeStyle = COLORS.timCoatShade;
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(cx, bodyTop + 1); ctx.lineTo(cx, bodyBot); ctx.stroke();
    ctx.fillStyle = 'rgba(70,80,100,0.18)';
    ctx.beginPath();
    ctx.moveTo(cx, bodyTop); ctx.lineTo(cx - topW * 0.28, bodyTop);
    ctx.lineTo(cx, bodyTop + bh * 0.16); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx, bodyTop); ctx.lineTo(cx + topW * 0.28, bodyTop);
    ctx.lineTo(cx, bodyTop + bh * 0.16); ctx.closePath(); ctx.fill();
    // pocket protector with pens -- fixed on one breast (never flips)
    const pkw = bw * 0.2, pkx = cx - bw * 0.30;
    const pky = bodyTop + bh * 0.13;
    ctx.fillStyle = COLORS.timPocket;
    ctx.fillRect(pkx, pky, pkw, bh * 0.16);
    ctx.strokeStyle = '#3a4a8a'; ctx.lineWidth = 1.3;
    for (let p = 0; p < 2; p++) {
      ctx.beginPath();
      ctx.moveTo(pkx + pkw * (0.32 + p * 0.36), pky + 1);
      ctx.lineTo(pkx + pkw * (0.32 + p * 0.36), pky + bh * 0.11);
      ctx.stroke();
    }

    // --- head ---
    // Draw the whole head in hair colour, then lay a skin "face" rounded-rect
    // over it. The face is INSET on the back side (the way Tim isn't facing),
    // so the hair runs all the way down the back of his head while staying
    // short above the brow on the front. Hair always sits behind the face and
    // never covers the eyes.
    ctx.fillStyle = COLORS.timHair;
    this.roundRect(cx - headW / 2, headTop, headW, headH, headW * 0.32); ctx.fill();
    const hairH = headH * 0.30;                   // short cap above the brow
    ctx.fillStyle = COLORS.timSkin;               // full-width face below the hairline
    this.roundRect(cx - headW / 2, headTop + hairH, headW, headH - hairH, headW * 0.30); ctx.fill();
    // a short tuft of hair down the back (the side away from facing)
    ctx.fillStyle = COLORS.timHair;
    const bsW = headW * 0.2, bsX = f > 0 ? cx - headW / 2 : cx + headW / 2 - bsW;
    const bsTop = headTop + hairH * 0.5, bsBot = headTop + headH * 0.5;
    this.roundRect(bsX, bsTop, bsW, bsBot - bsTop, headW * 0.12); ctx.fill();

    // --- face (on facing side) ---
    const fx = cx + f * headW * 0.08;       // face features shifted toward facing
    const eyeY = headTop + headH * 0.56;
    const eyeDX = headW * 0.17, eyeR = headW * 0.06;
    const blink = (this.t * 1.0 + i * 1.7) % 4 < 0.12;
    // glasses
    ctx.strokeStyle = COLORS.timGlasses; ctx.lineWidth = 1.3;
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.arc(fx + s * eyeDX, eyeY, eyeR + 1.4, 0, 7); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(fx - eyeDX + eyeR + 1, eyeY); ctx.lineTo(fx + eyeDX - eyeR - 1, eyeY); ctx.stroke();
    // eyes
    ctx.fillStyle = COLORS.timFace;
    for (const s of [-1, 1]) {
      if (blink) { ctx.fillRect(fx + s * eyeDX - eyeR, eyeY, eyeR * 2, 1.4); }
      else { ctx.beginPath(); ctx.arc(fx + s * eyeDX, eyeY, eyeR, 0, 7); ctx.fill(); }
    }
    // smile
    ctx.strokeStyle = COLORS.timSkinShade; ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(fx, headTop + headH * 0.74, headW * 0.14, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();

    // --- front arm + hand (over coat, on the trailing side: right when walking
    //     left, left when walking right) ---
    ctx.strokeStyle = coatColor; ctx.lineWidth = bw * 0.2; ctx.lineCap = 'round';
    const handX = cx - f * bw * 0.34, handY = bodyTop + bh * 0.30 + armSwing;
    this.limb(cx - f * headW * 0.42, bodyTop + 3, handX, handY);
    ctx.fillStyle = COLORS.timSkin;
    ctx.beginPath(); ctx.arc(handX, handY, bw * 0.08, 0, 7); ctx.fill();

    ctx.restore();
  }

  limb(x1, y1, x2, y2) {
    const ctx = this.ctx;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  drawReticle(px, py, bw, bh) {
    const ctx = this.ctx;
    ctx.strokeStyle = COLORS.reticle;
    ctx.lineWidth = 2;
    const m = 5 + Math.sin(this.t * 4);
    const L = 7;
    const corners = [[px - m, py - m, 1, 1], [px + bw + m, py - m, -1, 1],
                     [px - m, py + bh + m, 1, -1], [px + bw + m, py + bh + m, -1, -1]];
    for (const [x, y, sxd, syd] of corners) {
      ctx.beginPath();
      ctx.moveTo(x, y + syd * L); ctx.lineTo(x, y); ctx.lineTo(x + sxd * L, y);
      ctx.stroke();
    }
  }

  drawParticles() {
    const ctx = this.ctx;
    for (const p of this.world.particles) {
      const a = 1 - p.t / p.life;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = p.color;
      const sz = (p.big ? 4 : 2) + a * (p.big ? 4 : 2);
      ctx.fillRect(this.sx(p.x) - sz / 2, this.sy(p.y) - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;
  }

  drawHUD() {
    const ctx = this.ctx, w = this.world;
    // Energy meter.
    ctx.save();
    // Left margin clears the top-left help button. main.js measures the button's
    // real right edge (which shifts inward from the safe-area inset on notched
    // phones) and sets this; fall back to a sensible default before it's set.
    const hudX = this.hudX ?? 58;
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillStyle = '#cdd6ea';
    ctx.fillText('Tim the Time Traveller', hudX, 26);
    const n = WIN_ENERGY, cellW = 16, gap = 4, x0 = hudX, y0 = 36;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * (cellW + gap);
      ctx.strokeStyle = '#4a5468';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y0, cellW, cellW);
      if (i < w.energy) {
        ctx.fillStyle = COLORS.vGreen;
        ctx.fillRect(x + 2, y0 + 2, cellW - 4, cellW - 4);
      }
    }

    // Time-travel countdown bar. Always spans the full TT_WARMUP (so it reads as
    // time travel, not cloning) and drains over exactly that long. A notch marks
    // where the next-timeline Tim appears. Shown ONLY when the focused Tim is the
    // one who launched this trip.
    const tt = w.timeTravels.find((t) => t.oldTim === w.focused);
    if (tt) {
      const bx = hudX, by = 76, bw = 200, bh = 18, rad = 4;
      const p = Math.min(1, tt.t / TT_WARMUP);              // elapsed fraction
      const outline = 'rgba(150,170,210,0.5)';
      ctx.fillStyle = COLORS.vBlue;
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillText('TIME TRAVEL', bx, by - 6);
      // Track, draining remainder (blue = remaining time, left-anchored, draining
      // right -> left), and the green spawn marker -- all clipped to the bar.
      ctx.save();
      this.roundRect(bx, by, bw, bh, rad); ctx.clip();
      ctx.fillStyle = 'rgba(18,26,42,0.92)'; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = COLORS.vBlue; ctx.fillRect(bx, by, (1 - p) * bw, bh);
      // green triangle (fully inside the bar) where the copy arrives -- the
      // draining edge reaches it exactly when the new Tim spawns.
      const nx = bx + (tt.energy / TT_WARMUP) * bw;
      ctx.beginPath();
      ctx.moveTo(nx, by + 3);                  // tip near the top
      ctx.lineTo(nx - 6, by + bh);             // base flush with the bar's bottom
      ctx.lineTo(nx + 6, by + bh);
      ctx.closePath();
      ctx.fillStyle = COLORS.vGreen; ctx.fill();
      ctx.strokeStyle = '#0d1422'; ctx.lineWidth = 1.5; ctx.stroke();  // dark edge for contrast
      ctx.restore();
      // bar outline
      ctx.strokeStyle = outline; ctx.lineWidth = 1;
      this.roundRect(bx + 0.5, by + 0.5, bw - 1, bh - 1, rad); ctx.stroke();
    }

    // Status banners.
    // Restart prompt matches the platform: "tap" on touch devices, "Press R"
    // where there's a keyboard.
    const again = this.isTouch ? 'Tap' : 'Press R';
    if (w.status === 'win') this.banner('YOU WIN!', '#46e08b', `You reached 10 time energy.  ${again} to replay.`);
    if (w.status === 'dead') {
      const msg = w.deathMsg || 'You died.';
      this.banner('YOU DIED', '#ff4d5e', `${msg}  ${again} to restart.`);
    }
    ctx.restore();
  }

  banner(title, color, sub) {
    const ctx = this.ctx;
    // Fade the overlay in over ~0.5s so any death explosion is visible first.
    const k = Math.min(1, (this.endT || 0) / 0.5);
    ctx.save();
    ctx.globalAlpha = 0.72 * k;
    ctx.fillStyle = '#080a10';
    ctx.fillRect(0, 0, this.vw, this.vh);
    ctx.globalAlpha = k;
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.font = 'bold 56px system-ui, sans-serif';
    ctx.fillText(title, this.vw / 2, this.vh / 2 - 10);
    ctx.fillStyle = '#cdd6ea';
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText(sub, this.vw / 2, this.vh / 2 + 32);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  // Message box raised while Tim is touching an info panel. Bottom-centre,
  // word-wrapped, with a glowing "i" badge.
  drawInfoMessage() {
    const msg = this.world.activeInfo;
    if (!msg) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '15px system-ui, sans-serif';
    const maxTextW = Math.min(520, this.vw - 140);
    const lines = this.wrapText(msg, maxTextW);
    const lh = 21, padX = 18, padY = 14, badge = 30;
    let textW = 0;
    for (const ln of lines) textW = Math.max(textW, ctx.measureText(ln).width);
    const boxW = badge + textW + padX * 2;
    const boxH = lines.length * lh + padY * 2;
    const bx = (this.vw - boxW) / 2;
    const by = this.vh - boxH - 30;
    // panel
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = '#0e1422';
    this.roundRect(bx, by, boxW, boxH, 10); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = COLORS.infoScreen; ctx.lineWidth = 1.5;
    this.roundRect(bx + 0.75, by + 0.75, boxW - 1.5, boxH - 1.5, 10); ctx.stroke();
    // "i" badge
    ctx.fillStyle = COLORS.infoScreen;
    ctx.beginPath(); ctx.arc(bx + padX + 8, by + boxH / 2, 11, 0, 7); ctx.fill();
    ctx.fillStyle = '#0e1422';
    ctx.font = 'bold 16px Georgia, serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('i', bx + padX + 8, by + boxH / 2 + 1);
    // text
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COLORS.infoText;
    ctx.font = '15px system-ui, sans-serif';
    const tx = bx + padX + badge;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], tx, by + padY + 15 + i * lh);
    }
    ctx.restore();
  }

  // Greedy word-wrap to a pixel width (honours explicit newlines). Assumes the
  // caller has set ctx.font.
  wrapText(text, maxW) {
    const ctx = this.ctx;
    const lines = [];
    for (const para of String(text).split('\n')) {
      let cur = '';
      for (const word of para.split(/\s+/)) {
        if (!word) continue;
        const test = cur ? cur + ' ' + word : word;
        if (cur && ctx.measureText(test).width > maxW) { lines.push(cur); cur = word; }
        else cur = test;
      }
      lines.push(cur);
    }
    return lines;
  }

  roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
