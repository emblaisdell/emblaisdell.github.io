'use strict';
/* ------------------------------------------------------------------ *
 * Boot + fixed-timestep loop.
 * ------------------------------------------------------------------ */
const STEP = 1/60, MAX_STEPS = 12;
let acc = 0, prev = performance.now(), clock = 0;

function frame(now){
  let dt = (now - prev) / 1000;
  prev = now;
  if (dt > 0.25) dt = 0.25;                 // tab was hidden — don't fast-forward
  clock += dt;

  if (!G.paused) {
    acc += dt * (G.fast ? 2 : 1);
    let n = 0;
    while (acc >= STEP && n++ < MAX_STEPS){ step(STEP); acc -= STEP; }
    if (n >= MAX_STEPS) acc = 0;
  }

  render(clock);
  syncUI();
  checkEnd();
  requestAnimationFrame(frame);
}

buildMenu();
buildPanelRows();
buildReference();
wireInput();
resize();
observeStage();
requestAnimationFrame(frame);
