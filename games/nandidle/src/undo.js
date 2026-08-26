// undo.js — a small stack of inverse operations per screen. Undo reverses the
// action you took, not the seconds that passed: production keeps whatever it
// earned while you were deciding.
//
// In memory only; a reload starts with an empty stack.

const stacks = new Map();
const LIMIT = 40;

const stack = (scope) => {
  if (!stacks.has(scope)) stacks.set(scope, []);
  return stacks.get(scope);
};

/** Record how to reverse what just happened. */
export function push(scope, label, undoFn) {
  const s = stack(scope);
  s.push({ label, undoFn });
  if (s.length > LIMIT) s.shift();
}

export function undo(scope) {
  const s = stack(scope);
  const entry = s.pop();
  if (!entry) return null;
  try { entry.undoFn(); } catch { return null; }
  return entry.label;
}

export function peek(scope) { return stack(scope).at(-1)?.label || null; }
export function clear(scope) { stack(scope).length = 0; }
