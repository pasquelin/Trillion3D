import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import type { MenuActions } from '../site/examples/kit/gameMenu.ts';
import { isCapture, play, type PlayDocument } from '../site/examples/kit/play.ts';

type Listener = (event: { relatedTarget?: unknown }) => void;

/** A document, a canvas in it and a menu that records what it shows; `answer` is the browser's
 * reply to the next lock request. */
function game(answer: () => unknown = () => undefined) {
  const listeners = new Map<string, Listener>();
  const on = (type: string, listener: Listener) => listeners.set(type, listener);
  const doc = {
    pointerLockElement: null as unknown,
    hidden: false,
    defaultView: { addEventListener: on },
    addEventListener: on,
  };
  const calls: string[] = [];
  const canvas = {
    isConnected: true,
    ownerDocument: doc as unknown,
    requestPointerLock: () => (calls.push('lock'), answer()),
  };
  const world = { canvas, controls: { enabled: true }, invalidate: () => {} };
  const shown: Array<[string | null, string]> = [];
  let actions!: MenuActions;
  const hooks = {
    onStart: () => calls.push('start'),
    onPause: () => calls.push('pause'),
    onResume: () => calls.push('resume'),
    onRestart: () => calls.push('restart'),
  };
  const state = play(world, hooks, doc as PlayDocument, (given) => {
    actions = given;
    return { show: (screen, note = '') => shown.push([screen, note]) };
  });
  const fire = (type: string, change: Partial<typeof doc> = {}, event = {}) => {
    Object.assign(doc, change);
    listeners.get(type)?.(event);
  };
  return { state, world, canvas, actions, shown, calls, fire, last: () => shown.at(-1) };
}

test('the capture flag is read from the URL alone, and only its own key', () => {
  assert.equal(isCapture({ location: { search: '?capture' } }), true);
  assert.equal(isCapture({ location: { search: '?x=1&capture=1' } }), true);
  assert.equal(isCapture({ location: { search: '?captured=1' } }), false);
  assert.equal(isCapture({ location: { search: '' } }), false);
  assert.equal(isCapture({}), false);
});

test('a game starts on its menu, runs while locked, pauses on Escape and resumes on a press', () => {
  const { state, world, canvas, actions, calls, fire, last } = game();
  assert.deepEqual([state.running, world.controls.enabled, last()], [false, false, ['start', '']]);
  actions.play();
  assert.equal(state.running, false, 'asking for the lock is not having it');
  fire('pointerlockchange', { pointerLockElement: canvas });
  assert.deepEqual(
    [state.running, state.started, world.controls.enabled, last()],
    [true, true, true, [null, '']],
  );
  fire('pointerlockchange', { pointerLockElement: null });
  assert.deepEqual([state.running, world.controls.enabled, last()], [false, false, ['pause', '']]);
  actions.restart();
  fire('pointerlockchange', { pointerLockElement: canvas });
  fire('blur');
  assert.equal(state.running, false, 'a lost focus pauses before the lock is released');
  actions.play();
  assert.equal(state.running, true, 'a lock still held resumes at once');
  fire('visibilitychange', { hidden: true });
  assert.equal(state.running, false, 'a hidden page stays paused, lock or not');
  assert.deepEqual(calls, [
    'lock',
    'start',
    'resume',
    'pause',
    'restart',
    'lock',
    'resume',
    'pause',
    'resume',
    'pause',
  ]);
});

test('a lock refused just after Escape keeps the menu, and is asked once more after the cooldown', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let refusals = 2;
    const tooSoon = () => (refusals-- > 0 ? Promise.reject(new Error('SecurityError')) : undefined);
    const { canvas, actions, calls, fire, last, state } = game(tooSoon);
    actions.play();
    await Promise.resolve();
    assert.deepEqual(last(), ['start', 'Click again to continue']);
    mock.timers.tick(1100);
    await Promise.resolve();
    assert.deepEqual(calls, ['lock', 'lock'], 'one retry, and no more');
    mock.timers.tick(5000);
    assert.equal(calls.length, 2);
    actions.play();
    fire('pointerlockchange', { pointerLockElement: canvas });
    assert.deepEqual([state.running, last()], [true, [null, '']]);
    // Paused again, the pointer leaves the page before a refusal: no retry pulls it back.
    fire('pointerlockchange', { pointerLockElement: null });
    refusals = 1;
    fire('pointerout', {}, { relatedTarget: null });
    actions.play();
    await Promise.resolve();
    mock.timers.tick(1100);
    assert.deepEqual(
      [calls.filter((call) => call === 'lock').length, last()],
      [4, ['pause', 'Click again to continue']],
    );
  } finally {
    mock.timers.reset();
  }
});

test('a canvas outside the document is never asked, and a refusal from another document is caught', async () => {
  const wrong = () => Promise.reject(new Error('WrongDocumentError'));
  const detached = game(wrong);
  detached.canvas.isConnected = false;
  detached.actions.play();
  assert.deepEqual([detached.calls, detached.last()], [[], ['start', 'Click again to continue']]);
  const elsewhere = game(wrong);
  elsewhere.fire('pointerout', {}, { relatedTarget: null });
  elsewhere.actions.play();
  await Promise.resolve();
  assert.deepEqual(
    [elsewhere.state.running, elsewhere.last()],
    [false, ['start', 'Click again to continue']],
  );
  // The older form reports through an event instead of a promise.
  const older = game();
  older.fire('pointerout', {}, { relatedTarget: null });
  older.actions.play();
  older.fire('pointerlockerror');
  assert.deepEqual(older.last(), ['start', 'Click again to continue']);
});
