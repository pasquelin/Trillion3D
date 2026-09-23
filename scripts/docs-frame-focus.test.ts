import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keepsScroll, PORTAL, stepFrame } from '../site/app/hooks/frameFocus.ts';
import type { FrameEvent, FrameFocus } from '../site/app/hooks/frameFocus.ts';

/** Runs `events` from the portal, and names each state reached and each act taken. */
const walk = (events: FrameEvent[]) => {
  let focus: FrameFocus = PORTAL;
  return events.map((event) => {
    const [next, act] = stepFrame(focus, event);
    focus = next;
    return `${next.state}${act ? `:${act}` : ''}`;
  });
};

test('a framed demo takes the keyboard on a press, keeps it through a lock, and gives it back on a second Escape', () => {
  // A press, the focus the browser then reports, a lock, the Escape the browser spends ending it.
  assert.deepEqual(
    walk(['take', 'focus', 'lock', 'unlock', 'escape', 'escapeUp', 'escape', 'blur']),
    ['demo:focus', 'demo', 'locked', 'demo', 'demo', 'demo', 'portal:release', 'portal'],
  );
  // A browser that swallows the Escape of the lock: the next one releases.
  assert.deepEqual(walk(['take', 'lock', 'unlock', 'escapeUp', 'escape']).at(-1), 'portal:release');
  // A press outside, or leaving the window, gives the keyboard back at once, lock or not.
  assert.deepEqual(walk(['take', 'lock', 'blur']).at(-1), 'portal');
  // An Escape outside the demo, or during a lock, releases nothing.
  assert.deepEqual(walk(['escape', 'take', 'lock', 'escape']), [
    'portal',
    'demo:focus',
    'locked',
    'locked',
  ]);
  // The keys that would scroll the page are the demo's, unless a field of its own reads them.
  assert.equal(keepsScroll(' ', { tagName: 'CANVAS' } as unknown as EventTarget), true);
  assert.equal(keepsScroll('ArrowUp', { tagName: 'INPUT' } as unknown as EventTarget), false);
  assert.equal(keepsScroll(' ', { tagName: 'BUTTON' } as unknown as EventTarget), false);
  assert.equal(keepsScroll('w', null), false);
});
