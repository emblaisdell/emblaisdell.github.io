// Shared constants and small helpers for Tim the Time Traveller.

export const CELL = 32;            // pixels per grid cell
export const FPS = 60;
export const DT = 1 / FPS;         // fixed simulation timestep (seconds)

// Win condition.
export const WIN_ENERGY = 10;

// Time-travel timing (seconds).
export const TT_WARMUP = 10;       // total warm-up before old Tim vanishes

// Pistons stay "quiet" for this long at the start of a run: they extend/retract
// with the circuit, but don't shove blocks until the electronics have settled
// (delay lines, oscillators, coin sources all resolve in the first frames).
export const PISTON_WARMUP = 1.0;

// Delay (seconds) introduced by a delay-line component. Wires themselves switch
// instantly now; a delay line is how you add a directional propagation lag (and
// how a NOT + delay feedback loop becomes a bounded oscillator / blinker).
export const DELAY_TIME = 1.0;

// Physics tuning (units are cells; converted to px on render).
export const GRAVITY = 38;         // cells / s^2
export const MOVE_SPEED = 7.5;     // cells / s
export const JUMP_VELOCITY = 14;   // cells / s
export const MAX_FALL = 28;        // terminal velocity
export const TIM_W = 0.8;          // Tim width in cells
export const TIM_H = 0.9;          // Tim height in cells
export const COYOTE = 0.08;        // coyote-time seconds

// Vortex visual/collision radius in cells.
export const VORTEX_R = 0.42;

// How far below the lowest block "the void" sits. The editor bakes the kill
// line (lowest cell + this) into each level as `voidY`; the game falls back to
// computing it the same way for levels that don't carry one.
export const VOID_DROP = 3;

// Directions: index -> [dx, dy]. 0=up 1=right 2=down 3=left
export const DIRS = [
  [0, -1], // up
  [1, 0],  // right
  [0, 1],  // down
  [-1, 0], // left
];
export const DIR_NAMES = ['up', 'right', 'down', 'left'];
export const opposite = (d) => (d + 2) % 4;

// Cell type ids. 0 reserved for empty.
export const T = {
  EMPTY: 0,
  WALL: 1,     // solid scenery; .variant
  WIRE: 2,     // bare metal wire; transmits power; lethal when live
  BUTTON: 3,   // step to power wire below
  PISTON: 4,   // .dir extend direction
  NOT: 5,      // .dir = OUT side
  COIN: 6,     // random source: rolls active/inactive once at game start
  DELAY: 7,    // directional delay line; .dir = OUT side; out lags in by DELAY_TIME
  // --- decorative / atmosphere ---
  TEMPLE: 8,   // ancient-temple stone block; .variant (brick / glyph / cracked)
  TABLE: 9,    // a lab table (solid; stand on top)
  LIGHT: 10,   // ceiling lamp (non-solid, glows)
  TORCH: 11,   // wall torch (non-solid, flickering flame)
  INFO: 12,    // touch to surface a level-author message (non-solid); .text
};

// Which cell types are solid for platforming collisions. Buttons are NOT
// solid: Tim walks through a button cell and stands on the wire/floor below
// (the button is drawn at the cell's bottom and insulates him from that wire).
// Lights and torches are decorative pass-through; temple stone and tables are solid.
// Coins are solid circuit blocks; info panels are walk-through (Tim reads them).
export const SOLID = new Set([T.WALL, T.WIRE, T.PISTON, T.NOT, T.COIN, T.DELAY, T.TEMPLE, T.TABLE]);

// Which cell types a piston can shove one cell along (a contiguous run of these
// is pushed as a group). Wires keep their identity/power as they slide; walls
// (including caution/temple stone) are plain scenery that rides along.
export const PUSHABLE = new Set([T.WALL, T.WIRE, T.TEMPLE]);

export const key = (x, y) => x + ',' + y;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Theme palette.
export const COLORS = {
  bg0: '#10131a',
  bg1: '#1a2030',
  grid: 'rgba(120,140,180,0.06)',
  wall: '#3a4256',
  wallEdge: '#4d586f',
  wallBolt: '#6b7790',
  wire: '#7d8aa0',
  metal: '#8a92a3',
  metalLight: '#b6bdca',
  metalDark: '#5c6473',
  rivet: '#404856',
  wireLive: 'rgba(255,224,90,0.85)',
  spark: '#fff6c0',
  button: '#c45b6b',
  buttonDown: '#e8808f',
  piston: '#9aa3b5',
  pistonHead: '#f0a23c',      // distinct amber so the pusher head stands out
  pistonHeadHi: '#ffd98a',
  chip: '#2b3142',
  chipEtch: '#7fd1b9',
  delay: '#2b3142',
  delayEtch: '#7fa6d1',
  // coin/dice random source
  coin: '#b9912f',
  coinFace: '#f0cf6e',
  coinPip: '#2a2410',
  coinOff: '#4a4636',
  coinLive: 'rgba(255,224,90,0.85)',
  // info panel (terminal-style screen + message box)
  infoFrame: '#222a3d',
  infoScreen: '#39c0e6',
  infoScreenDim: '#1f5d70',
  infoText: '#eaf6fb',
  vRed: '#ff4d5e',
  vGreen: '#46e08b',
  vBlue: '#4db5ff',
  tim: '#e9edf5',
  timCoat: '#f4f7fc',
  timCoatShade: '#d3dae8',
  timFace: '#2a2f3c',
  timSkin: '#f0c9a0',
  timSkinShade: '#dcae84',
  timHair: '#4a3525',
  timLeg: '#33415e',
  timShoe: '#23303f',
  timPocket: '#9fb4ff',
  timGlasses: '#2a2f3c',
  reticle: '#ffd166',
  // decorative blocks
  caution: '#d9b23a',        // hazard-stripe yellow
  cautionDark: '#23262f',
  temple: '#bfa56c',         // sandstone
  templeHi: '#d4be8a',
  templeDark: '#8f7a4e',
  templeLine: '#6f5d39',
  glyph: '#7c6a44',
  tableTop: '#b6bdca',
  tableLeg: '#5c6473',
  lamp: '#fff3c0',
  lampGlow: 'rgba(255,236,150,0.5)',
  flame: '#ffce5a',
  flameHot: '#ff8a3d',
  torchWood: '#5a4327',
};
