import assert from 'node:assert/strict';
import test from 'node:test';
import { headBob, strideAt } from '../../../../../site/examples/kit/openworld/play/camera.ts';
import { readings } from '../../../../../site/examples/kit/openworld/play/hud.ts';
import { HINTS, KEYS } from '../../../../../site/examples/kit/openworld/play/keys.ts';

test('the head bobs twice a stride cycle, a few centimetres, and not at all standing still', () => {
  assert.deepEqual(headBob(1.3, 0, false), [0, 0]);
  const heights = Array.from(
    { length: 64 },
    (_, i) => headBob((i / 64) * 2 * Math.PI, 1, false)[0],
  );
  const span = Math.max(...heights) - Math.min(...heights);
  assert.ok(span > 0.02 && span < 0.06, `walking bob ${span} m`);
  const running = Array.from({ length: 64 }, (_, i) => headBob((i / 64) * 2 * Math.PI, 1, true)[0]);
  assert.ok(Math.max(...running) - Math.min(...running) > span);
  // Two lows a cycle: one per step.
  const lows = heights.filter((h, i) => h < heights[(i + 63) % 64] && h < heights[(i + 1) % 64]);
  assert.equal(lows.length, 2);
  // Strides lengthen with pace: about 0.8 m walking, 1.6 m running.
  assert.ok(Math.abs(strideAt(1.4) - 0.84) < 0.01 && Math.abs(strideAt(6) - 1.58) < 0.01);
});

test('the HUD reads the mode, speed and altitude, and says when the ground is still loading', () => {
  const base = {
    mode: 'plane' as const,
    speed: 100,
    altitude: 1234.4,
    aboveGround: 1000.2,
    stamina: 1,
    throttle: 0.75,
    stalled: true,
    loading: false,
    prompt: null,
    x: 0,
    z: 0,
    heading: 0,
  };
  assert.deepEqual(readings(base), [
    'Plane · 360 km/h',
    'Altitude 1234 m · 1000 m above ground',
    'Throttle 75 % · STALL',
  ]);
  assert.deepEqual(
    readings({ ...base, mode: 'foot', speed: 1.4, aboveGround: null, loading: true }),
    ['On foot · 5 km/h', 'Stamina 100 %', 'Loading the ground here…'],
  );
  assert.deepEqual(readings({ ...base, mode: 'car', speed: 25 }), ['Car · 90 km/h']);
});

test('every hint names the key its mode reads', () => {
  assert.equal(KEYS.use, 'KeyE');
  for (const hint of [HINTS.foot, HINTS.car, HINTS.plane]) assert.match(hint, /\bE (get|get in)/);
});
