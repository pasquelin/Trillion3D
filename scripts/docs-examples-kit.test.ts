import assert from 'node:assert/strict';
import test from 'node:test';
import { describe, labelOf, printed } from '../site/examples/kit/controls.ts';
import { play, type PlayDocument, type PlayElement } from '../site/examples/kit/play.ts';
import { sceneTriangles, statLines, statsCorners } from '../site/examples/kit/stats.ts';

test('a declared control takes its kind from its value, and starts at it', () => {
  const press = () => {};
  const { controls, values } = describe({
    lightIntensity: [0, 10, 3],
    speed: [0, 2, 0.5, 0.25],
    colour: '#88AAFF',
    spin: true,
    view: ['beauty', 'clusters'],
    keys: 'W A S D to fly',
    backHome: press,
  });
  assert.deepEqual(values, {
    lightIntensity: 3,
    speed: 0.5,
    colour: '#88aaff',
    spin: true,
    view: 'beauty',
  });
  assert.deepEqual(
    controls.map(({ kind, label }) => [kind, label]),
    [
      ['slider', 'Light intensity'],
      ['slider', 'Speed'],
      ['colour', 'Colour'],
      ['toggle', 'Spin'],
      ['choice', 'View'],
      ['note', 'Keys'],
      ['button', 'Back home'],
    ],
  );
  // With no step declared, a slider steps by the power of ten under a hundredth of its span.
  assert.deepEqual(controls[0], {
    kind: 'slider',
    key: 'lightIntensity',
    label: 'Light intensity',
    min: 0,
    max: 10,
    step: 0.1,
  });
  const button = controls.at(-1);
  assert.equal(button?.kind === 'button' && button.press, press);
});

test('a control that cannot be drawn is refused by name', () => {
  assert.throws(() => describe({ light: [0, 10, 12] }), /light: a slider is \[min, max, value\]/);
  assert.throws(() => describe({ light: [5, 5, 5] }), /light: a slider/);
  assert.throws(() => describe({ tint: '#abc' }), /tint: a colour is '#rrggbb'/);
  assert.throws(() => describe({ view: [] }), /view: a choice needs at least one option/);
});

test('labels and printed values read as a person would write them', () => {
  assert.equal(labelOf('spin'), 'Spin');
  assert.equal(labelOf('hoursPerDay2'), 'Hours per day2');
  assert.equal(printed(0.5, 0.01), '0.50');
  assert.equal(printed(400, 10), '400');
  assert.equal(printed(3, 1), '3');
});

test('the stats corner shows only what was measured, and never a dash or a zero', () => {
  const unmeasured = { fps: null, held: false, sceneTriangles: null };
  assert.deepEqual(statLines(unmeasured), []);
  assert.deepEqual(
    statLines({
      ...unmeasured,
      fps: 59.6,
      selectedTriangles: 17504,
      drawCalls: 0,
      residentPages: null,
      geometryPoolBytes: 3 * 2 ** 20,
      gpuFrameMs: 1.234,
    }),
    [
      ['FPS', '60'],
      ['triangles', '17,504'],
      ['geometry pool', '3.0 MiB'],
      ['GPU frame', '1.23 ms'],
    ],
  );
  // A still image keeps its last rate; a frame with no triangle count falls back on the scene's.
  assert.deepEqual(
    statLines({ ...unmeasured, fps: 60, held: true, selectedTriangles: null, sceneTriangles: 12 }),
    [
      ['FPS', '60 held'],
      ['triangles (scene)', '12'],
    ],
  );
});

test('the stats corner sits at the bottom left or, moved, at the top left', () => {
  assert.equal(statsCorners['bottom-left'], 'bottom-3 left-3');
  assert.equal(statsCorners['top-left'], 'top-3 left-3');
});

test('the scene count reads indexed and plain geometries of the visible nodes', () => {
  const nodes = [
    { geometry: { index: { count: 36 } } },
    { geometry: { attributes: { position: { count: 9 } } } },
    {},
  ];
  assert.equal(sceneTriangles({ traverseVisible: (visit) => nodes.forEach(visit) }), 15);
});

test('a game runs only while its canvas holds the mouse and the page is seen', () => {
  const listeners = new Map<string, () => void>();
  const on = (type: string, listener: () => void) => listeners.set(type, listener);
  const element = (): PlayElement & { children: unknown[] } => ({
    textContent: '',
    style: { cssText: '' },
    children: [],
    append(...nodes) {
      this.children.push(...nodes);
    },
  });
  const doc = {
    pointerLockElement: null as unknown,
    hidden: false,
    body: element(),
    defaultView: { addEventListener: on },
    addEventListener: on,
    createElement: element,
  };
  const calls: string[] = [];
  const world = {
    canvas: { addEventListener: on, requestPointerLock: () => calls.push('lock') },
    controls: { enabled: true },
    invalidate: () => {},
  };
  const game = play(
    world,
    { keys: 'W A S D', onPause: () => calls.push('pause'), onResume: () => calls.push('resume') },
    doc as PlayDocument,
  );
  const veil = doc.body.children[0] as ReturnType<typeof element>;
  const [heading, line] = veil.children as PlayElement[];
  const change = (type: string, lock: unknown, hidden = false) => {
    Object.assign(doc, { pointerLockElement: lock, hidden });
    listeners.get(type)?.();
  };
  assert.deepEqual(
    [game.running, world.controls.enabled, heading.textContent, line.textContent],
    [false, false, 'Click to play', 'W A S D'],
  );
  listeners.get('click')?.();
  assert.equal(game.running, false, 'asking for the lock is not having it');
  change('pointerlockchange', world.canvas);
  assert.deepEqual(
    [game.running, game.started, world.controls.enabled, veil.style.cssText],
    [true, true, true, 'display:none'],
  );
  change('pointerlockchange', null);
  assert.deepEqual(
    [game.running, world.controls.enabled, heading.textContent],
    [false, false, 'Paused — click to continue'],
  );
  listeners.get('click')?.();
  change('pointerlockchange', world.canvas);
  listeners.get('blur')?.();
  assert.equal(game.running, false, 'a lost focus pauses before the lock is released');
  change('visibilitychange', world.canvas, true);
  assert.equal(game.running, false, 'a hidden page stays paused, lock or not');
  change('visibilitychange', world.canvas);
  assert.equal(game.running, true);
  assert.deepEqual(calls, ['lock', 'resume', 'pause', 'lock', 'resume', 'pause', 'resume']);
});
