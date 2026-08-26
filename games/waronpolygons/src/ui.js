'use strict';
/* ------------------------------------------------------------------ *
 * DOM: menu, sidebar, tooltip, input.
 * ------------------------------------------------------------------ */
const $ = id => document.getElementById(id);
const el = {
  lives:$('hudLives'), gold:$('hudGold'), wave:$('hudWave'),
  btnWave:$('btnWave'), btnBuild:$('btnBuild'), buildCost:$('buildCost'),
  panel:$('panel'), panelTot:$('panelTot'), upRows:$('upRows'),
  btnSell:$('btnSell'), sellVal:$('sellVal'), btnTarget:$('btnTarget'),
  btnPause:$('btnPause'), btnFast:$('btnFast'), btnMute:$('btnMute'), hint:$('hint'),
  tip:$('tip'), menu:$('menu'), end:$('end'),
  endTitle:$('endTitle'), endText:$('endText'), endStats:$('endStats')
};
let pick = { path:0, diff:0 };
const TOUCH = matchMedia('(pointer:coarse)').matches;

/* ---------------------------- progress ---------------------------- *
 * Clearing a path unlocks the next one; clearing anything on one
 * difficulty unlocks the next difficulty. Kept in localStorage, which can
 * throw or be empty in private windows — every access is guarded. */
const PROGRESS_KEY = 'wop_progress';
let progress = { won:{} };
function loadProgress(){
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (raw) progress = JSON.parse(raw);
  } catch (_) {}
  if (!progress || typeof progress !== 'object') progress = { won:{} };
  if (!progress.won || typeof progress.won !== 'object') progress.won = {};
}
function saveProgress(){
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch (_) {}
}
function markWon(pathIdx, diffKey){ progress.won[pathIdx + ':' + diffKey] = true; saveProgress(); }
function hasWon(pathIdx, diffIdx){ return !!progress.won[pathIdx + ':' + DIFFICULTIES[diffIdx].key]; }
function pathUnlocked(i){ return i === 0 || DIFFICULTIES.some((_,j) => hasWon(i-1, j)); }
function diffUnlocked(j){ return j === 0 || PATHS.some((_,i) => hasWon(i, j-1)); }
const upRowRefs = [];

/* ------------------------------- menu ----------------------------- */
function buildMenu(){
  loadProgress();
  while (pick.path > 0 && !pathUnlocked(pick.path)) pick.path--;
  while (pick.diff > 0 && !diffUnlocked(pick.diff)) pick.diff--;

  const pp = $('pathPick'); pp.innerHTML = '';
  PATHS.forEach((p, i) => {
    const open = pathUnlocked(i);
    const card = document.createElement('div');
    card.className = 'card' + (i === pick.path ? ' sel' : '') + (open ? '' : ' locked');
    const cnv = document.createElement('canvas');
    cnv.width = 320; cnv.height = 180;
    card.appendChild(cnv);
    const cleared = DIFFICULTIES.map((d,j) => hasWon(i,j) ? '<b>' + d.name + '</b>' : '')
                                .filter(Boolean).join(' ');
    card.insertAdjacentHTML('beforeend',
      '<div class="t">' + p.name + '</div>' +
      '<div class="b">' + (open ? p.blurb : 'Locked — clear ' + PATHS[i-1].name + ' to open this one.') + '</div>' +
      (cleared ? '<div class="won">cleared ' + cleared + '</div>' : ''));
    if (open) card.onclick = () => { pick.path = i; buildMenu(); };
    pp.appendChild(card);
    drawPreview(cnv, p);
  });

  const dp = $('diffPick'); dp.innerHTML = '';
  DIFFICULTIES.forEach((d, j) => {
    const open = diffUnlocked(j);
    const card = document.createElement('div');
    card.className = 'card' + (j === pick.diff ? ' sel' : '') + (open ? '' : ' locked');
    card.innerHTML = '<div class="t">' + d.name + '</div><div class="b">' +
      (open ? d.lives + ' lives &middot; ' + d.gold + ' gold to start'
            : 'Locked — win once on ' + DIFFICULTIES[j-1].name + '.') + '</div>';
    if (open) card.onclick = () => { pick.diff = j; buildMenu(); };
    dp.appendChild(card);
  });

  const any = Object.keys(progress.won).length > 0;
  $('resetWrap').classList.toggle('hidden', !any);
}

