// Site-wide theme controller. Loaded as a small *blocking* <script> in each
// page's <head> (before the stylesheet) so the theme class is on <html> before
// first paint — no flash. No JS at all → the markup's default class
// (theme-academic) stands.
//
// Behavior:
//   • Fresh visit (new tab / no session)  → random theme.
//   • Navigating within the site          → same theme (kept in sessionStorage).
//   • Refresh / reload                     → reshuffle to a new random theme.
//   • "cycle theme" button                → step to the next theme, in order.
(function () {
  var ORDER = ['theme-academic', 'theme-bootstrap', 'theme-vibe', 'theme-calligraphic'];
  var NAMES = {
    'theme-academic': 'Academic',
    'theme-bootstrap': 'Bootstrap 2012',
    'theme-vibe': 'Vibe Glow',
    'theme-calligraphic': 'Calligraphic'
  };
  var KEY = 'site-theme';

  function rand() { return ORDER[Math.floor(Math.random() * ORDER.length)]; }
  function read() { try { return sessionStorage.getItem(KEY); } catch (e) { return null; } }
  function write(t) { try { sessionStorage.setItem(KEY, t); } catch (e) {} }

  function isReload() {
    try {
      var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
      if (nav && nav.type) return nav.type === 'reload';
      if (performance.navigation) return performance.navigation.type === 1;  // legacy: 1 === reload
    } catch (e) {}
    return false;
  }

  // ---- Decide and apply the theme now (runs in <head>, before paint) ----
  var theme;
  if (isReload()) {
    theme = rand();           // refresh → new random theme
    write(theme);
  } else {
    theme = read();           // navigation within the session → keep
    if (!theme) { theme = rand(); write(theme); }  // fresh visit → random
  }
  if (ORDER.indexOf(theme) < 0) theme = 'theme-academic';
  document.documentElement.className = theme;

  // ---- Label + "cycle theme" control (needs the DOM) ----
  function current() {
    var c = (document.documentElement.className || '').trim();
    return ORDER.indexOf(c) >= 0 ? c : 'theme-academic';
  }
  function setLabel() {
    var el = document.getElementById('theme-name');
    if (el) el.textContent = 'theme: ' + (NAMES[current()] || current());
  }
  function applyManual(t) {
    document.documentElement.className = t;  // swap class, no reload → scroll stays put
    write(t);                                // keep it as we navigate this session
    setLabel();
  }
  function wire() {
    setLabel();
    var btn = document.getElementById('theme-cycle');
    if (btn) btn.addEventListener('click', function () {
      var i = ORDER.indexOf(current());
      applyManual(ORDER[(i + 1) % ORDER.length]);
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
