/** Unit tests for the pure navigation-stack helpers. */
import { pushRoute } from '../nav';

describe('pushRoute', () => {
  test('appends when the top differs', () => {
    const stack = [{ name: 'home' }];
    const next = pushRoute(stack, { name: 'passengers' });
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({ name: 'passengers' });
    // original untouched
    expect(stack).toHaveLength(1);
  });

  test('dedupes an identical push (double-tap FIRE)', () => {
    const stack = [{ name: 'home' }, { name: 'booking', tripId: 't1' }];
    const next = pushRoute(stack, { name: 'booking', tripId: 't1' });
    expect(next).toBe(stack); // same reference, no duplicate
    expect(next).toHaveLength(2);
  });

  test('same screen, different params still pushes', () => {
    const stack = [{ name: 'booking', tripId: 't1' }];
    const next = pushRoute(stack, { name: 'booking', tripId: 't2' });
    expect(next).toHaveLength(2);
  });

  test('push onto an empty stack', () => {
    expect(pushRoute([], { name: 'home' })).toEqual([{ name: 'home' }]);
  });
});
