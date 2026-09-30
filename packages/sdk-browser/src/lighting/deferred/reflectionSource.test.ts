// #685: the unfogged image the screen reflections read is a render pass of its own, before the
// lighting. A GPU timing names a pass by its label: without one it read `beginRenderPass`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFERRED_LIGHTING_PASS } from './deferred.ts';
import { REFLECTION_SOURCE_PASS } from '../../reflections/sourcePass.ts';
import type { ScreenReflection } from '../../reflections/gpu.ts';
import { contractLighting } from './contractLighting.fixture.ts';

test('a reflecting image draws its reflection source, then the lighting, each under its label', async () => {
  const h = await contractLighting();
  const { lighting, encoder, target } = h;
  const reflection = { active: true, view: target, group: {} } as unknown as ScreenReflection;
  assert.equal(lighting.usesContract, true, 'the direct program reflects');
  lighting.light(encoder, target, reflection);
  assert.deepEqual(h.labels, [REFLECTION_SOURCE_PASS, DEFERRED_LIGHTING_PASS]);
  lighting.dispose();
});

// #1157: the frame counts what `light` returns; it must be the passes it began, never a guess.
test('the lighting counts exactly the passes it draws, mirror or not, contract or not', async () => {
  const h = await contractLighting();
  const { lighting, encoder, target: view, bind } = h;
  const mirror = (active: boolean) => ({ active, view, group: {} }) as unknown as ScreenReflection;
  for (const contract of [false, true]) {
    bind(contract);
    assert.equal(lighting.usesContract, contract);
    for (const reflection of [undefined, mirror(false), mirror(true)]) {
      h.passes.length = 0;
      const counted = lighting.light(encoder, view, reflection);
      const case_ = `contract ${contract}, mirror ${reflection?.active ?? 'none'}`;
      assert.equal(counted, h.passes.length, case_);
      assert.equal(h.passes.length, contract && reflection?.active ? 2 : 1, case_);
    }
  }
  lighting.dispose();
});
