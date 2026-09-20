/* chess.js — minimal 0x88 chess engine (legal move generation + SAN).
   No dependencies. Exposes global `Chess`. Also works under Node for tests. */
(function (root) {
  'use strict';

  var WHITE = 'w', BLACK = 'b';
  var PAWN = 'p', KNIGHT = 'n', BISHOP = 'b', ROOK = 'r', QUEEN = 'q', KING = 'k';

  // Board is 0x88: index 0 == a8, index 119 == h1.
  var PAWN_OFFSETS = { w: [-16, -32, -17, -15], b: [16, 32, 17, 15] };
  var PIECE_OFFSETS = {
    n: [-18, -33, -31, -14, 18, 33, 31, 14],
    b: [-17, -15, 17, 15],
    r: [-16, 1, 16, -1],
    q: [-17, -16, -15, 1, 17, 16, 15, -1],
    k: [-17, -16, -15, 1, 17, 16, 15, -1]
  };

  var BITS = {
    NORMAL: 1, CAPTURE: 2, BIG_PAWN: 4, EP_CAPTURE: 8,
    PROMOTION: 16, KSIDE_CASTLE: 32, QSIDE_CASTLE: 64
  };

  var SECOND_RANK = { w: 6, b: 1 };

  var ROOKS = {
    w: [{ square: 119, flag: BITS.KSIDE_CASTLE }, { square: 112, flag: BITS.QSIDE_CASTLE }],
    b: [{ square: 7, flag: BITS.KSIDE_CASTLE }, { square: 0, flag: BITS.QSIDE_CASTLE }]
  };

  function rank(sq) { return sq >> 4; }
  function file(sq) { return sq & 15; }
  function swapColor(c) { return c === WHITE ? BLACK : WHITE; }
  function algebraic(sq) { return 'abcdefgh'.charAt(file(sq)) + (8 - rank(sq)); }
  function squareIndex(name) {
    var f = 'abcdefgh'.indexOf(name.charAt(0));
    var r = 8 - parseInt(name.charAt(1), 10);
    if (f < 0 || r < 0 || r > 7) return -1;
    return r * 16 + f;
  }

  function Chess() { this.reset(); }

  Chess.prototype.reset = function () {
    this.board = new Array(128);
    for (var i = 0; i < 128; i++) this.board[i] = null;
    var back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
    for (var f = 0; f < 8; f++) {
      this.board[f] = { type: back[f], color: BLACK };
      this.board[16 + f] = { type: PAWN, color: BLACK };
      this.board[96 + f] = { type: PAWN, color: WHITE };
      this.board[112 + f] = { type: back[f], color: WHITE };
    }
    this.kings = { w: 116, b: 4 };
    this.turnColor = WHITE;
    this.castling = { w: BITS.KSIDE_CASTLE | BITS.QSIDE_CASTLE, b: BITS.KSIDE_CASTLE | BITS.QSIDE_CASTLE };
    this.epSquare = -1;
    this.halfMoves = 0;
    this.moveNumber = 1;
    this.historyStack = [];
  };

  Chess.prototype.turn = function () { return this.turnColor; };

  Chess.prototype.get = function (name) {
    var sq = squareIndex(name);
    return sq < 0 ? null : this.board[sq];
  };

  /* All pieces on the board as { square: 'e4', type: 'p', color: 'w' }. */
  Chess.prototype.pieces = function () {
    var out = [];
    for (var i = 0; i < 128; i++) {
      if (i & 0x88) { i += 7; continue; }
      if (this.board[i]) out.push({ square: algebraic(i), type: this.board[i].type, color: this.board[i].color });
    }
    return out;
  };

  Chess.prototype.attacked = function (color, square) {
    for (var i = 0; i < 128; i++) {
      if (i & 0x88) { i += 7; continue; }
      var piece = this.board[i];
      if (!piece || piece.color !== color) continue;
      if (piece.type === PAWN) {
        var caps = color === WHITE ? [-17, -15] : [17, 15];
        if (i + caps[0] === square || i + caps[1] === square) return true;
        continue;
      }
      var offsets = PIECE_OFFSETS[piece.type];
      var single = (piece.type === KNIGHT || piece.type === KING);
      for (var j = 0; j < offsets.length; j++) {
        var sq = i;
        while (true) {
          sq += offsets[j];
          if (sq & 0x88) break;
          if (sq === square) return true;
          if (this.board[sq]) break;
          if (single) break;
        }
      }
    }
    return false;
  };

  Chess.prototype.inCheck = function () {
    return this.attacked(swapColor(this.turnColor), this.kings[this.turnColor]);
  };

  Chess.prototype.buildMove = function (from, to, flags, promotion) {
    var move = {
      color: this.turnColor, from: from, to: to, flags: flags,
      piece: this.board[from].type
    };
    if (promotion) { move.flags |= BITS.PROMOTION; move.promotion = promotion; }
    if (this.board[to]) move.captured = this.board[to].type;
    else if (flags & BITS.EP_CAPTURE) move.captured = PAWN;
    return move;
  };

  Chess.prototype.generateMoves = function (opts) {
    var self = this;
    var legal = !(opts && opts.legal === false);
    var moves = [];

    function add(from, to, flags) {
      if (self.board[from].type === PAWN && (rank(to) === 0 || rank(to) === 7)) {
        var promos = [QUEEN, ROOK, BISHOP, KNIGHT];
        for (var p = 0; p < 4; p++) moves.push(self.buildMove(from, to, flags, promos[p]));
      } else {
        moves.push(self.buildMove(from, to, flags));
      }
    }

    var us = this.turnColor, them = swapColor(us);

    for (var i = 0; i < 128; i++) {
      if (i & 0x88) { i += 7; continue; }
      var piece = this.board[i];
      if (!piece || piece.color !== us) continue;

      if (piece.type === PAWN) {
        var one = i + PAWN_OFFSETS[us][0];
        if (!(one & 0x88) && !this.board[one]) {
          add(i, one, BITS.NORMAL);
          var two = i + PAWN_OFFSETS[us][1];
          if (SECOND_RANK[us] === rank(i) && !this.board[two]) add(i, two, BITS.BIG_PAWN);
        }
        for (var c = 2; c < 4; c++) {
          var target = i + PAWN_OFFSETS[us][c];
          if (target & 0x88) continue;
          if (this.board[target] && this.board[target].color === them) add(i, target, BITS.CAPTURE);
          else if (target === this.epSquare) add(i, target, BITS.EP_CAPTURE);
        }
      } else {
        var offsets = PIECE_OFFSETS[piece.type];
        var single = (piece.type === KNIGHT || piece.type === KING);
        for (var j = 0; j < offsets.length; j++) {
          var sq = i;
          while (true) {
            sq += offsets[j];
            if (sq & 0x88) break;
            if (!this.board[sq]) {
              add(i, sq, BITS.NORMAL);
            } else {
              if (this.board[sq].color !== us) add(i, sq, BITS.CAPTURE);
              break;
            }
            if (single) break;
          }
        }
      }
    }

    // Castling
    var k = this.kings[us];
    if (k !== -1 && this.castling[us]) {
      if (this.castling[us] & BITS.KSIDE_CASTLE) {
        if (!this.board[k + 1] && !this.board[k + 2] &&
            !this.attacked(them, k) && !this.attacked(them, k + 1) && !this.attacked(them, k + 2)) {
          add(k, k + 2, BITS.KSIDE_CASTLE);
        }
      }
      if (this.castling[us] & BITS.QSIDE_CASTLE) {
        if (!this.board[k - 1] && !this.board[k - 2] && !this.board[k - 3] &&
            !this.attacked(them, k) && !this.attacked(them, k - 1) && !this.attacked(them, k - 2)) {
          add(k, k - 2, BITS.QSIDE_CASTLE);
        }
      }
    }

    if (!legal) return moves;

    var out = [];
    for (var m = 0; m < moves.length; m++) {
      this.makeMove(moves[m]);
      // after makeMove the turn has flipped; check the mover's king
      if (!this.attacked(swapColor(us), this.kings[us])) out.push(moves[m]);
      this.undoMove();
    }
    return out;
  };

  function disambiguator(move, moves) {
    var sameRank = 0, sameFile = 0, ambiguous = 0;
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      if (m.piece === move.piece && m.to === move.to && m.from !== move.from) {
        ambiguous++;
        if (rank(m.from) === rank(move.from)) sameRank++;
        if (file(m.from) === file(move.from)) sameFile++;
      }
    }
    if (!ambiguous) return '';
    var from = algebraic(move.from);
    if (sameRank > 0 && sameFile > 0) return from;
    if (sameFile > 0) return from.charAt(1);
    return from.charAt(0);
  }

  Chess.prototype.moveToSan = function (move, moves) {
    var out;
    if (move.flags & BITS.KSIDE_CASTLE) out = 'O-O';
    else if (move.flags & BITS.QSIDE_CASTLE) out = 'O-O-O';
    else {
      out = '';
      if (move.piece !== PAWN) out += move.piece.toUpperCase() + disambiguator(move, moves);
      if (move.flags & (BITS.CAPTURE | BITS.EP_CAPTURE)) {
        if (move.piece === PAWN) out += algebraic(move.from).charAt(0);
        out += 'x';
      }
      out += algebraic(move.to);
      if (move.flags & BITS.PROMOTION) out += '=' + move.promotion.toUpperCase();
    }
    this.makeMove(move);
    if (this.inCheck()) out += this.generateMoves().length === 0 ? '#' : '+';
    this.undoMove();
    return out;
  };

  Chess.prototype.makeMove = function (move) {
    var us = this.turnColor, them = swapColor(us);
    this.historyStack.push({
      move: move,
      kings: { w: this.kings.w, b: this.kings.b },
      turn: this.turnColor,
      castling: { w: this.castling.w, b: this.castling.b },
      epSquare: this.epSquare,
      halfMoves: this.halfMoves,
      moveNumber: this.moveNumber
    });

    this.board[move.to] = this.board[move.from];
    this.board[move.from] = null;

    if (move.flags & BITS.EP_CAPTURE) {
      this.board[us === BLACK ? move.to - 16 : move.to + 16] = null;
    }
    if (move.flags & BITS.PROMOTION) {
      this.board[move.to] = { type: move.promotion, color: us };
    }
    if (this.board[move.to].type === KING) {
      this.kings[us] = move.to;
      if (move.flags & BITS.KSIDE_CASTLE) {
        this.board[move.to - 1] = this.board[move.to + 1];
        this.board[move.to + 1] = null;
      } else if (move.flags & BITS.QSIDE_CASTLE) {
        this.board[move.to + 1] = this.board[move.to - 2];
        this.board[move.to - 2] = null;
      }
      this.castling[us] = 0;
    }

    if (this.castling[us]) {
      for (var i = 0; i < 2; i++) {
        if (move.from === ROOKS[us][i].square && (this.castling[us] & ROOKS[us][i].flag)) {
          this.castling[us] ^= ROOKS[us][i].flag; break;
        }
      }
    }
    if (this.castling[them]) {
      for (var j = 0; j < 2; j++) {
        if (move.to === ROOKS[them][j].square && (this.castling[them] & ROOKS[them][j].flag)) {
          this.castling[them] ^= ROOKS[them][j].flag; break;
        }
      }
    }

    if (move.flags & BITS.BIG_PAWN) {
      this.epSquare = us === BLACK ? move.to - 16 : move.to + 16;
    } else {
      this.epSquare = -1;
    }

    if (move.piece === PAWN || (move.flags & (BITS.CAPTURE | BITS.EP_CAPTURE))) this.halfMoves = 0;
    else this.halfMoves++;
    if (us === BLACK) this.moveNumber++;
    this.turnColor = them;
  };

  Chess.prototype.undoMove = function () {
    var old = this.historyStack.pop();
    if (!old) return null;
    var move = old.move;
    this.kings = old.kings;
    this.turnColor = old.turn;
    this.castling = old.castling;
    this.epSquare = old.epSquare;
    this.halfMoves = old.halfMoves;
    this.moveNumber = old.moveNumber;

    var us = this.turnColor, them = swapColor(us);

    this.board[move.from] = this.board[move.to];
    this.board[move.from].type = move.piece; // undo promotion
    this.board[move.to] = null;

    if (move.flags & BITS.EP_CAPTURE) {
      this.board[us === BLACK ? move.to - 16 : move.to + 16] = { type: PAWN, color: them };
    } else if (move.captured) {
      this.board[move.to] = { type: move.captured, color: them };
    }

    if (move.flags & (BITS.KSIDE_CASTLE | BITS.QSIDE_CASTLE)) {
      if (move.flags & BITS.KSIDE_CASTLE) {
        this.board[move.to + 1] = this.board[move.to - 1];
        this.board[move.to - 1] = null;
      } else {
        this.board[move.to - 2] = this.board[move.to + 1];
        this.board[move.to + 1] = null;
      }
    }
    return move;
  };

  function cleanSan(san) { return String(san).replace(/[+#?!]+$/, '').replace(/0/g, 'O'); }

  /* Legal moves, as verbose objects with SAN attached. */
  Chess.prototype.legalMoves = function () {
    var moves = this.generateMoves();
    var out = [];
    for (var i = 0; i < moves.length; i++) {
      out.push({
        san: this.moveToSan(moves[i], moves),
        from: algebraic(moves[i].from),
        to: algebraic(moves[i].to),
        piece: moves[i].piece,
        color: moves[i].color,
        promotion: moves[i].promotion || null,
        captured: moves[i].captured || null,
        _raw: moves[i]
      });
    }
    return out;
  };

  /* move('Nf3') or move({ from:'g1', to:'f3', promotion:'q' }) -> verbose move or null */
  Chess.prototype.move = function (input) {
    var candidates = this.legalMoves();
    var found = null, i;
    if (typeof input === 'string') {
      var want = cleanSan(input);
      for (i = 0; i < candidates.length; i++) {
        if (cleanSan(candidates[i].san) === want) { found = candidates[i]; break; }
      }
    } else if (input) {
      for (i = 0; i < candidates.length; i++) {
        if (candidates[i].from === input.from && candidates[i].to === input.to &&
            (!candidates[i].promotion || candidates[i].promotion === (input.promotion || 'q'))) {
          found = candidates[i]; break;
        }
      }
    }
    if (!found) return null;
    this.makeMove(found._raw);
    return found;
  };

  Chess.prototype.undo = function () { return this.undoMove(); };

  Chess.prototype.isCheckmate = function () { return this.inCheck() && this.generateMoves().length === 0; };
  Chess.prototype.isStalemate = function () { return !this.inCheck() && this.generateMoves().length === 0; };

  Chess.prototype.fen = function () {
    var out = '', empty = 0;
    for (var i = 0; i < 128; i++) {
      if (i & 0x88) { if (empty) { out += empty; empty = 0; } if (i !== 120) out += '/'; i += 7; continue; }
      if (!this.board[i]) empty++;
      else {
        if (empty) { out += empty; empty = 0; }
        var t = this.board[i].type;
        out += this.board[i].color === WHITE ? t.toUpperCase() : t;
      }
    }
    if (empty) out += empty;
    var cast = '';
    if (this.castling.w & BITS.KSIDE_CASTLE) cast += 'K';
    if (this.castling.w & BITS.QSIDE_CASTLE) cast += 'Q';
    if (this.castling.b & BITS.KSIDE_CASTLE) cast += 'k';
    if (this.castling.b & BITS.QSIDE_CASTLE) cast += 'q';
    return [out, this.turnColor, cast || '-', this.epSquare >= 0 ? algebraic(this.epSquare) : '-',
            this.halfMoves, this.moveNumber].join(' ');
  };

  Chess.squareIndex = squareIndex;
  Chess.algebraic = algebraic;

  if (typeof module !== 'undefined' && module.exports) module.exports = Chess;
  root.Chess = Chess;
})(typeof window !== 'undefined' ? window : globalThis);
