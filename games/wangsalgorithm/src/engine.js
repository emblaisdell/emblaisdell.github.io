/*
 * engine.js — mutable game state and the three legal moves.
 *
 * State shape:
 *   {
 *     mode, level, moves, solved,
 *     rows: [ { id, mols: [ { id, m } ], birth, dying } ]
 *   }
 *
 * Moves correspond to the one-sided sequent calculus rules.  All three are
 * invertible, so a level generated as solvable can never become unsolvable.
 */
(function (root) {
  'use strict';
  var L = root.logic;

  var _id = 0;
  function uid() { return ++_id; }

  function makeRow(molecules, now) {
    return {
      id: uid(),
      mols: molecules.map(function (m) { return { id: uid(), m: m }; }),
      birth: now,
      dying: false
    };
  }

  function newGame(mode, level, now) {
    var rows = L.generateLevel(mode, level).map(function (r) {
      return makeRow(r, now);
    });
    return { mode: mode, level: level, moves: 0, solved: false, rows: rows };
  }

  function rowSolved(state) {
    if (state.rows.length === 0) { state.solved = true; }
    return state.solved;
  }

  // --- |-OR rule:  |- G, A or B   ==>   |- G, A, B
  // Replace an 'or' molecule with its two children in the same row.
  function dissolveOr(state, rowIndex, molIndex) {
    var row = state.rows[rowIndex];
    var entry = row.mols[molIndex];
    if (!entry || entry.m.t !== 'or') return false;
    var a = { id: uid(), m: entry.m.a };
    var b = { id: uid(), m: entry.m.b };
    row.mols.splice(molIndex, 1, a, b);
    state.moves++;
    return true;
  }

  // --- |-AND rule:  |- G, A and B   ==>   |- G, A   and   |- G, B
  // Duplicate the row; one copy keeps child A, the other keeps child B.
  function splitAnd(state, rowIndex, molIndex, now) {
    var row = state.rows[rowIndex];
    var entry = row.mols[molIndex];
    if (!entry || entry.m.t !== 'and') return false;

    var topMols = row.mols.map(function (e, i) {
      return { id: uid(), m: i === molIndex ? e.m.a : L.clone(e.m) };
    });
    var botMols = row.mols.map(function (e, i) {
      return { id: uid(), m: i === molIndex ? e.m.b : L.clone(e.m) };
    });

    // Both rows are reissued with fresh ids; the controller (game.js) hands
    // each copy the motion of the molecule it came from so nothing jumps.
    var top = { id: uid(), mols: topMols, birth: now, dying: false };
    var bot = { id: uid(), mols: botMols, birth: now, dying: false };
    state.rows.splice(rowIndex, 1, top, bot);
    state.moves++;
    return true;
  }

  // --- axiom:  |- G, p, ~p  closes (the whole row is removed).
  // Returns the matching partner index (for animation) or -1 if no partner.
  function findAnnihilationPartner(state, rowIndex, molIndex) {
    var row = state.rows[rowIndex];
    var entry = row.mols[molIndex];
    if (!entry || entry.m.t !== 'lit') return -1;
    var me = entry.m;
    for (var i = 0; i < row.mols.length; i++) {
      if (i === molIndex) continue;
      var o = row.mols[i].m;
      if (o.t === 'lit' && o.color === me.color && o.pol !== me.pol) return i;
    }
    return -1;
  }

  function annihilateRow(state, rowIndex) {
    state.rows.splice(rowIndex, 1);
    state.moves++;
    return rowSolved(state);
  }

  // Delete a single molecule from its row (right-click "weakening").  If the
  // row becomes empty it is removed.  Does NOT mark the level solved — an empty
  // board reached by deleting formulas is not a proof.
  //
  // The player LOSES if this makes the level unwinnable: by completeness a row
  // (sequent) is provable iff its disjunction is a tautology, so deleting a
  // molecule whose row no longer ORs to 0xFF strands an unclosable row.
  function deleteMolecule(state, rowIndex, molIndex) {
    var row = state.rows[rowIndex];
    if (!row || !row.mols[molIndex]) return false;
    var remaining = 0; // disjunction of the row without the deleted molecule
    for (var i = 0; i < row.mols.length; i++) {
      if (i !== molIndex) remaining |= L.byteOf(row.mols[i].m);
    }
    row.mols.splice(molIndex, 1);
    if (row.mols.length === 0) state.rows.splice(rowIndex, 1);
    state.moves++;
    if ((remaining & 0xFF) !== 0xFF) state.lost = true;
    return true;
  }

  root.engine = {
    newGame: newGame,
    makeRow: makeRow,
    rowSolved: rowSolved,
    dissolveOr: dissolveOr,
    splitAnd: splitAnd,
    findAnnihilationPartner: findAnnihilationPartner,
    annihilateRow: annihilateRow,
    deleteMolecule: deleteMolecule
  };
})(window.Wang = window.Wang || {});
