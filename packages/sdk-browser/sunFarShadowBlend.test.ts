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
import { BLEND_SHADER } from './webgpuPagesShaders.ts';

/** Un dispositif factice qui rend ce qu'on lui demande de créer, mappage compris. */
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

/** Les entrées d'une disposition, telles que le dispositif factice les a reçues. */
type LayoutEntries = { entries: Array<GPUBindGroupLayoutEntry> };
const entriesOf = (layout: unknown) => (layout as LayoutEntries).entries;

/** Le corps de `sunFarShadowFactor` d'un module, de sa signature à son accolade fermante. */
function farShadowSource(wgsl: string) {
  const start = wgsl.indexOf('fn sunFarShadowFactor(');
  assert.notEqual(start, -1, 'le module porte bien une ombre lointaine');
  const end = wgsl.indexOf('\n}', start);
  return wgsl.slice(start, end + 2);
}

test('la passe de mélange tire le vrai rayon d’ombre lointaine, plus un bouchon', () => {
  const blend = farShadowSource(BLEND_SHADER);
  assert.match(blend, /proxyBlocked\(origin,L,/, 'le rayon est tiré contre le proxy résident');
  assert.match(blend, /proxy\.present<0\.5/, 'sans proxy, la surface reste éclairée sans ombre');
  assert.doesNotMatch(
    BLEND_SHADER,
    /fn sunFarShadowFactor\(P:vec3f,N:vec3f,L:vec3f\)->f32\{return 1\.0;\}/,
    'plus aucun bouchon qui rende un sans avoir cherché',
  );
});

test('les deux passes qui éclairent tirent le même rayon, aux compteurs près', () => {
  // Les deux seules lignes qui séparent les deux ombres lointaines sont les compteurs du relevé, que
  // la passe de mélange ne porte pas : elle lie le proxy en lecture seule pour garder le rejet
  // anticipé de profondeur. Retirées du côté opaque, les deux corps sont identiques caractère pour
  // caractère — origine, bornes et réponse du rayon comprises.
  const compteurs = /^ (let counting=|if\(counting\)\{atomicAdd).*\n/gm;
  assert.equal(
    farShadowSource(BLEND_SHADER),
    farShadowSource(DIRECT_LIGHTING_WGSL).replace(compteurs, ''),
  );
  assert.doesNotMatch(farShadowSource(BLEND_SHADER), /atomic/, 'aucun compteur dans le mélange');
  assert.match(farShadowSource(DIRECT_LIGHTING_WGSL), /atomicAdd\(&proxy\.tested/);
  // Le reste du socle ne diffère que par le rang de la liaison du proxy et par son accès, que les
  // deux dispositions ne numérotent ni ne déclarent pareil.
  const socle = (wgsl: string) => wgsl.slice(0, wgsl.indexOf('fn pixelTile('));
  assert.notEqual(
    socle(declaredLightingWgsl(BLEND_BINDINGS.proxy)),
    socle(DIRECT_LIGHTING_WGSL),
    'le mélange ne reprend ni le rang ni l’accès de la résolution différée',
  );
});

test('le proxy résident est lié aux deux passes, sur une seule liaison de stockage', async () => {
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
  // Le mélange lit le proxy, la résolution différée l'écrit : c'est elle seule qui tient les deux
  // compteurs du relevé, et c'est cette lecture seule qui rend au mélange son rejet anticipé.
  for (const [nom, found, type] of [
    ['mélange', inBlend, 'read-only-storage'],
    ['différée', inDeferred, 'storage'],
  ] as Array<[string, GPUBindGroupLayoutEntry[], GPUBufferBindingType]>) {
    assert.equal(found.length, 1, `la passe ${nom} lie le proxy une fois et une seule`);
    assert.equal(found[0].buffer?.type, type, `l’accès de la passe ${nom}`);
    assert.equal(found[0].visibility, GPUShaderStage.FRAGMENT);
  }
  // La déclaration WGSL suit le rang ET l'accès de la disposition : le nuanceur et le groupe ne
  // peuvent pas diverger, ni sur le nombre ni sur le droit d'écrire.
  assert.match(
    BLEND_SHADER,
    new RegExp(`@binding\\(${BLEND_BINDINGS.proxy}\\) var<storage,read> proxy:`),
  );
  assert.match(
    residentProxyWgsl(SUN_FAR_PROXY_BINDING),
    new RegExp(`@binding\\(${SUN_FAR_PROXY_BINDING}\\) var<storage,read_write> proxy:`),
  );
});

test('sans proxy, les deux passes lisent le même entête de zéros', () => {
  installGpuGlobals();
  const device = fakeDevice();
  const placeholders = createDeferredPlaceholders(device);
  const remplacant = placeholders.proxy as unknown as { size: number };
  assert.ok(
    remplacant.size >= PROXY_HEADER_BYTES + 4,
    'le remplaçant porte un entête entier et un mot derrière lui',
  );
  assert.ok(new Uint32Array(PROXY_HEADER_WORDS).every((word) => word === 0));
  // Rien n'est adopté : les deux passes retombent donc sur ce même remplaçant, où la présence vaut
  // zéro. Aucune des deux ne tire de rayon, et aucune n'a de compteur à relever.
  const sunFar = createGpuSunFarShadow(device);
  assert.equal(
    sunFar.buffer(),
    undefined,
    'aucun tampon à lier tant qu’aucun proxy n’est résident',
  );
  let encoded = 0;
  sunFar.prepare(
    {
      clearBuffer: () => encoded++,
      copyBufferToBuffer: () => encoded++,
    } as unknown as GPUCommandEncoder,
    0,
  );
  assert.equal(encoded, 0, 'sans proxy, l’image n’encode ni remise à zéro ni relevé');
  assert.equal(sunFar.counts(), undefined, 'aucun compteur déduit');
});
