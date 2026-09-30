// #685: the image the screen reflections read is a render pass of its own, before the lighting.
// A GPU timing names a pass by its label: without one it read `beginRenderPass`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFERRED_LIGHTING_PASS } from './deferred.ts';
import { REFLECTION_SOURCE_PASS } from '../../reflections/sourcePass.ts';
import type { ScreenReflection } from '../../reflections/gpu.ts';
import { contractLighting } from './contractLighting.fixture.ts';

/** A screen reflection as the lighting sees it: `kept` hears each keep of the source's depth;
 *  `group`, the source's bind group, none before an image gave its inputs. */
const reflectionOf = (
  view: GPUTextureView,
  active = true,
  more = {},
  kept: string[] = [],
  group?: object,
) =>
  ({
    ...{ active, view, group: {}, ...more },
    source: { target: {} as GPUTextureView, group, keep: () => void kept.push('kept') },
  }) as unknown as ScreenReflection;

test('a reflecting image draws its reflection source, then the lighting, each under its label', async () => {
  const h = await contractLighting();
  const { lighting, encoder, target } = h;
  const reflection = reflectionOf(target);
  assert.equal(lighting.usesContract, true, 'the direct program reflects');
  lighting.light(encoder, target, reflection);
  assert.deepEqual(h.labels, [REFLECTION_SOURCE_PASS, DEFERRED_LIGHTING_PASS]);
  lighting.dispose();
});

// #1157: the frame counts what `light` returns; it must be the passes it began, never a guess.
test('the lighting counts exactly the passes it draws, mirror or not, contract or not', async () => {
  const h = await contractLighting();
  const { lighting, encoder, target: view, bind } = h;
  const mirror = (active: boolean) => reflectionOf(view, active);
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

// #1342: the source is the last lit image reprojected, never a second lighting of the surfaces.
test('only the final pass lights a surface: the source reprojects, the rough trace reads it', async () => {
  const h = await contractLighting();
  const { lighting, encoder, target } = h;
  const history = {
    reuse: false,
    encode(into: GPUCommandEncoder, _scratch: GPUTextureView, pipeline: GPURenderPipeline) {
      const pass = into.beginRenderPass({ colorAttachments: [] });
      pass.setPipeline(pipeline);
      pass.draw(3);
      pass.end();
    },
  };
  const reflection = reflectionOf(target, true, { history }, [], {});
  lighting.light(encoder, target, reflection);
  const entries = h.passes.map(
    ({ pipeline }) => (pipeline as unknown as GPURenderPipelineDescriptor).fragment!.entryPoint,
  );
  assert.deepEqual(entries, [
    'reprojectReflectionSource',
    'traceRoughReflection',
    'resolveRoughReflection',
    'lightSurface',
  ]);
  lighting.dispose();
});

// #1342: the source reprojected the HDR target, which by then held camera fog, the mirror term,
// transparents, water and particles. The one lighting pass writes the source beside the lit image.
test('the reflecting lighting pass writes the next source as its second target, once kept', async () => {
  const h = await contractLighting();
  const { lighting, encoder, target } = h;
  const kept: string[] = [];
  const reflection = reflectionOf(target, true, {}, kept);
  lighting.light(encoder, target, reflection);
  const lit = h.passes.at(-1)!;
  assert.equal(lit.descriptor.label, DEFERRED_LIGHTING_PASS);
  const views = Array.from(lit.descriptor.colorAttachments, (attachment) => attachment!.view);
  assert.deepEqual(views, [target, reflection.source!.target]);
  const pipeline = lit.pipeline as unknown as GPURenderPipelineDescriptor;
  assert.equal(Array.from(pipeline.fragment!.targets).length, 2);
  assert.deepEqual(kept, ['kept'], 'its depth and identifiers kept for the next image');
  lighting.dispose();
});
