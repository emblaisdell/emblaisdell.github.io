/* ui.js — DOM glue: mode buttons, level/move readouts, win overlay. */
(function (W) {
  'use strict';
  var canvas = document.getElementById('board');
  var game = new W.Game(canvas);
  W.__game = game; // test/debug hook

  var elLevel = document.getElementById('level');
  var elMoves = document.getElementById('moves');
  var elWin = document.getElementById('win');
  var elWinMoves = document.getElementById('win-moves');
  var elLose = document.getElementById('lose');

  function refresh(state) {
    // instrument readouts: bare numbers (labels live in the HUD markup); the
    // active mode is shown by the colour-keyed tab, not repeated here.
    elLevel.textContent = state.level;
    elMoves.textContent = state.moves;
    if (state.solved) {
      elWinMoves.textContent = state.moves;   // win panel mirrors the HUD readout
      elWin.classList.remove('hidden');
    } else {
      elWin.classList.add('hidden');
    }
    elLose.classList.toggle('hidden', !state.lost);
  }
  game.onChange = refresh;
  refresh(game.state);

  // mode buttons
  var modeBtns = document.querySelectorAll('.mode');
  Array.prototype.forEach.call(modeBtns, function (btn) {
    btn.addEventListener('click', function () {
      Array.prototype.forEach.call(modeBtns, function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      game.setMode(btn.getAttribute('data-mode'));
    });
  });

  // Mute toggle.  Same speaker body in both states; only the right-hand glyph
  // changes, so the button does not appear to jump between two different icons.
  var A = W.audio;
  var elMute = document.getElementById('mute');
  var SPK = '<path d="M3 9.5v5h3.2L11 18.5V5.5L6.2 9.5z" fill="currentColor"/>';
  var WAVES = '<path d="M14 9.2a4 4 0 0 1 0 5.6M16.6 7a7 7 0 0 1 0 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';
  var SLASH = '<path d="M14.5 9.5l5 5M19.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';

  function renderMute() {
    var off = A.isMuted();
    elMute.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
      SPK + (off ? SLASH : WAVES) + '</svg>';
    elMute.setAttribute('aria-pressed', String(off));
    elMute.setAttribute('aria-label', off ? 'Unmute sound' : 'Mute sound');
    elMute.setAttribute('title', off ? 'Unmute sound' : 'Mute sound');
  }
  elMute.addEventListener('click', function () {
    A.setMuted(!A.isMuted());
    renderMute();
    if (!A.isMuted()) { A.unlock(); A.pop(); }  // a blip confirms sound is back
  });
  renderMute();

  document.getElementById('reset').addEventListener('click', function () { game.reset(); });
  document.getElementById('next').addEventListener('click', function () { game.nextLevel(); });
  document.getElementById('again').addEventListener('click', function () { game.replay(); });
  document.getElementById('retry').addEventListener('click', function () { game.replay(); });
  document.getElementById('newlevel').addEventListener('click', function () { game.reset(); });
})(window.Wang = window.Wang || {});
