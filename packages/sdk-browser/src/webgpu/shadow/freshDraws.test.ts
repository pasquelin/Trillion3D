// #26 (shadow-pool write side): the pages the GPU draws itself (#1275) place their sun casters'
// corners through `shadowVertexIn` -> `sunSnap` (`freshDrawsWgsl.ts`), exactly as the pool's
// host-side draws do. The hardware clipper can mint unsnapped corners between the snapped ones,
// whose f32 sum with the pool origin rounds differently at every origin the pool places the page
// at; `casterPrimitive` disables the clip on a device that grants `depth-clip-control`. The clear
// draws place page squares in NDC, not casters, so they keep the default. Every draw is built here,
// so the recorder device's descriptors are read directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { shadowFreshDraws } from './freshDraws.ts';

const CASTERS = ['casters', 'tintDepth', 'tintColour'] as const;
const CLEARS = ['clear', 'tintClear'] as const;

/** The five draws built on a device granting `features`, reading each one's `unclippedDepth`. */
function built(features: GPUFeatureName[]) {
  const { device } = fakeDevice({ features });
  const draws = shadowFreshDraws(device, {} as GPUShaderModule, {} as GPUBindGroupLayout).made();
  const unclipped = (name: (typeof CASTERS)[number] | (typeof CLEARS)[number]) =>
    (draws[name] as unknown as GPURenderPipelineDescriptor).primitive?.unclippedDepth;
  return { unclipped };
}

test('the GPU pages clamp depth on their caster draws on a device with depth-clip-control', () => {
  const { unclipped } = built(['depth-clip-control']);
  for (const name of CASTERS) assert.equal(unclipped(name), true, name);
  for (const name of CLEARS) assert.equal(unclipped(name), undefined, name);
});

test('without the feature every page draw keeps the default, clipping', () => {
  const { unclipped } = built([]);
  for (const name of [...CASTERS, ...CLEARS]) assert.equal(unclipped(name), undefined, name);
});
