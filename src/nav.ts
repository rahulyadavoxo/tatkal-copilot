/**
 * Tiny navigation-stack helpers — pure functions, unit-tested.
 * App.tsx owns the React state; the push/dedupe logic lives here so it can
 * be verified without rendering anything.
 */

/**
 * Push a route unless it is identical to the current top (e.g. double-tap
 * on FIRE). Returns the original array reference on dedupe so callers can
 * rely on referential stability.
 */
export function pushRoute<T>(
  stack: T[],
  r: T,
  equal: (a: T, b: T) => boolean = (a, b) =>
    JSON.stringify(a) === JSON.stringify(b),
): T[] {
  const top = stack[stack.length - 1];
  if (top !== undefined && equal(top, r)) return stack;
  return [...stack, r];
}
