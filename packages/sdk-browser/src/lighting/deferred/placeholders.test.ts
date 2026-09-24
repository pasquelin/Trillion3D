import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SHADOW_SLICES, SHADOW_RECORD_FLOATS } from '../../../../sdk-core/src/index.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { createDeferredPlaceholders } from './setup.ts';

// `ShadowData` is every light's record then a runtime page-table array. WGSL rounds the struct
// to its 16-byte alignment, so the smallest buffer a pipeline accepts holds the records, one table
// word, and the padding up to sixteen: four bytes short, every pass reading the stand-in fails.
test('the empty shadow records fill the smallest ShadowData binding WGSL accepts', () => {
  installGpuGlobals();
  const made = () => ({ createView: () => ({}), destroy() {} });
  const device = {
    createBuffer: ({ label, size }: { label?: string; size: number }) => ({
      label,
      size,
      ...made(),
    }),
    createTexture: made,
    createSampler: () => ({}),
    queue: { writeBuffer() {} },
  } as unknown as GPUDevice;
  const { slices } = createDeferredPlaceholders(device);
  const records = MAX_SHADOW_SLICES * SHADOW_RECORD_FLOATS * 4;
  assert.ok(slices.size >= Math.ceil((records + 4) / 16) * 16);
});
