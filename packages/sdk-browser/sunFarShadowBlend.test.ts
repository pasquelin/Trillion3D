import test from 'node:test';
import assert from 'node:assert/strict';
import { PROXY_HEADER_BYTES, PROXY_HEADER_WORDS, residentProxyWgsl } from './bounceNodeWgsl.ts';
import { createDeferredLayouts, createDeferredPlaceholders } from './deferredLightingSetup.ts';
import { DIRECT_LIGHTING_WGSL, declaredLightingWgsl } from './directLightingWgsl.ts';
import { createGpuSunFarShadow } from './gpuSunFarShadow.ts';
import { SUN_FAR_PROXY_BINDING } from './sunFarShadowWgsl.ts';
import { BLEND_BINDINGS } from './webgpuBindLayout.ts';
import { createWebgpuBlendPipelines } from './webgpuBlendPipelines.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { BLEND_SHADER } from './webgpuBlendShader.ts';

/** A fake device that returns what it is asked to create, mapping included. */
function fakeDevice(writes: Array<[number, number]> = []) {
  return {
    createBuffer: ({ size }: { size: number }) => {
      const bytes = new ArrayBuffer(size);
      return { size, getMappedRange: () => bytes, unmap() {}, destroy() {} };
    },
    createBindGroupLayout: (descriptor: unknown) => descriptor,
    createPipelineLayout: () => ({}),
    createRenderPipeline: () => ({}),
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createBindGroup: (descriptor: unknown) => descriptor,
    createTexture: () => ({ createView: () => ({}) }),
    createSampler: () => ({}),
    queue: {
      writeBuffer: (_buffer: unknown, offset: number, data: { length: number }) =>
        writes.push([offset, data.length]),
    },
  } as unknown as GPUDevice;
}

/** Layout entries, as the fake device received them. */
type LayoutEntries = { entries: Array<GPUBindGroupLayoutEntry> };
const entriesOf = (layout: unknown) => (layout as LayoutEntries).entries;

/** Body of a module's `sunFarShadowFactor`, from its signature to its closing brace. */
function farShadowSource(wgsl: string) {
  const start = wgsl.indexOf('fn sunFarShadowFactor(');
  assert.notEqual(start, -1, 'the module does carry a far shadow');
  const end = wgsl.indexOf('\n}', start);
  return wgsl.slice(start, end + 2);
}

test('the blend pass fires the real far-shadow ray, no plug', () => {
  const blend = farShadowSource(BLEND_SHADER);
  assert.match(blend, /proxyBlocked\(origin,L,/, 'the ray is fired against the resident proxy');
  assert.match(
    blend,
    /proxy\.present<0\.5/,
    'without a proxy, the surface stays lit without shadow',
  );
  assert.doesNotMatch(
    BLEND_SHADER,
    /fn sunFarShadowFactor\(P:vec3f,N:vec3f,L:vec3f\)->f32\{return 1\.0;\}/,
    'no plug left that returns one without having searched',
  );
});

test('both lighting passes fire the same ray, counters aside', () => {
  // The only two lines that separate the two far shadows are the report counters, which
  // the blend pass does not carry: it binds the proxy read-only to keep early depth
  // rejection. Taken out of the opaque side, the two bodies are identical character for
  // character — origin, bounds and ray answer included.
  const compteurs = /^ (let counting=|if\(counting\)\{atomicAdd).*\n/gm;
  assert.equal(
    farShadowSource(BLEND_SHADER),
    farShadowSource(DIRECT_LIGHTING_WGSL).replace(compteurs, ''),
  );
  assert.doesNotMatch(farShadowSource(BLEND_SHADER), /atomic/, 'no counter in the blend');
  assert.match(farShadowSource(DIRECT_LIGHTING_WGSL), /atomicAdd\(&proxy\.tested/);
  // The rest of the core differs only by the proxy binding rank and its access, which
  // the two layouts neither number nor declare the same.
  const socle = (wgsl: string) => wgsl.slice(0, wgsl.indexOf('fn pixelTile('));
  assert.notEqual(
    socle(declaredLightingWgsl(BLEND_BINDINGS.proxy)),
    socle(DIRECT_LIGHTING_WGSL),
    'the blend takes neither the rank nor the access of deferred resolve',
  );
});

test('the resident proxy is bound to both passes, on a single storage binding', async () => {
  installGpuGlobals();
  const device = fakeDevice();
  const { blendBindGroupLayout } = await createWebgpuBlendPipelines(device, []);
  const deferred = createDeferredLayouts(device, true, true);
  const inBlend = entriesOf(blendBindGroupLayout).filter(
    (entry) => entry.binding === BLEND_BINDINGS.proxy,
  );
  const inDeferred = entriesOf(deferred.lighting).filter(
    (entry) => entry.binding === SUN_FAR_PROXY_BINDING,
  );
  // The blend reads the proxy, deferred resolve writes it: it alone holds the two
  // report counters, and it is that read-only access that gives the blend its early reject.
  for (const [nom, found, type] of [
    ['blend', inBlend, 'read-only-storage'],
    ['deferred', inDeferred, 'storage'],
  ] as Array<[string, GPUBindGroupLayoutEntry[], GPUBufferBindingType]>) {
    assert.equal(found.length, 1, `pass ${nom} binds the proxy once and only once`);
    assert.equal(found[0].buffer?.type, type, `access of pass ${nom}`);
    assert.equal(found[0].visibility, GPUShaderStage.FRAGMENT);
  }
  // The WGSL declaration follows the layout's rank AND access: shader and group cannot
  // diverge, neither on the count nor on the right to write.
  assert.match(
    BLEND_SHADER,
    new RegExp(`@binding\\(${BLEND_BINDINGS.proxy}\\) var<storage,read> proxy:`),
  );
  assert.match(
    residentProxyWgsl(SUN_FAR_PROXY_BINDING),
    new RegExp(`@binding\\(${SUN_FAR_PROXY_BINDING}\\) var<storage,read_write> proxy:`),
  );
});

test('without a proxy, both passes read the same header of zeros', () => {
  installGpuGlobals();
  const device = fakeDevice();
  const placeholders = createDeferredPlaceholders(device);
  const remplacant = placeholders.proxy as unknown as { size: number };
  assert.ok(
    remplacant.size >= PROXY_HEADER_BYTES + 4,
    'the stand-in carries a whole header and a word behind it',
  );
  assert.ok(new Uint32Array(PROXY_HEADER_WORDS).every((word) => word === 0));
  // Nothing is adopted: both passes therefore fall back to this same stand-in, where presence is
  // zero. Neither fires a ray, and neither has a counter to sample.
  const sunFar = createGpuSunFarShadow(device);
  assert.equal(sunFar.buffer(), undefined, 'no buffer to bind until a proxy is resident');
  let encoded = 0;
  sunFar.prepare(
    {
      clearBuffer: () => encoded++,
      copyBufferToBuffer: () => encoded++,
    } as unknown as GPUCommandEncoder,
    0,
  );
  assert.equal(encoded, 0, 'without a proxy, the frame encodes neither a reset nor a sample');
  assert.equal(sunFar.counts(), undefined, 'no counter deduced');
});
