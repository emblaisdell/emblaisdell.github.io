/*
 * logic.js — the propositional / sequent-calculus core of Wang's Algorithm.
 *
 * A "molecule" is a formula in negation-normal form built from:
 *   - literals  : {t:'lit', color:0|1|2, pol:true|false}   (pol=true is positive)
 *   - or  nodes : {t:'or',  a, b}   (horizontal bar  =  disjunction)
 *   - and nodes : {t:'and', a, b}   (vertical   bar  =  conjunction)
 *
 * The three colors are the three propositional variables.  With three
 * variables there are 2^3 = 8 truth assignments, so a formula's complete
 * truth table fits in a single byte.  Disjunction is bitwise OR, conjunction
 * is bitwise AND, negation is bitwise NOT (masked to 8 bits).
 *
 * A row is a sequent  |- M1, M2, ... .  By soundness/completeness of the
 * one-sided sequent calculus it is provable iff the disjunction of its
 * molecules is a tautology, i.e. iff its byte equals 0xFF.
 */
(function (root) {
  'use strict';

  // Colors / variables.
  var RED = 0, GREEN = 1, BLUE = 2;
  var COLORS = [RED, GREEN, BLUE];

  // Truth-table column for each positive literal over the 8 assignments,
  // where assignment i sets RED=bit0(i), GREEN=bit1(i), BLUE=bit2(i).
  //   RED   true on i in {1,3,5,7}  -> 0b10101010 = 0xAA
  //   GREEN true on i in {2,3,6,7}  -> 0b11001100 = 0xCC
  //   BLUE  true on i in {4,5,6,7}  -> 0b11110000 = 0xF0
  var COLOR_BYTE = [0xAA, 0xCC, 0xF0];

  // ----- constructors -------------------------------------------------------
  function lit(color, pol) { return { t: 'lit', color: color, pol: pol !== false }; }
  function or(a, b) { return { t: 'or', a: a, b: b }; }
  function and(a, b) { return { t: 'and', a: a, b: b }; }

  function isLit(m) { return m.t === 'lit'; }

  function clone(m) {
    if (m.t === 'lit') return lit(m.color, m.pol);
    return { t: m.t, a: clone(m.a), b: clone(m.b) };
  }

  // ----- semantics ----------------------------------------------------------
  function byteOf(m) {
    if (m.t === 'lit') {
      var c = COLOR_BYTE[m.color];
      return m.pol ? c : (~c & 0xFF);
    }
    if (m.t === 'or') return (byteOf(m.a) | byteOf(m.b)) & 0xFF;
    return (byteOf(m.a) & byteOf(m.b)) & 0xFF; // and
  }

  function rowByte(row) {
    var acc = 0;
    for (var i = 0; i < row.length; i++) acc |= byteOf(row[i]);
    return acc & 0xFF;
  }

  function rowSolvable(row) { return rowByte(row) === 0xFF; }

  // Negation == a genuine 90-degree (clockwise) turn of the whole molecule:
  // swap and<->or, flip every literal, and reorder children to match the
  // rotation of the layout axes.  A horizontal OR (a|b, left|right) turns into
  // a vertical AND (a over b, left->top, right->bottom) — no reorder.  A
  // vertical AND (a over b, top/bottom) turns into a horizontal OR — top->right
  // and bottom->left, so the children swap.  De Morgan still holds (and/or are
  // commutative) and byteOf(negate(m)) === ~byteOf(m).
  function negate(m) {
    if (m.t === 'lit') return lit(m.color, !m.pol);
    if (m.t === 'or') return and(negate(m.a), negate(m.b));   // left->top, right->bottom
    return or(negate(m.b), negate(m.a));                      // top->right, bottom->left
  }

  // ----- random generation --------------------------------------------------
  function randInt(n) { return Math.floor(Math.random() * n); }
  function pick(arr) { return arr[randInt(arr.length)]; }

  function randomLit() { return lit(pick(COLORS), Math.random() < 0.5); }

  // Generate a random molecule.  `depth` bounds the tree height; `branch`
  // is the probability of placing a connective vs. a leaf at each node.
  // `andBias` is the probability a connective is a conjunction.  Keeping it
  // below 0.5 limits proof branching, so levels stay short enough to be fun.
  function randomMolecule(depth, branch, andBias) {
    if (andBias == null) andBias = 0.4;
    if (depth <= 0 || Math.random() > branch) return randomLit();
    var node = Math.random() < andBias ? and : or;
    return node(randomMolecule(depth - 1, branch * 0.82, andBias),
                randomMolecule(depth - 1, branch * 0.82, andBias));
  }

  // Build a molecule whose byte covers every set bit in `need`, as an
  // OR-chain ("horizontal" molecule) of literals.  Used to top up a Standard
  // level so the row becomes a tautology (byte == 0xFF).
  function coverMolecule(need) {
    need &= 0xFF;
    var litsByByte = [];
    for (var c = 0; c < 3; c++) {
      litsByByte.push({ b: COLOR_BYTE[c], m: lit(c, true) });
      litsByByte.push({ b: (~COLOR_BYTE[c]) & 0xFF, m: lit(c, false) });
    }
    var chosen = [];
    var covered = 0;
    // Greedy set cover over the 6 literal columns.
    while ((covered & need) !== need) {
      var best = null, bestGain = -1;
      for (var i = 0; i < litsByByte.length; i++) {
        var gain = popcount(litsByByte[i].b & need & ~covered);
        if (gain > bestGain) { bestGain = gain; best = litsByByte[i]; }
      }
      if (!best || bestGain <= 0) break;
      chosen.push(clone(best.m));
      covered |= best.b;
    }
    if (chosen.length === 0) return randomLit();
    var m = chosen[0];
    for (var k = 1; k < chosen.length; k++) m = or(m, chosen[k]);
    return m;
  }

  function popcount(x) {
    x &= 0xFF; var n = 0;
    while (x) { n += x & 1; x >>= 1; }
    return n;
  }

  function countAtoms(m) { return m.t === 'lit' ? 1 : countAtoms(m.a) + countAtoms(m.b); }

  // Draw a random molecule with at least `min` atoms (rejection sampling, with
  // a guaranteed fallback so it always terminates).
  function moleculeWithMinAtoms(depth, branch, min) {
    var m, guard = 0;
    do { m = randomMolecule(depth, branch); } while (countAtoms(m) < min && ++guard < 300);
    while (countAtoms(m) < min) m = or(m, randomLit()); // fallback: pad with literals
    return m;
  }

  // ----- level generation ---------------------------------------------------
  // Returns an array of rows; each row is an array of molecules.
  // difficulty (1+) scales molecule depth / count.
  function generateLevel(mode, difficulty) {
    difficulty = Math.max(1, difficulty | 0);
    var depth = Math.min(2 + Math.floor(difficulty / 3), 4);
    var branch = 0.8;

    if (mode === 'zen') {
      // Two molecules: a formula and its 90-degree turn (its negation).
      // M  or  ~M  is always a tautology (excluded middle).  Keep it from being
      // trivial by requiring the formula to have at least 3 atoms.
      var m = moleculeWithMinAtoms(depth + 1, branch, 3);
      return [[m, negate(m)]];
    }

    if (mode === 'tautological') {
      // One solvable molecule: (N or ~N) is a single tautological molecule.
      var n = randomMolecule(depth, branch);
      return [[or(n, negate(n))]];
    }

    // Standard: an *irredundant* set of molecules whose disjunction is a
    // tautology — every molecule is needed, so no strict subset is provable.
    var target = Math.min(2 + Math.floor(difficulty / 2), 4); // soft size goal
    var row = [];
    var acc = 0;
    var guard = 0;
    while (acc !== 0xFF && guard++ < 300) {
      var mm = randomMolecule(depth, branch);
      var b = byteOf(mm);
      if (b === 0xFF) continue;          // never let a single formula be provable
      if ((acc | b) === acc) continue;   // skip formulas that add no new truth bits
      // bias toward the target size: once we could finish, allow finishing
      row.push(mm); acc |= b;
    }
    if (acc !== 0xFF) {                   // top up remaining bits with a literal cover
      var patch = coverMolecule((~acc) & 0xFF);
      if (byteOf(patch) !== 0xFF) { row.push(patch); }
    }
    pruneRedundant(row);                  // drop any molecule the rest already cover
    // keep at least a couple of molecules; if it collapsed, try again
    if (row.length < 2 || rowByte(row) !== 0xFF) return generateLevel('standard', difficulty);
    // void the soft target if pruning left fewer; that's fine — minimality wins
    void target;
    shuffle(row);
    return [row];
  }

  // Remove molecules that are redundant (the rest still form a tautology),
  // until the set is irredundant: every molecule necessary, no proper subset
  // provable.  Assumes the whole set's disjunction is already 0xFF.
  function pruneRedundant(row) {
    var changed = true;
    while (changed) {
      changed = false;
      for (var i = 0; i < row.length; i++) {
        var without = 0;
        for (var j = 0; j < row.length; j++) if (j !== i) without |= byteOf(row[j]);
        if ((without & 0xFF) === 0xFF) { row.splice(i, 1); changed = true; break; }
      }
    }
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = randInt(i + 1);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  root.logic = {
    RED: RED, GREEN: GREEN, BLUE: BLUE, COLORS: COLORS, COLOR_BYTE: COLOR_BYTE,
    lit: lit, or: or, and: and, isLit: isLit, clone: clone,
    byteOf: byteOf, rowByte: rowByte, rowSolvable: rowSolvable, negate: negate,
    randomMolecule: randomMolecule, generateLevel: generateLevel,
    popcount: popcount, countAtoms: countAtoms
  };
})(window.Wang = window.Wang || {});
