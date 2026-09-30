// #833: the water composite writes its coverage as the reactive value into the same target the
// blend pass and the particles write (`asIsShare.ts`), so the temporal resolve shortens a pixel's
// history behind water as it does behind a blend or a particle, while the image moves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REACTIVE_TARGET } from '../../lighting/deferred/asIsShare.ts';
import { WATER_COMPOSITE_SHADER, waterRoutedShader } from './compositeWgsl.ts';
import { WATER_ROUTED_TARGETS, waterCompositeTargets, waterRoutedTargets } from './pipelines.ts';

test('the water composite writes its coverage as the reactive value, green alone', () => {
  // The composite emits an extra output carrying 1 in green at its coverage `a`.
  assert.match(WATER_COMPOSITE_SHADER, /vec4f\(0\.0,1\.0,0\.0,c\.a\)/);
  assert.match(WATER_COMPOSITE_SHADER, /@fragment fn composeWaterReactive/);
  // The reactive target is the as-is share, green alone, with the blend a particle writes.
  assert.equal(REACTIVE_TARGET.writeMask, 0x2);
  assert.equal(REACTIVE_TARGET.blend?.color.srcFactor, 'src-alpha');
  assert.equal(REACTIVE_TARGET.blend?.color.dstFactor, 'one-minus-src-alpha');
  // No share, no target: an image with no temporal pass and no debug view keeps today's composite.
  assert.equal(waterCompositeTargets(false).length, 1);
  assert.equal(waterCompositeTargets(true).length, 2);
  assert.equal(waterRoutedTargets(false).length, 3, 'the HDR target and the two display layers');
  assert.equal(waterRoutedTargets(true).length, 4);
  for (const targets of [waterCompositeTargets(true), waterRoutedTargets(true)])
    assert.equal(targets.at(-1), REACTIVE_TARGET, 'the reactive target last');
  assert.deepEqual(waterRoutedTargets(false), WATER_ROUTED_TARGETS);
  // The routed composite carries the reactive value too, an extra entry after `composeWaterRouted`.
  assert.match(waterRoutedShader(), /@fragment fn composeWaterRoutedReactive/);
  assert.equal(waterRoutedShader().split(/vec4f\(0\.0,1\.0,0\.0,c\.a\)/).length - 1, 2);
});
