'use strict';
/* ------------------------------------------------------------------ *
 * Static data + the rules-math from the README.
 * ------------------------------------------------------------------ */

const WORLD_W = 1280, WORLD_H = 720;

// Color IS the shape's hit points: red(1) .. purple(6).
const COLORS = [
  null,
  { name: 'red',    hex: '#e5342c' },
  { name: 'orange', hex: '#ef8b1b' },
  { name: 'yellow', hex: '#e8cf24' },
  { name: 'green',  hex: '#3fba50' },
  { name: 'blue',   hex: '#2f7fe0' },
  { name: 'purple', hex: '#9b46d6' }
];

const POLY_NAMES = { 3:'triangle', 4:'square', 5:'pentagon', 6:'hexagon', 7:'heptagon' };

/* Total hits needed to erase a shape *and everything it splits into*.
 *   H(c,3) = c                 (a red triangle dies on one hit)
 *   H(c,n) = c + 2*H(6,n-1)    (a red n-gon splits into two purple (n-1)-gons)
 * This is also the damage the shape deals if it reaches the exit:
 *   orange pentagon -> 2 + 2*(6 + 2*6) = 38, exactly as the README states. */
const _brood = {};                       // 2*H(6,n-1), memoised
function broodHealth(sides){
  if (sides <= 3) return 0;
  if (_brood[sides] === undefined) _brood[sides] = 2 * totalHealth(6, sides - 1);
  return _brood[sides];
}
function totalHealth(color, sides){ return color + broodHealth(sides); }

const SHAPE_RADIUS = { 3:13, 4:16, 5:19, 6:22, 7:24 };   // circumradius, px
/* Shapes are hit on a circle a little larger than the polygon they draw, so
 * near-misses along an edge still connect and the game feels fair. */
const HITBOX_SCALE = 1.35;
const SHAPE_SPEED  = { 3:78, 4:67, 5:57, 6:48, 7:41 };   // px/s — fewer sides, faster
const SHAPE_SPIN   = { 3:0.9, 4:0.6, 5:0.45, 6:0.35, 7:0.28 };

/* ------------------------------- paths ---------------------------- */
const PATHS = [
  { name:'The Long Road', blurb:'Eleven turns and a lot of straightaway. The gentlest ground to hold.',
    pts:[[-50,120],[300,120],[300,300],[120,300],[120,520],[560,520],[560,180],
         [860,180],[860,600],[1100,600],[1100,340],[1246,340]] },
  { name:'Hairpin', blurb:'Tight switchbacks. One well-placed circle covers four lanes at once.',
    pts:[[-50,600],[200,600],[200,140],[420,140],[420,560],[640,560],[640,140],
         [860,140],[860,560],[1080,560],[1080,200],[1246,200]] },
  { name:'The Sprint', blurb:'Short, wide and fast. Very little time to work on anything.',
    pts:[[-50,360],[260,360],[260,120],[700,120],[700,600],[1040,600],[1040,360],[1246,360]] }
];
const PATH_WIDTH = 46;

/* ---------------------------- difficulty -------------------------- */
const DIFFICULTIES = [
  { key:'easy',   name:'Easy',   lives:250, gold:220, goldMul:0.60 },
  { key:'normal', name:'Normal', lives:120, gold:180, goldMul:0.42 },
  { key:'hard',   name:'Hard',   lives:70,  gold:180, goldMul:0.40 }
];

/* ------------------------------ circles --------------------------- */
/* A projectile cannot dump its whole pool instantly: it spends power at a
 * maximum rate while it is in contact with a shape, amortised across frames.
 * A shot that crosses the path slowly therefore stays in contact longer and
 * delivers more of its power than one that flicks straight through. */
const POWER_RATE   = 8;      // max hits/second, x the projectile's power

const TOWER_COST   = 60;
const TOWER_RADIUS = 12;
const PROJ_RADIUS  = 3.5;
const UPGRADE_BASE = 20;      // L -> L+1 costs UPGRADE_BASE*(2L+1), so reaching
                             // level L costs UPGRADE_BASE*(L^2-1): quadratic.
                             // There is no level cap — upgrades continue forever.
const SELL_REFUND  = 0.5;     // refunded on sale, rounded up

/* Every stat costs the same per level, so each one's *step* is what balances
 * it against the others (measured, see the marginal-value harness). */
