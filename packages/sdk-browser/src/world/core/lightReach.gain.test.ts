/**
 * The decision evidence for #958 (CMP-16): the gain the frame's perceptual cut takes off the only
 * scene with compiled lamps, matching the audit's target. The scene is `aerial-410`
 * (`bench/runner/scenes/aerial.ts`): 600 point lamps, each 400 cd at 18 m (`LAMP`). The compiler
 * publishes intensity in W/sr — one candela is 1/683 W/sr (`asset-compiler-rust/src/compiler_lights.rs`,
 * `LUMENS_PER_WATT`) — so a lamp's peak is 400/683. The quantum is the audit's exposure- and
 * curve-aware floor (`perceptibleQuantum`), so the cut is exactly the audit's own at ACES and
 * exposure 1 (18 → 7.7775 m, range −56.79 %, shadow footprint −81.3 %) and shallower as the
 * exposure rises. Compiler-side range math alone, no Chrome.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { perceptibleQuantum, visibleReach } from './lightReach.ts';

/** `aerial-410`'s one lamp (`bench/runner/scenes/aerial.ts`). */
const PEAK = 400 / 683,
  RANGE = 18;
const cut = (exposure: number, toneMapping: 'aces' | 'linear') =>
  visibleReach(RANGE, PEAK, perceptibleQuantum({ exposure, toneMapping }));

test('the perceptual cut reaches the audit target on the reference scene, and less at night', () => {
  const day = cut(1, 'aces');
  assert.ok(Math.abs(day - 7.7775) < 0.01, `the audit's cut is ${day} m`);
  assert.ok(Math.abs(1 - day / RANGE - 0.5679) < 0.005, `the range gain is ${1 - day / RANGE}`);
  const footprint = 1 - (day / RANGE) ** 2;
  assert.ok(Math.abs(footprint - 0.813) < 0.01, `the shadow-footprint gain is ${footprint}`);
  // A raised exposure lengthens the reach: the cut never steps, so the night loses less.
  let previous = day;
  for (const exposure of [2, 4, 8]) {
    const reach = cut(exposure, 'aces');
    assert.ok(reach > previous && reach <= RANGE, `exposure ${exposure}: ${reach} m`);
    previous = reach;
  }
  // A flatter curve cuts no deeper than the steeper one.
  assert.ok(cut(1, 'linear') > day, 'linear keeps the lamp farther than aces');
});
