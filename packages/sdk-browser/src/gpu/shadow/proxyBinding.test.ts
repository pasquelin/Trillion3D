import test from 'node:test';
import assert from 'node:assert/strict';
import { RESIDENT_PROXY_BINDING, residentProxyWgsl } from '../../bounce/nodeWgsl.ts';
import { PROXY_HEADER_BYTES, PROXY_HEADER_WORDS } from '../../bounce/sizes.ts';
import {
  createDeferredLightingLayout,
  createDeferredPlaceholders,
} from '../../lighting/deferred/setup.ts';
import { BLEND_BINDINGS } from '../../webgpu/core/bindLayout.ts';
import { createWebgpuBlendPipelines } from '../../webgpu/blend/pipelines.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { BLEND_SHADER } from '../core/shaderTexts.fixture.ts';

/** Layout entries, as the fake device received them. */
type LayoutEntries = { entries: Array<GPUBindGroupLayoutEntry> };
const entriesOf = (layout: unknown) => (layout as LayoutEntries).entries;

test('the resident proxy is bound to both passes, on a single storage binding', async () => {
  const { device } = fakeDevice();
  const { blendBindGroupLayout } = await createWebgpuBlendPipelines(device, []);
  const deferred = createDeferredLightingLayout(device, true, true);
  const inBlend = entriesOf(blendBindGroupLayout).filter(
    (entry) => entry.binding === BLEND_BINDINGS.proxy,
  );
  const inDeferred = entriesOf(deferred).filter(
    (entry) => entry.binding === RESIDENT_PROXY_BINDING,
  );
  // Both read the proxy and write none of it: it is that read-only access that gives the blend its
  // early reject.
  for (const [nom, found, type] of [
    ['blend', inBlend, 'read-only-storage'],
    ['deferred', inDeferred, 'read-only-storage'],
  ] as Array<[string, GPUBindGroupLayoutEntry[], GPUBufferBindingType]>) {
    assert.equal(found.length, 1, `pass ${nom} binds the proxy once and only once`);
    assert.equal(found[0].buffer?.type, type, `access of pass ${nom}`);
    assert.equal(found[0].visibility, GPUShaderStage.FRAGMENT);
  }
  // The WGSL declaration follows the layout's rank AND access: shader and group cannot
  // diverge, neither on the count nor on the access.
  assert.match(
    BLEND_SHADER,
    new RegExp(`@binding\\(${BLEND_BINDINGS.proxy}\\) var<storage,read> proxy:`),
  );
  assert.match(
    residentProxyWgsl(RESIDENT_PROXY_BINDING),
    new RegExp(`@binding\\(${RESIDENT_PROXY_BINDING}\\) var<storage,read> proxy:`),
  );
});

test('without a proxy, both passes read the same header of zeros', () => {
  const { device } = fakeDevice();
  const placeholders = createDeferredPlaceholders(device);
  const remplacant = placeholders.proxy as unknown as { size: number };
  assert.ok(
    remplacant.size >= PROXY_HEADER_BYTES + 4,
    'the stand-in carries a whole header and a word behind it',
  );
  assert.ok(new Uint32Array(PROXY_HEADER_WORDS).every((word) => word === 0));
});
