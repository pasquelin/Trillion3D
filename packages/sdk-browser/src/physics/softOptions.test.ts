import test from 'node:test';
import assert from 'node:assert/strict';
import { SOFT_STATE_WORDS } from '../../../sdk-core/src/physics/index.ts';
import { plane } from '../../../sdk-core/src/world/geometry/basic.ts';
import { addSoft, at, ropeLine, settle, softWorld } from './soft.fixture.ts';

/** Laid flat: the plane's `+y` turned to the world's `−z`, so its `−z` is the world's down. */
const FLAT = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];

test('a rope bent stiff reaches out from its two pinned ends; folding freely, it hangs', async () => {
  // A fold edge only pulls against the second order of a sag: the stiff rope bows, yet reaches.
  const reach = async (bend?: number) => {
    const jolt = await softWorld();
    const record = addSoft(jolt, ropeLine(11, 1), { type: 'rope', pins: [0, 1], bend }, [0, 3, 0], {
      linearDamping: 2,
    });
    return at(settle(jolt, record, 3), 10)[0];
  };
  assert.ok((await reach(0)) > 0.2, 'stiff, its free end stays out');
  assert.ok((await reach()) < 0.15, 'free, its free end hangs under its pins');
});

test('a cloth dropped flat on the floor rebounds by its restitution', async () => {
  // A volume would bounce on its gas whatever its restitution: a flat cloth meets the floor at once.
  /** The highest its mean height climbs, m, once it first touched the floor. */
  const rebound = async (restitution: number) => {
    const jolt = await softWorld();
    addSoft(jolt, plane(1, 1, 10, 10), { type: 'cloth' }, [0, 2, 0], {
      ...{ restitution, quaternion: FLAT },
    });
    let touched = false,
      peak = 0;
    for (let s = 0; s < 120; s++) {
      jolt.step(null, 1 / 60);
      const words = jolt.soft();
      if (!words.length) continue;
      // The geometry's z is the world's up: its height above the floor is `2 + z`.
      const z = new Float32Array(words.slice(SOFT_STATE_WORDS).buffer).filter(
        (_, i) => i % 3 === 2,
      );
      touched ||= 2 + Math.min(...z) < 0.02;
      if (touched) peak = Math.max(peak, 2 + z.reduce((a, b) => a + b) / z.length);
    }
    assert.ok(touched, 'it reached the floor');
    return peak;
  };
  const [dead, lively] = [await rebound(0), await rebound(0.8)];
  assert.ok(dead < 0.1 && lively > 0.5, `rebounds ${lively} m with 0.8, ${dead} m with 0`);
});

test('a soft body takes its scale: a rope twice as long hangs twice as low, read in its own frame', async () => {
  const end = async (scale: [number, number, number]) => {
    const jolt = await softWorld();
    const record = addSoft(jolt, ropeLine(11, 1), { type: 'rope', pins: [0] }, [0, 3, 0], {
      ...{ scale, linearDamping: 2 },
    });
    return at(settle(jolt, record, 3), 10)[1];
  };
  // Doubled along the rope only: 2 m hanging, and 2 m in the geometry's y.
  assert.ok(Math.abs((await end([2, 1, 1])) + 2) < 0.1, 'stretched by its scale');
  // Doubled everywhere: 2 m hanging, 1 m in the geometry's own frame.
  assert.ok(Math.abs((await end([2, 2, 2])) + 1) < 0.05, 'read back in its own frame');
});
