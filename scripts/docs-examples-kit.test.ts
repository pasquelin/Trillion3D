import assert from 'node:assert/strict';
import test from 'node:test';
import { describe, printed } from '../site/examples/kit/controls.ts';
import { labelOf } from '../site/examples/kit/words.ts';
import { sceneTriangles, statLines, statsCorners } from '../site/examples/kit/stats.ts';
import { profileLines, profileWindow } from '../site/examples/kit/profile.ts';

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
  assert.equal(printed(16.25, 0.25), '16.25');
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
      ['fps', '60'],
      ['triangles', '17,504'],
      ['geometryPool', '3.0 MiB'],
      ['gpuFrame', '1.23 ms'],
    ],
  );
  // A still image keeps its last rate; a frame with no triangle count falls back on the scene's.
  assert.deepEqual(
    statLines({ ...unmeasured, fps: 60, held: true, selectedTriangles: null, sceneTriangles: 12 }),
    [
      ['fpsHeld', '60'],
      ['sceneTriangles', '12'],
    ],
  );
  // A frame that measured no triangle at all shows none: never the scene's count in its place.
  assert.deepEqual(statLines({ ...unmeasured, selectedTriangles: 0, sceneTriangles: 12 }), []);
});

test('the stats corner sits at the bottom left or, moved, at the top left', () => {
  assert.equal(statsCorners['bottom-left'], 'bottom-3 start-3');
  assert.equal(statsCorners['top-left'], 'top-3 start-3');
});

test('the scene count reads indexed and plain geometries of the visible meshes, not points or lines', () => {
  const nodes = [
    { geometry: { index: { count: 36 } } },
    { geometry: { attributes: { position: { count: 9 } } } },
    { primitive: 'points', geometry: { attributes: { position: { count: 300 } } } },
    {},
  ];
  assert.equal(sceneTriangles({ traverseVisible: (visit) => nodes.forEach(visit) }), 15);
});

test('the profile ranks the engine steps by p95, leaves the sums out, and shows only what was measured', () => {
  const step = (p50: number, p95: number) => ({ p50, p95 });
  const latest = profileWindow([4, 2, 3, 10], [], {
    steps: {
      totalMs: step(3, 5),
      encodeSubmitMs: step(2, 4),
      worldMs: step(0.5, 1),
      lightsMs: step(0.2, 2),
      tilesPumpMs: step(NaN, NaN),
    },
  });
  assert.deepEqual(latest.frameMs, { p50: 4, p95: 10 });
  assert.equal(latest.hooksMs, null);
  assert.deepEqual(
    latest.steps.map(({ name }) => name),
    ['lightsMs', 'worldMs'],
  );
  assert.deepEqual(profileLines(latest), [
    ['cpuFrame', '4.00 / 10.00 ms'],
    ['engineCpu', '3.00 / 5.00 ms'],
    ['lights', '0.20 / 2.00 ms'],
    ['world', '0.50 / 1.00 ms'],
  ]);
});