const STATS = [
  { key:'range',    label:'Range',     desc:'how far it sees',       base:70,  step:60,
    fmt:v => Math.round(v) + ' px' },
  { key:'firerate', label:'Fire rate', desc:'projectiles / second',  base:1.0, step:0.65,
    fmt:v => v.toFixed(2) + '/s' },
  { key:'power',    label:'Power',     desc:'hits per projectile',   base:1,   step:1,
    fmt:v => String(Math.round(v)) },
  { key:'speed',    label:'Speed',     desc:'projectile velocity',   base:220, step:90,
    fmt:v => Math.round(v) + ' px/s' }
];
const STAT_BY_KEY = {}; STATS.forEach(s => STAT_BY_KEY[s.key] = s);

function statValue(key, lvl){ const s = STAT_BY_KEY[key]; return s.base + s.step * (lvl - 1); }
function upgradeCost(lvl){ return UPGRADE_BASE * (2 * lvl + 1); }
function towerSpent(t){
  let g = TOWER_COST;
  for (const s of STATS) for (let l = 1; l < t.lv[s.key]; l++) g += upgradeCost(l);
  return g;
}

/* Targeting. Kept to four so the panel can cycle them with one small button. */
const TARGET_MODES = [
  { key:'first',  label:'First'  },   // furthest along the path (default)
  { key:'last',   label:'Last'   },   // least far along
  { key:'strong', label:'Strong' },   // most total health, children included
  { key:'close',  label:'Close'  }    // nearest to the circle
];

/* ------------------------------- waves ---------------------------- */
/* {s:sides, c:color, n:count, gap:seconds between, at:seconds after wave start} */
const WAVES = [
  [ {s:3,c:1,n:10,gap:0.80,at:0} ],
  [ {s:3,c:2,n:12,gap:0.70,at:0} ],
  [ {s:3,c:3,n:10,gap:0.70,at:0}, {s:3,c:1,n:6, gap:0.35,at:7.5} ],
  [ {s:3,c:4,n:8, gap:0.75,at:0}, {s:3,c:2,n:8, gap:0.50,at:6.5} ],
  [ {s:4,c:1,n:4, gap:1.60,at:0}, {s:3,c:3,n:6, gap:0.60,at:7.0} ],
  [ {s:3,c:5,n:14,gap:0.55,at:0} ],
  [ {s:4,c:2,n:6, gap:1.40,at:0}, {s:3,c:4,n:8, gap:0.50,at:9.0} ],
  [ {s:3,c:6,n:10,gap:0.50,at:0}, {s:4,c:3,n:4, gap:1.30,at:6.0} ],
  [ {s:4,c:4,n:8, gap:1.10,at:0}, {s:3,c:5,n:10,gap:0.45,at:9.0} ],
  [ {s:5,c:1,n:4, gap:2.20,at:0}, {s:3,c:5,n:8, gap:0.50,at:7.0} ],
  [ {s:4,c:5,n:7, gap:1.20,at:0}, {s:3,c:6,n:14,gap:0.40,at:8.0} ],
  [ {s:5,c:2,n:5, gap:2.00,at:0}, {s:3,c:4,n:10,gap:0.45,at:11.0} ],
  [ {s:4,c:6,n:10,gap:1.00,at:0}, {s:5,c:1,n:2, gap:2.50,at:11.0} ],
  [ {s:5,c:4,n:4, gap:2.20,at:0}, {s:3,c:6,n:16,gap:0.35,at:9.0} ],
  [ {s:6,c:1,n:2, gap:3.00,at:0}, {s:4,c:2,n:8, gap:1.00,at:7.0} ],
  [ {s:5,c:5,n:6, gap:1.80,at:0}, {s:4,c:3,n:6, gap:1.00,at:11.0} ],
  [ {s:5,c:6,n:8, gap:1.60,at:0}, {s:3,c:6,n:16,gap:0.30,at:13.0} ],
  [ {s:6,c:2,n:3, gap:2.80,at:0}, {s:4,c:4,n:12,gap:0.90,at:9.0} ],
  [ {s:5,c:4,n:6, gap:1.60,at:0}, {s:4,c:6,n:12,gap:0.80,at:10.0} ],
  [ {s:6,c:6,n:3, gap:3.00,at:0}, {s:5,c:6,n:4, gap:2.00,at:12.0}, {s:3,c:6,n:16,gap:0.25,at:18.0},
    {s:7,c:6,n:2, gap:7.00,at:26.0} ]
];

const GOLD_PER_HIT = 1;                          // gold per point of color removed, x difficulty goldMul
function waveBonus(i){ return 15 + 5 * (i + 1); } // i is 0-based

const WIN_TEXT  = 'You defeated the shapes, you have kept your world cold and gray forever.';
const LOSE_TEXT = 'You were overrun by shapes.';