function drawPreview(cnv, p){
  const c = cnv.getContext('2d');
  const s = cnv.width / WORLD_W;
  c.fillStyle = '#141417'; c.fillRect(0,0,cnv.width,cnv.height);
  c.save(); c.scale(s, s);
  c.lineJoin = c.lineCap = 'round';
  c.strokeStyle = '#3d3d46'; c.lineWidth = PATH_WIDTH;
  c.beginPath(); c.moveTo(p.pts[0][0], p.pts[0][1]);
  for (let i = 1; i < p.pts.length; i++) c.lineTo(p.pts[i][0], p.pts[i][1]);
  c.stroke();
  const e = p.pts[p.pts.length-1];
  c.fillStyle = '#6a6a78'; c.fillRect(e[0]-44, e[1]-32, 30, 64);
  c.restore();
}

/* ---------------------------- upgrade rows ------------------------ */
function buildPanelRows(){
  el.upRows.innerHTML = '';
  upRowRefs.length = 0;
  for (const s of STATS){
    const row = document.createElement('div');
    row.className = 'up';
    row.innerHTML =
      '<div class="nm"><b>' + s.label + '</b><i class="v"></i></div>' +
      '<div class="lv"></div><button></button>';
    const btn = row.querySelector('button');
    btn.onclick = e => {
      e.stopPropagation();
      if (G.selected) upgrade(G.selected, s.key);
      btn.blur();
    };
    el.upRows.appendChild(row);
    upRowRefs.push({ key:s.key, stat:s, v:row.querySelector('.v'), lv:row.querySelector('.lv'), btn });
  }
}

function buildReference(){
  let h = '<table class="reftab"><tr><th></th>';
  for (let c = 1; c <= 6; c++)
    h += '<th><span class="swatch" style="background:' + COLORS[c].hex + '"></span></th>';
  h += '</tr>';
  for (const n of [3,4,5,6,7]){
    h += '<tr><td>' + POLY_NAMES[n] + '</td>';
    for (let c = 1; c <= 6; c++) h += '<td>' + totalHealth(c, n) + '</td>';
    h += '</tr>';
  }
  h += '</table><div style="margin-top:6px;line-height:1.5">Numbers are both the damage a shape ' +
       'deals at the exit and the total hits needed to erase it and everything it splits into.</div>';
  $('refBody').innerHTML = h;
}

/* ------------------------------- HUD ------------------------------ */
let lastHint = '';
function setHint(t){ if (t !== lastHint){ el.hint.textContent = t; lastHint = t; } }

function syncUI(){
  el.lives.textContent = G.lives;
  el.lives.parentNode.classList.toggle('hurt', G.lives <= G.maxLives * 0.34);
  el.gold.textContent = G.gold;
  el.wave.textContent = Math.min(G.nextWave, WAVES.length) + ' / ' + WAVES.length;

  const over = G.mode !== 'playing';
  const can = canStartWave();
  el.btnWave.disabled = !can;
  el.btnWave.textContent = G.nextWave >= WAVES.length
    ? (G.waves.length ? 'Final wave in progress' : 'All waves sent')
    : (G.waves.length ? 'Send Wave ' + (G.nextWave+1) + ' early' : 'Start Wave ' + (G.nextWave+1));

  el.buildCost.textContent = TOWER_COST;
  el.btnBuild.disabled = over || (G.gold < TOWER_COST && !G.placing);
  el.btnBuild.classList.toggle('on', G.placing);

  const t = G.selected;
  el.panel.classList.toggle('hidden', !t);
  if (t){
    el.panelTot.textContent = towerSpent(t) + ' invested';
    for (const r of upRowRefs){
      const lv = t.lv[r.key];
      r.v.textContent = r.stat.fmt(statValue(r.key, lv));
      r.lv.textContent = 'L' + lv;
      const c = upgradeCost(lv);
      r.btn.textContent = '+ ' + c;
      r.btn.disabled = G.gold < c;
    }
    el.sellVal.textContent = '+' + Math.ceil(towerSpent(t) * SELL_REFUND);
    el.btnTarget.textContent = 'Target: ' + TARGET_MODES[t.mode || 0].label;
  }

  el.btnPause.disabled = el.btnFast.disabled = over;
  el.btnPause.textContent = G.paused ? 'Resume' : 'Pause';
  el.btnPause.classList.toggle('on', G.paused);
  el.btnFast.textContent = G.fast ? '2×' : '1×';
  el.btnFast.classList.toggle('on', G.fast);
  const m = SFX.isMuted();
  el.btnMute.textContent = m ? 'Muted' : 'Sound';
  el.btnMute.classList.toggle('on', !m);

  if (G.placing)       setHint(TOUCH ? 'Drag onto open gray ground and lift to place. The circle sits above your finger.'
                                     : 'Click open gray ground to place the circle. Right-click or Esc to cancel.');
  else if (G.selected) setHint('Spending grows quadratically for a linear gain. Tap empty ground to deselect.');
  else if (TOUCH)      setHint('Tap a circle to upgrade it. Tap Buy Circle, then drag onto the map.');
  else                 setHint('B buy · Space next wave · P pause · F fast · M mute · hover a circle for its stats');
}

