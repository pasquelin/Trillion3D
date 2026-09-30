import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './targets.fixture.ts';
import { fakeDevice } from '../../../../../../tests/kit/gpu/fakeDevice.ts';
import { makeTargets, targetsFit } from './targets.ts';
import { frameTargetAllocation } from './targetAllocation.ts';
import { standardSurface } from '../../../host/graph/graph.fixture.ts';
import { surfaceOf } from '../../../page/surface.ts';
import { frameTargetBytes } from '../../../scene/surfaceBuffer.ts';
import { REFLECTION_SOURCE_VIEW_BYTES } from '../../../reflections/source.ts';

const native = (width: number, height: number) => ({
  width,
  height,
  renderWidth: width,
  renderHeight: height,
  apart: false,
});

/** A rough opaque receiver alone: no forward cone, its trace walking the depth bounds. */
function roughRuntime() {
  const { rt } = runtime(true);
  rt.layout.rows.packedRecs[0]!.material = surfaceOf(standardSurface({ roughness: 0.5 }));
  Object.assign(rt, { vis: {}, capture: { capturing: false } });
  const gpu = fakeDevice({ limits: { maxTextureDimension2D: 8192 } });
  rt.gpu.device = gpu.device;
  return rt;
}

test('rough opaque receivers allocate their own history, while a resize releases it', () => {
  const rt = roughRuntime();
  const size = native(64, 32);
  const bytes = frameTargetAllocation(rt, size);
  // The rough trace walks the depth bounds alone: 32×16 to 1×1 of rg32float, six extents.
  const bounds = (512 + 128 + 32 + 8 + 2 + 1) * 8 + 6 * 256;
  const expected = frameTargetBytes(64, 32, true) + 64 * 32 * 40 + REFLECTION_SOURCE_VIEW_BYTES;
  assert.equal(bytes, expected + bounds + 80 + 160);
  makeTargets(rt, rt.gpu.device!, size, bytes);
  const old = rt.gpu.reflection!.history!;
  assert.equal(old.bytes, 64 * 32 * 32);
  makeTargets(rt, rt.gpu.device!, native(32, 16), frameTargetAllocation(rt, native(32, 16)));
  assert.throws(() => old.image, /DISPOSED/);
  assert.equal(rt.gpu.reflection!.history!.bytes, 32 * 16 * 32);
});

// The defect this test catches: the targets made a depth pyramid for the rough trace, while their
// fit asked for one only under a cone, so every image remade them, and a prepare never settled.
test('targets made for a rough receiver alone fit it: none is remade the next image', () => {
  const rt = roughRuntime();
  const size = native(64, 32);
  makeTargets(rt, rt.gpu.device!, size, frameTargetAllocation(rt, size));
  assert.ok(rt.gpu.reflection!.pyramid, 'the trace walks its own depth bounds');
  assert.equal(rt.gpu.reflection!.pyramid!.radiance, false, 'no cone reads radiance levels');
  assert.equal(targetsFit(rt, size), true);
});
