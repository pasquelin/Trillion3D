import test from 'node:test';
import assert from 'node:assert/strict';
import { plane } from '../../../sdk-core/src/world/geometry/basic.ts';
import { SOFT_STATE_WORDS } from '../../../sdk-core/src/physics/index.ts';
import { addSoft, softWorld } from './soft.fixture.ts';
import { FLAT } from './records.fixture.ts';

/** Steps of the audit's run (PHY-09): 45 × 45 vertices and up diverged well before it. */
const STEPS = 400;

/**
 * A 1 m cloth of `n` × `n` vertices, laid flat 3 m up and pinned along its edge `y = 0.5`, with the
 * default settings but its `stretch`; stepped `steps` times, the farthest any vertex went from that
 * pinned edge (in the geometry's frame, the line `y = 0.5, z = 0`), `Infinity` from the first step
 * that sent a vertex that is not finite.
 */
async function farthest(n: number, stretch = 0, steps = STEPS) {
  const jolt = await softWorld();
  const pins = Array.from({ length: n }, (_, i) => (n - 1) * n + i);
  addSoft(jolt, plane(1, 1, n - 1, n - 1), { type: 'cloth', pins, stretch }, [0, 3, 0], {
    quaternion: FLAT,
  });
  let far = 0;
  for (let s = 0; s < steps; s++) {
    jolt.step(null, 1 / 60);
    const words = jolt.soft();
    if (!words.length) continue;
    const vertices = new Float32Array(words.slice(SOFT_STATE_WORDS).buffer);
    for (let v = 0; v < vertices.length; v += 3) {
      const reach = Math.hypot(vertices[v + 1] - 0.5, vertices[v + 2]);
      if (!Number.isFinite(reach)) return Infinity;
      far = Math.max(far, reach);
    }
  }
  return far;
}

test('a large pinned cloth hangs from its pins without diverging, 45 to 64 vertices a side', async () => {
  for (const n of [45, 52, 60, 64]) {
    const far = await farthest(n);
    // Each vertex is held within its rest distance of the nearest pin: 1 m at most, straight
    // across the cloth, so never farther than that from the pinned edge, however it swings.
    assert.ok(far < 1.001, `${n} × ${n}: a vertex went ${far} m from the pinned edge`);
  }
});

test('a pinned cloth given stretch keeps its give: no attachment holds it', async () => {
  const far = await farthest(11, 0.1, 180);
  assert.ok(far > 1.03, `it hangs ${far} m below its pins, more than its 1 m`);
});
