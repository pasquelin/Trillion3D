// The sun clipmap window is the session's (#1281): an ordinary session keeps the constant, a
// reference one raises it so every pixel of a wide view reads the finest level — no outer pixel
// falls to the next, coarser clipmap level: a page past the ordinary half-window is held only in
// the reference one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SUN_WINDOW } from './virtual.ts';
import { createSunLevels } from './sunLevels.ts';
import { VIEW } from './lightShadow.fixture.ts';

const AXIS = [0, -1, 0];
// The boss's case: 2234 device pixels at a 55° vertical field reach 4291, so `pages · 64 ≥ 4291`
// gives 68 — the value `referenceMode.ts` passes.
const REFERENCE_WINDOW = 68;
const at = (x: number) => ({ ...VIEW, position: [x, 5, 0] as [number, number, number] });

test('a page past the ordinary half-window is held only in the reference window', () => {
  const ordinary = createSunLevels(SUN_WINDOW),
    reference = createSunLevels(REFERENCE_WINDOW),
    level = 0;
  ordinary.update(0, AXIS, at(0), [-10, 0, -10], [10, 5, 10], 1);
  reference.update(0, AXIS, at(0), [-10, 0, -10], [10, 5, 10], 1);
  // The same absolute page 32 out from the camera: the ordinary window reaches 31, the reference
  // 33. This is the pixel the audit saw read the next, coarser level.
  const center = ordinary.originOf(0, level, 0) + SUN_WINDOW / 2,
    ax = center + SUN_WINDOW / 2;
  assert.equal(ordinary.holds(0, level, ax, 0), false, 'at the ordinary window edge');
  assert.equal(reference.holds(0, level, ax, 0), true, 'inside the reference window');
});
