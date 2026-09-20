/* app.js — library, book trie, and the training loop. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var FILES = 'abcdefgh';
  var SVGNS = 'http://www.w3.org/2000/svg';
  var PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

  /* ── persistence ──────────────────────────────────────────────────────── */
  var KEY = 'opening-trainer.v1';
  var store = { theme: null, done: {}, side: {}, band: 'i' };
  try { store = Object.assign(store, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} }

  /* ── theme ────────────────────────────────────────────────────────────── */
  if (store.theme) document.documentElement.setAttribute('data-theme', store.theme);
  $('theme-toggle').addEventListener('click', function () {
    var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var current = store.theme || (dark ? 'dark' : 'light');
    store.theme = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', store.theme);
    save();
  });

  /* ── book trie ────────────────────────────────────────────────────────── */
  function makeNode(san, ply) {
    return { san: san, ply: ply, children: {}, order: [], lines: [], depth: 0 };
  }

  /* Build a move tree from the chosen variations. Node.depth = longest line below it. */
  function buildTree(lines) {
    var root = makeNode(null, 0);
    lines.forEach(function (line, idx) {
      var node = root;
      line.moves.trim().split(/\s+/).forEach(function (san, i) {
        var kid = node.children[san];
        if (!kid) { kid = node.children[san] = makeNode(san, i + 1); node.order.push(san); }
        if (kid.lines.indexOf(idx) < 0) kid.lines.push(idx);
        node = kid;
      });
    });
    (function depth(node) {
      node.order.forEach(function (san) { depth(node.children[san]); });
      node.depth = node.order.reduce(function (max, san) {
        return Math.max(max, 1 + node.children[san].depth);
      }, 0);
    })(root);
    return root;
  }

  /* How often players in the chosen rating band actually reach the lines below a
     node. Every line gets +1 so rare variations still turn up occasionally. */
  function weightOf(node) {
    var w = 0;
    for (var i = 0; i < node.lines.length; i++) {
      var line = T.pool[node.lines[i]];
      w += ((line.w && line.w[T.band]) || 0) + 1;
    }
    return w;
  }

  /* The book opponent answers with a real move, chosen in proportion to how often
     players at this level play it. */
  function pickChild(node) {
    var total = 0, i, weights = [];
    for (i = 0; i < node.order.length; i++) {
      weights[i] = weightOf(node.children[node.order[i]]);
      total += weights[i];
    }
    var roll = Math.random() * total;
    for (i = 0; i < node.order.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return node.order[i];
    }
    return node.order[node.order.length - 1];
  }

  /* ── notation helpers ─────────────────────────────────────────────────── */
  function notation(sans, from) {
    var out = [], i = from || 0;
    for (; i < sans.length; i++) {
      if (i % 2 === 0) out.push((i / 2 + 1) + '.' + sans[i]);
      else out.push(sans[i]);
    }
    return out.join(' ');
  }

  function sharedPrefix(lines) {
    var seqs = lines.map(function (l) { return l.moves.trim().split(/\s+/); });
    var out = [];
    for (var i = 0; i < seqs[0].length; i++) {
      var san = seqs[0][i];
      if (!seqs.every(function (s) { return s[i] === san; })) break;
      out.push(san);
    }
    return out.length ? out : seqs[0].slice(0, 3);
  }

  function listSans(text) {
    return text.length === 1 ? '<span class="san">' + text[0] + '</span>'
      : text.map(function (s) { return '<span class="san">' + s + '</span>'; })
            .join(', ').replace(/, ([^,]*)$/, ' or $1');
  }

  /* ── library ──────────────────────────────────────────────────────────── */
  var libRows = [];
  var band = BOOK.bands.some(function (x) { return x.id === store.band; }) ? store.band : 'i';

  function bandInfo(id) {
    return BOOK.bands.filter(function (x) { return x.id === id; })[0];
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
  function monthName(ym) {
    var p = ym.split('-');
    return MONTHS[parseInt(p[1], 10) - 1] + ' ' + p[0];
  }
  function thousands(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function percent(share) {
    if (!share) return '—';
    return share < 0.0001 ? '<0.01%' : (share * 100).toFixed(2) + '%';
  }

  /* '1.e4 e5 2.Nf3 Nc6 3.Bc4' from a run of SAN */
  function notation(sans, from) {
    var out = [], i = from || 0;
    for (; i < sans.length; i++) out.push(i % 2 === 0 ? (i / 2 + 1) + '.' + sans[i] : sans[i]);
    return out.join(' ');
  }

  function buildBands() {
    var seg = $('band-seg');
    BOOK.bands.forEach(function (b) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.band = b.id;
      btn.innerHTML = b.label + '<small>' + b.note + '</small>';
      btn.addEventListener('click', function () {
        if (band === b.id) return;
        band = store.band = b.id;
        save();
        applyBand();
        filterLibrary();
      });
      seg.appendChild(btn);
    });
  }

  function buildLibrary() {
    var list = $('lib-list');

    BOOK.openings.forEach(function (op) {
      var row = document.createElement('article');
      row.className = 'op';

      var rank = document.createElement('span');
      rank.className = 'op-rank';

      var main = document.createElement('div');
      main.className = 'op-main';

      var family = document.createElement('p');
      family.className = 'op-family';
      family.textContent = op.family;

      var name = document.createElement('h3');
      name.className = 'op-name';
      name.textContent = op.name === op.family ? 'Main line' : op.name;
      var eco = document.createElement('span');
      eco.className = 'eco';
      eco.textContent = op.eco;
      name.appendChild(eco);
      var chip = document.createElement('span');
      chip.className = 'done-chip';
      name.appendChild(chip);

      var moves = document.createElement('p');
      moves.className = 'op-moves';
      moves.textContent = notation(op.prefix.split(' '));

      var stat = document.createElement('div');
      stat.className = 'op-stat';
      var bar = document.createElement('span');
      bar.className = 'bar';
      var fill = document.createElement('i');
      bar.appendChild(fill);
      var share = document.createElement('span');
      share.className = 'op-share';
      var meta = document.createElement('span');
      meta.className = 'op-meta';
      meta.textContent = op.lines.length + ' lines · to ' + op.depth[1] + ' plies';
      var cross = document.createElement('span');
      cross.className = 'op-cross';
      stat.append(bar, share, meta, cross);

      main.append(family, name, moves, stat);

      var actions = document.createElement('div');
      actions.className = 'op-actions';
      ['w', 'b'].forEach(function (side) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn';
        btn.textContent = side === 'w' ? 'White' : 'Black';
        if (op.side === side) btn.dataset.default = '1';
        btn.setAttribute('aria-label', 'Train ' + op.full + ' as ' + (side === 'w' ? 'White' : 'Black'));
        btn.addEventListener('click', function () { start(op, side, null); });
        actions.appendChild(btn);
      });

      row.append(rank, main, actions);
      list.appendChild(row);

      libRows.push({
        op: op, el: row, chip: chip, rank: rank, fill: fill, share: share, cross: cross,
        hay: (op.full + ' ' + op.eco + ' ' + op.prefix + ' ' +
              op.lines.map(function (l) { return l.name + ' ' + l.moves; }).join(' ')).toLowerCase()
      });
    });

    var g = BOOK.meta.games;
    $('lib-scale').textContent = BOOK.meta.openings + ' openings · ' + BOOK.meta.lines +
      ' lines · ' + thousands(BOOK.meta.plies) + ' plies of book';
  }

  /* Re-rank the list for the selected rating band. */
  function applyBand() {
    var info = bandInfo(band);
    var top = 0;
    libRows.forEach(function (r) { top = Math.max(top, r.op.share[band]); });

    libRows.forEach(function (r) {
      r.rank.textContent = r.op.rank[band];
      r.share.textContent = percent(r.op.share[band]);
      r.fill.style.width = (top ? (r.op.share[band] / top) * 100 : 0) + '%';
      r.cross.textContent = BOOK.bands.filter(function (b) { return b.id !== band; })
        .map(function (b) { return '#' + r.op.rank[b.id] + ' ' + b.label.toLowerCase(); })
        .join(' · ');
      r.el.style.order = r.op.rank[band];
    });

    Array.prototype.forEach.call($('band-seg').children, function (btn) {
      btn.setAttribute('aria-pressed', String(btn.dataset.band === band));
    });

    $('lib-note').textContent = 'Ranked by how often ' + info.label.toLowerCase() +
      ' players (' + info.note + ') reached each opening across ' + thousands(info.games) +
      ' rated Lichess games from ' + monthName(BOOK.meta.games.month) + '.';
  }

  function refreshLibraryStats() {
    var total = 0;
    libRows.forEach(function (row) {
      var n = store.done[row.op.id] || 0;
      total += n;
      row.chip.textContent = n ? '✓ ' + n : '';
      row.chip.hidden = !n;
    });
    $('lib-progress').textContent = total
      ? total + (total === 1 ? ' line completed' : ' lines completed')
      : 'Nothing trained yet';
  }

  function filterLibrary() {
    var q = $('search').value.trim().toLowerCase();
    var shown = 0;
    libRows.forEach(function (row) {
      var hit = !q || row.hay.indexOf(q) >= 0;
      row.el.hidden = !hit;
      if (hit) shown++;
    });
    $('lib-count').textContent = shown + (shown === 1 ? ' opening' : ' openings');
    $('lib-empty').hidden = shown > 0;
  }

  $('search').addEventListener('input', filterLibrary);

  /* ── trainer state ────────────────────────────────────────────────────── */
  var T = {
    opening: null, side: 'w', lineIdx: null, tree: null, node: null,
    game: null, sans: [], flip: false, busy: false, misses: 0, slips: 0,
    revealed: false, forced: null, sel: null, drag: null
  };

  var boardEl = $('board');
  var squares = {};
  var pieceEls = {};

  /* ── board rendering ──────────────────────────────────────────────────── */
  function drawSquares() {
    boardEl.textContent = '';
    squares = {};
    for (var row = 0; row < 8; row++) {
      for (var col = 0; col < 8; col++) {
        var c = T.flip ? 7 - col : col;
        var r = T.flip ? 7 - row : row;
        var name = FILES[c] + (8 - r);
        var sq = document.createElement('div');
        sq.className = 'sq' + ((c + r) % 2 ? ' dark' : '');
        sq.dataset.sq = name;
        if (row === 7) {
          var f = document.createElement('span');
          f.className = 'coord file';
          f.textContent = name[0];
          sq.appendChild(f);
        }
        if (col === 0) {
          var k = document.createElement('span');
          k.className = 'coord rank';
          k.textContent = name[1];
          sq.appendChild(k);
        }
        boardEl.appendChild(sq);
        squares[name] = sq;
      }
    }
    Object.keys(pieceEls).forEach(function (s) { boardEl.appendChild(pieceEls[s]); });
  }

  function place(el, square) {
    var col = FILES.indexOf(square[0]);
    var row = 8 - parseInt(square[1], 10);
    if (T.flip) { col = 7 - col; row = 7 - row; }
    el.style.left = (col * 12.5) + '%';
    el.style.top = (row * 12.5) + '%';
  }

  function makePiece(p) {
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 45 45');
    svg.setAttribute('class', 'pc ' + p.color);
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS(SVGNS, 'use');
    use.setAttribute('href', '#pc-' + p.color + p.type);
    use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#pc-' + p.color + p.type);
    svg.appendChild(use);
    svg.dataset.k = p.color + p.type;
    return svg;
  }

  function reconcile() {
    var seen = {};
    T.game.pieces().forEach(function (p) {
      var el = pieceEls[p.square];
      if (el && el.dataset.k !== p.color + p.type) { el.remove(); el = null; }
      if (!el) {
        el = makePiece(p);
        boardEl.appendChild(el);
        pieceEls[p.square] = el;
      }
      el.classList.remove('dragging');
      place(el, p.square);
      seen[p.square] = true;
    });
    Object.keys(pieceEls).forEach(function (sq) {
      if (!seen[sq]) { pieceEls[sq].remove(); delete pieceEls[sq]; }
    });
  }

  /* Slide the moving piece, then settle the rest (rook jumps, promotions, captures). */
  function animate(move) {
    var el = pieceEls[move.from];
    if (!el) { reconcile(); return; }
    delete pieceEls[move.from];
    var taken = pieceEls[move.to];
    if (taken) { taken.classList.add('fading'); setTimeout(function () { taken.remove(); }, 170); }
    pieceEls[move.to] = el;
    place(el, move.to);
    if (move.piece === 'k' && Math.abs(FILES.indexOf(move.from[0]) - FILES.indexOf(move.to[0])) === 2) {
      var rank = move.from[1];
      var kingside = move.to[0] === 'g';
      var rookFrom = (kingside ? 'h' : 'a') + rank;
      var rookTo = (kingside ? 'f' : 'd') + rank;
      var rook = pieceEls[rookFrom];
      if (rook) { delete pieceEls[rookFrom]; pieceEls[rookTo] = rook; place(rook, rookTo); }
    }
    setTimeout(reconcile, 200);
  }

  function clearMarks(kinds) {
    (kinds || ['sel', 'good', 'bad', 'hint', 'last', 'occupied']).forEach(function (cls) {
      Array.prototype.forEach.call(boardEl.querySelectorAll('.' + cls), function (el) {
        el.classList.remove(cls);
      });
    });
    Array.prototype.forEach.call(boardEl.querySelectorAll('.dot'), function (d) { d.remove(); });
  }

  function mark(square, cls) { if (squares[square]) squares[square].classList.add(cls); }

  function markLast() {
    var last = T.lastMove;
    if (!last) return;
    mark(last.from, 'last');
    mark(last.to, 'last');
  }

  function showTargets(from) {
    T.game.legalMoves().forEach(function (m) {
      if (m.from !== from) return;
      var sq = squares[m.to];
      if (!sq || sq.querySelector('.dot')) return;
      if (T.game.get(m.to) || m.captured) sq.classList.add('occupied');
      var dot = document.createElement('span');
      dot.className = 'dot';
      sq.appendChild(dot);
    });
  }

  function select(square) {
    T.sel = square;
    clearMarks(['sel', 'occupied']);
    markLast();
    mark(square, 'sel');
    showTargets(square);
  }

  function deselect() {
    T.sel = null;
    clearMarks(['sel', 'occupied']);
    markLast();
  }

  /* ── coach ────────────────────────────────────────────────────────────── */
  function say(html, cls) {
    $('coach-text').innerHTML = html;
    $('coach').className = 'coach' + (cls ? ' ' + cls : '');
  }

  function sideWord(c) { return c === 'w' ? 'White' : 'Black'; }

  function updateProgress() {
    var done = T.sans.length;
    var total = done + T.node.depth;
    $('progress-fill').style.width = (total ? (done / total) * 100 : 0) + '%';
    var moves = Math.ceil(total / 2);
    $('progress-text').textContent = 'Move ' + Math.min(Math.floor(done / 2) + 1, moves) + ' of ' + moves;
    var names = currentLineNames();
    $('line-name').textContent = names.length === 1 ? names[0]
      : (T.lineIdx === null ? names.length + ' variations open' : '');
  }

  function currentLineNames() {
    var pool = T.pool;
    return T.node.lines.length ? T.node.lines.map(function (i) { return pool[i].name; })
                               : pool.map(function (l) { return l.name; });
  }

  function renderSheet() {
    var sheet = $('sheet');
    sheet.textContent = '';
    if (!T.sans.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = T.side === 'w' ? 'Play the first move of the opening.'
                                         : 'Waiting for White…';
      sheet.appendChild(empty);
      return;
    }
    for (var i = 0; i < T.sans.length; i += 2) {
      var num = document.createElement('span');
      num.className = 'num';
      num.textContent = (i / 2 + 1) + '.';
      sheet.appendChild(num);
      for (var j = 0; j < 2; j++) {
        var mv = document.createElement('span');
        mv.className = 'mv' + (i + j === T.sans.length - 1 ? ' now' : '');
        mv.textContent = T.sans[i + j] || '';
        sheet.appendChild(mv);
      }
    }
    sheet.scrollTop = sheet.scrollHeight;
  }

  /* ── session ──────────────────────────────────────────────────────────── */
  function start(opening, side, lineIdx) {
    T.opening = opening;
    T.side = side;
    T.lineIdx = lineIdx;
    store.side[opening.id] = side;
    save();

    $('library').hidden = true;
    $('trainer').hidden = false;
    window.scrollTo(0, 0);

    $('tr-name').textContent = opening.name === opening.family ? 'Main line' : opening.name;
    $('tr-family').textContent = opening.family;
    $('tr-eco').textContent = opening.eco;
    $('tr-side-label').textContent = 'as ' + sideWord(side);
    document.title = opening.full + ' — Opening Repertoire Trainer';

    var sel = $('sel-line');
    sel.textContent = '';
    var all = document.createElement('option');
    all.value = '';
    all.textContent = 'All variations (' + opening.lines.length + ')';
    sel.appendChild(all);
    opening.lines.forEach(function (line, i) {
      var opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = line.name;
      sel.appendChild(opt);
    });
    sel.value = lineIdx === null ? '' : String(lineIdx);

    Array.prototype.forEach.call($('side-seg').children, function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.side === side));
    });

    T.flip = side === 'b';
    beginLine(null);
  }

  function beginLine(forced) {
    T.band = band;
    T.pool = T.lineIdx === null ? T.opening.lines : [T.opening.lines[T.lineIdx]];
    T.tree = buildTree(T.pool);
    T.node = T.tree;
    T.game = new Chess();
    T.sans = [];
    T.misses = 0;
    T.slips = 0;
    T.revealed = false;
    T.forced = forced || null;
    T.lastMove = null;
    T.busy = false;
    T.sel = null;

    pieceEls = {};
    drawSquares();
    reconcile();
    clearMarks();
    $('done').hidden = true;
    renderSheet();
    updateProgress();

    if (T.game.turn() === T.side) {
      say('<b>' + sideWord(T.side) + ' to play.</b> Start the opening.', 'turn');
    } else {
      say('Book is thinking…', 'wait');
      T.busy = true;
      setTimeout(playBookMove, 520);
    }
  }

  function playBookMove() {
    var san = (T.forced && T.forced[T.sans.length]) || pickChild(T.node);
    if (!T.node.children[san]) san = pickChild(T.node);
    commit(san);
    if (isLineOver()) { finishLine(); return; }
    T.busy = false;
    var choices = Object.keys(T.node.children).length;
    say('Book plays <span class="san">' + san + '</span>. ' +
        (choices > 1 ? '<b>Your move</b> — ' + choices + ' book answers here.' : '<b>Your move.</b>'), 'turn');
  }

  function commit(san) {
    var move = T.game.move(san);
    T.node = T.node.children[san];
    T.sans.push(san);
    T.lastMove = move;
    animate(move);
    clearMarks();
    markLast();
    renderSheet();
    updateProgress();
    return move;
  }

  function isLineOver() { return T.node.order.length === 0; }

  function finishLine() {
    T.busy = true;
    var names = currentLineNames();
    $('done-name').textContent = names[0] || T.opening.full;
    var played = Math.ceil(T.sans.length / 2);
    $('done-stat').innerHTML = T.slips === 0
      ? 'Perfect — every move straight from the book, all <b>' + played + '</b> of them.'
      : 'You played <b>' + played + '</b> moves with <b>' + T.slips +
        (T.slips === 1 ? '</b> slip.' : '</b> slips.');
    store.done[T.opening.id] = (store.done[T.opening.id] || 0) + 1;
    save();
    refreshLibraryStats();
    setTimeout(function () { $('done').hidden = false; $('done-next').focus(); }, 420);
  }

  /* ── player input ─────────────────────────────────────────────────────── */
  function attempt(from, to, promotion) {
    var options = T.game.legalMoves().filter(function (m) {
      return m.from === from && m.to === to;
    });
    if (!options.length) { deselect(); reconcile(); return false; }
    if (options.length > 1 && !promotion) { askPromotion(from, to); return true; }
    var move = promotion
      ? options.filter(function (m) { return m.promotion === promotion; })[0]
      : options[0];

    deselect();

    if (T.node.children[move.san]) {
      T.misses = 0;
      T.revealed = false;
      commit(move.san);
      mark(move.from, 'good');
      mark(move.to, 'good');
      if (isLineOver()) { finishLine(); return true; }
      say('<span class="san">' + move.san + '</span> — straight from the book.', 'good');
      T.busy = true;
      setTimeout(playBookMove, 620);
      return true;
    }

    /* Wrong move: show it, then take it back. */
    T.misses++;
    T.slips++;
    T.busy = true;
    var previousLast = T.lastMove;
    var played = T.game.move(move.san);
    T.lastMove = played;
    animate(played);
    clearMarks();
    mark(move.from, 'bad');
    mark(move.to, 'bad');

    var book = Object.keys(T.node.children);
    if (T.misses === 1) {
      say('<span class="san">' + move.san + '</span> is not the book move here. Try again.', 'bad');
    } else if (T.misses === 2) {
      say('<span class="san">' + move.san + '</span> is off book too. Here is a nudge.', 'bad');
    } else {
      say('The move is ' + listSans(book) + '. Play it to carry on.', 'bad');
    }

    setTimeout(function () {
      T.game.undo();
      T.lastMove = previousLast;
      reconcile();
      clearMarks();
      markLast();
      if (T.misses >= 2) hint(T.misses >= 3);
      T.busy = false;
    }, 760);
    return false;
  }

  function hint(full) {
    var book = Object.keys(T.node.children);
    var moves = T.game.legalMoves();
    clearMarks(['hint']);
    book.forEach(function (san) {
      var m = moves.filter(function (x) { return x.san === san; })[0];
      if (!m) return;
      mark(m.from, 'hint');
      if (full) mark(m.to, 'hint');
    });
    if (full) {
      T.revealed = true;
      say('The move is ' + listSans(book) + '. Play it to carry on.', 'bad');
    } else if (book.length === 1) {
      var m1 = moves.filter(function (x) { return x.san === book[0]; })[0];
      say('Hint: move the <b>' + PIECE_NAMES[m1.piece] + '</b> on <span class="san">' + m1.from + '</span>.', 'bad');
    } else {
      say('Hint: ' + book.length + ' moves are playable here — the pieces are marked.', 'bad');
    }
  }

  /* ── promotion ────────────────────────────────────────────────────────── */
  function askPromotion(from, to) {
    var promo = $('promo');
    promo.textContent = '';
    var card = document.createElement('div');
    card.className = 'promo-card';
    ['q', 'r', 'b', 'n'].forEach(function (type) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Promote to ' + PIECE_NAMES[type]);
      var svg = makePiece({ type: type, color: T.side });
      svg.classList.remove('pc');
      svg.setAttribute('class', 'pc ' + T.side);
      btn.appendChild(svg);
      btn.addEventListener('click', function () {
        promo.hidden = true;
        attempt(from, to, type);
      });
      card.appendChild(btn);
    });
    promo.appendChild(card);
    promo.hidden = false;
  }

  /* ── pointer handling (tap-tap and drag both work) ────────────────────── */
  function squareAt(x, y) {
    var r = boardEl.getBoundingClientRect();
    if (x < r.left || y < r.top || x >= r.right || y >= r.bottom) return null;
    var col = Math.floor((x - r.left) / (r.width / 8));
    var row = Math.floor((y - r.top) / (r.height / 8));
    if (T.flip) { col = 7 - col; row = 7 - row; }
    return FILES[Math.min(7, Math.max(0, col))] + (8 - Math.min(7, Math.max(0, row)));
  }

  function myPieceAt(square) {
    var p = T.game.get(square);
    return p && p.color === T.side ? p : null;
  }

  boardEl.addEventListener('pointerdown', function (ev) {
    if (T.busy || T.game.turn() !== T.side) return;
    var square = squareAt(ev.clientX, ev.clientY);
    if (!square) return;

    if (T.sel && T.sel !== square && !myPieceAt(square)) {
      ev.preventDefault();
      attempt(T.sel, square);
      return;
    }
    if (!myPieceAt(square)) { deselect(); return; }

    ev.preventDefault();
    boardEl.setPointerCapture(ev.pointerId);
    if (T.sel === square) { deselect(); T.drag = null; return; }
    select(square);
    T.drag = { from: square, id: ev.pointerId, x: ev.clientX, y: ev.clientY, moved: false, el: pieceEls[square] };
  });

  boardEl.addEventListener('pointermove', function (ev) {
    var d = T.drag;
    if (!d || ev.pointerId !== d.id || !d.el) return;
    if (!d.moved && Math.abs(ev.clientX - d.x) + Math.abs(ev.clientY - d.y) < 5) return;
    d.moved = true;
    d.el.classList.add('dragging');
    var r = boardEl.getBoundingClientRect();
    d.el.style.left = ((ev.clientX - r.left) / r.width * 100 - 6.25) + '%';
    d.el.style.top = ((ev.clientY - r.top) / r.height * 100 - 6.25) + '%';
  });

  function endDrag(ev) {
    var d = T.drag;
    if (!d || ev.pointerId !== d.id) return;
    T.drag = null;
    if (d.el) d.el.classList.remove('dragging');
    if (!d.moved) return;                       /* a tap: keep the selection */
    var target = squareAt(ev.clientX, ev.clientY);
    if (!target || target === d.from) { deselect(); reconcile(); return; }
    attempt(d.from, target);
  }

  boardEl.addEventListener('pointerup', endDrag);
  boardEl.addEventListener('pointercancel', function (ev) {
    if (T.drag && ev.pointerId === T.drag.id) { T.drag = null; deselect(); reconcile(); }
  });

  /* ── controls ─────────────────────────────────────────────────────────── */
  $('btn-hint').addEventListener('click', function () {
    if (T.busy || T.game.turn() !== T.side) return;
    hint(false);
  });
  $('btn-show').addEventListener('click', function () {
    if (T.busy || T.game.turn() !== T.side) return;
    if (!T.revealed) T.slips++;
    hint(true);
  });
  $('btn-restart').addEventListener('click', function () { beginLine(T.forced); });
  $('flip').addEventListener('click', function () {
    T.flip = !T.flip;
    drawSquares();
    reconcile();
    markLast();
  });
  $('back').addEventListener('click', function () {
    $('trainer').hidden = true;
    $('library').hidden = false;
    document.title = 'Opening Repertoire Trainer';
    refreshLibraryStats();
  });
  $('sel-line').addEventListener('change', function () {
    T.lineIdx = this.value === '' ? null : parseInt(this.value, 10);
    beginLine(null);
  });
  Array.prototype.forEach.call($('side-seg').children, function (btn) {
    btn.addEventListener('click', function () {
      if (btn.dataset.side === T.side) return;
      start(T.opening, btn.dataset.side, T.lineIdx);
    });
  });
  $('done-next').addEventListener('click', function () { beginLine(null); });
  $('done-again').addEventListener('click', function () { beginLine(T.sans.slice()); });
  $('done-back').addEventListener('click', function () { $('back').click(); $('done').hidden = true; });

  /* ── boot ─────────────────────────────────────────────────────────────── */
  buildBands();
  buildLibrary();
  applyBand();
  refreshLibraryStats();
  filterLibrary();
})();