/* ----------------------------- tooltip ---------------------------- */
function syncTip(ev){
  const t = G.hovered;
  if (!t || G.placing || TOUCH){ el.tip.classList.add('hidden'); return; }
  let h = '<b>Circle</b>';
  for (const s of STATS)
    h += '<div><span>' + s.label + '</span> <span style="color:var(--ink)">' +
         s.fmt(statValue(s.key, t.lv[s.key])) + ' <em style="color:var(--dimmer);font-style:normal">L' +
         t.lv[s.key] + '</em></span></div>';
  h += '<div style="margin-top:4px"><span>Damage/sec</span> <span style="color:var(--ink)">' +
       (statValue('firerate', t.lv.firerate) * statValue('power', t.lv.power)).toFixed(1) + '</span></div>';
  h += '<div><span>Target</span> <span style="color:var(--ink)">' +
       TARGET_MODES[t.mode || 0].label + '</span></div>';
  el.tip.innerHTML = h;
  el.tip.classList.remove('hidden');
  const stage = $('stage').getBoundingClientRect();
  const tw = el.tip.offsetWidth, th = el.tip.offsetHeight;
  let x = ev.clientX - stage.left + 16, y = ev.clientY - stage.top + 16;
  if (x + tw > stage.width - 6)  x = ev.clientX - stage.left - tw - 12;
  if (y + th > stage.height - 6) y = ev.clientY - stage.top - th - 12;
  el.tip.style.left = x + 'px'; el.tip.style.top = y + 'px';
}

/* ------------------------------ input ----------------------------- */
/* A fingertip is far bigger than a 12px circle, so the pick radius is
 * defined in *screen* pixels and converted back into world units. */
function pickRadius(){
  return Math.max(TOWER_RADIUS + 5, 22 / (view.scale || 1));
}
function towerAt(x,y){
  const r = pickRadius();
  let best = null, bestD = Infinity;
  for (const t of G.towers){
    const d = Math.hypot(t.x-x, t.y-y);
    if (d <= r && d < bestD){ best = t; bestD = d; }
  }
  return best;
}

/* On touch the finger covers the target, so the ghost floats above it. */
const TOUCH_LIFT = 44;
let ptr = { id:null, type:'mouse', sx:0, sy:0, moved:false };

function evWorld(ev){
  const lift = ev.pointerType === 'touch' ? TOUCH_LIFT : 0;
  return toWorld(ev.clientX, ev.clientY - lift);
}

function wireInput(){
  cv.addEventListener('pointerdown', ev => {
    if (ev.button && ev.button !== 0) return;
    SFX.wake();                                   // first gesture starts audio
    ptr = { id:ev.pointerId, type:ev.pointerType, sx:ev.clientX, sy:ev.clientY, moved:false };
    try { cv.setPointerCapture(ev.pointerId); } catch (_) {}
    G.mouse = evWorld(ev);
    if (ev.pointerType !== 'touch') G.hovered = G.placing ? null : towerAt(G.mouse.x, G.mouse.y);
  });

  cv.addEventListener('pointermove', ev => {
    if (ptr.id === ev.pointerId &&
        (Math.abs(ev.clientX-ptr.sx) > 8 || Math.abs(ev.clientY-ptr.sy) > 8)) ptr.moved = true;

    // touch only tracks while a finger is down; a mouse tracks always
    if (ev.pointerType === 'touch'){
      if (ptr.id !== ev.pointerId) return;
      G.mouse = evWorld(ev);
      G.hovered = null;
      el.tip.classList.add('hidden');
      return;
    }
    const w = evWorld(ev);
    G.mouse = w;
    G.hovered = G.placing ? null : towerAt(w.x, w.y);
    cv.style.cursor = G.placing ? 'crosshair' : (G.hovered ? 'pointer' : 'default');
    syncTip(ev);
  });

  const finish = ev => {
    if (ptr.id !== ev.pointerId) return;
    const touch = ev.pointerType === 'touch';
    const w = evWorld(ev);
    G.mouse = w;
    if (G.placing){
      const t = placeTower(w.x, w.y);
      if (t){
        G.selected = t;
        if (!ev.shiftKey || G.gold < TOWER_COST) G.placing = false;
      }
      // an invalid drop keeps placing mode on so it can just be retried
    } else if (!ptr.moved){
      G.selected = towerAt(w.x, w.y) || null;
    }
    ptr.id = null;
    if (touch) G.mouse = null;                    // drop the ghost once the finger lifts
  };
  cv.addEventListener('pointerup', finish);
  cv.addEventListener('pointercancel', ev => {
    if (ptr.id === ev.pointerId){ ptr.id = null; if (ev.pointerType === 'touch') G.mouse = null; }
  });

  cv.addEventListener('mouseleave', () => {
    if (ptr.id === null){ G.hovered = null; G.mouse = null; el.tip.classList.add('hidden'); }
  });
  cv.addEventListener('contextmenu', ev => {
    ev.preventDefault();
    if (G.placing) G.placing = false; else G.selected = null;
  });

  // buttons keep focus after a click, which would make Space fire them again
  const tap = (b, fn) => { b.onclick = e => { SFX.wake(); fn(e); b.blur(); }; };
  tap(el.btnWave,  () => startWave());
  tap(el.btnBuild, () => { G.placing = !G.placing; if (G.placing) G.selected = null; });
  tap(el.btnSell,  () => { if (G.selected) sellTower(G.selected); });
  tap(el.btnTarget,() => { const t = G.selected;
                           if (t) t.mode = ((t.mode || 0) + 1) % TARGET_MODES.length; });
  tap(el.btnPause, () => { G.paused = !G.paused; });
  tap(el.btnFast,  () => { G.fast = !G.fast; });
  tap(el.btnMute,  () => { SFX.toggleMute(); });

  window.addEventListener('keydown', ev => {
    if (G.mode !== 'playing') return;
    const k = ev.key.toLowerCase();
    if (k === 'escape'){ G.placing = false; G.selected = null; }
    else if (k === 'b'){ G.placing = !G.placing; if (G.placing) G.selected = null; }
    else if (k === ' '){ ev.preventDefault(); startWave(); }
    else if (k === 'p'){ G.paused = !G.paused; }
    else if (k === 'f'){ G.fast = !G.fast; }
    else if (k === 'm'){ SFX.toggleMute(); }
    else if (k === 'x' && G.selected){ sellTower(G.selected); }
    else if (k === 't' && G.selected){
      G.selected.mode = ((G.selected.mode || 0) + 1) % TARGET_MODES.length; }
    else if (k >= '1' && k <= '4' && G.selected){ upgrade(G.selected, STATS[+k - 1].key); }
  });

  $('btnStart').onclick = () => {
    SFX.wake();
    el.menu.classList.add('hidden');
    startGame(pick.path, DIFFICULTIES[pick.diff]);
    resize();
  };
  $('btnReset').onclick = () => {
    progress = { won:{} }; saveProgress(); buildMenu();
  };
  $('btnAgain').onclick = () => {
    el.end.classList.add('hidden');
    el.end.classList.remove('lost');
    el.menu.classList.remove('hidden');
    G.mode = 'menu'; G.path = null;
    G.shapes.length = G.towers.length = G.projs.length = G.parts.length = 0;
    buildMenu();
    resize();
  };

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
}

/* ---------------------------- end screen -------------------------- */
let endShown = false;
function checkEnd(){
  if ((G.mode === 'won' || G.mode === 'lost') && !endShown){
    endShown = true;
    G.selected = null; G.hovered = null; G.placing = false;
    el.tip.classList.add('hidden');
    const won = G.mode === 'won';
    el.endTitle.textContent = won ? 'Gray prevails' : 'Overrun';
    el.endText.textContent = won ? WIN_TEXT : LOSE_TEXT;
    el.endStats.textContent =
      PATHS[G.pathIndex].name + ' · ' + G.diff.name + ' · ' +
      'waves ' + G.cleared + '/' + WAVES.length + ' · ' +
      'shapes destroyed ' + G.killed + ' · leaks ' + G.leaked +
      (won ? ' · lives left ' + G.lives : '');
    if (won) markWon(G.pathIndex, G.diff.key);
    SFX.end(won);
    el.end.classList.toggle('lost', !won);
    setTimeout(() => el.end.classList.remove('hidden'), won ? 700 : 2200);
  }
  if (G.mode === 'menu' || G.mode === 'playing') endShown = false;
}
