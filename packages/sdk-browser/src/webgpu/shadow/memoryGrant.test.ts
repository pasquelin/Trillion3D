// #992: the shadows' one fixed grant counts the pool, its static layer and its transmittance layer
// together; memory pressure is an event by name, never a silent loss of resolution or of shadows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SUN } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { shadowPoolSize } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { SHADOW_BUFFER_BYTES, shadowAtlasBytes } from '../../gpu/shadow/sizes.ts';
import { shadowTransmittanceBytes } from '../../gpu/shadow/transmittance.ts';
import { shadowRequestBytes } from './allocLayout.ts';
import { admitShadowBytes, createShadowMemory } from './memoryGrant.ts';
import { staticLayerGranted } from './poolSize.ts';
import { createWebgpuLightState } from '../pages/state/lights.ts';
import { along, camera } from '../pages/testScenes.fixture.ts';
import { floorCasterBackend } from './floorCaster.fixture.ts';
import { shadowPoolFor } from './poolFor.ts';
import { SHADOW_ATLAS_BYTES, SHADOW_GRANT_BYTES } from '../../residency/shadowBudgetBytes.ts';
import { SHADOW_LAYER_PASS } from '../../stage/passLabels.ts';

test('the grant holds the largest pool with its static and transmittance layers, not a byte more', () => {
  const pool = shadowPoolFor(shadowPoolSize(16384, 16384), 64)(SHADOW_ATLAS_BYTES),
    { side, layers } = pool;
  const held = SHADOW_BUFFER_BYTES + pool.allocatedBytes + shadowRequestBytes(side ** 2 * layers);
  const late = shadowAtlasBytes(side, layers) + shadowTransmittanceBytes(side, layers);
  const memory = createShadowMemory();
  assert.ok(admitShadowBytes(memory, held, late), `${held + late} within ${SHADOW_GRANT_BYTES}`);
  assert.equal(memory.peakBytes, held + late, 'the peak counts the late layers with the pool');
  const short = createShadowMemory();
  assert.equal(admitShadowBytes(short, held, late, held + late - 1), false, 'one byte past');
  assert.equal(short.peakBytes, 0, 'a refused allocation holds nothing');
});

test('a static layer past the grant is never made, and said by name', () => {
  const lights = createWebgpuLightState(8),
    said: string[] = [];
  const say = (phase: string, _: string, context: Record<string, unknown>) =>
    void said.push(`${phase}:${String(context.pressure)}`);
  assert.equal(staticLayerGranted(lights, say), true, 'the grant holds it');
  const late = shadowAtlasBytes(8) + shadowTransmittanceBytes(8);
  assert.equal(lights.memory.peakBytes, shadowAtlasBytes(8), 'the peak holds only what is made');
  assert.equal(staticLayerGranted(lights, say, late), true, 'the layer to come is reserved');
  assert.equal(staticLayerGranted(lights, say, late - 1), false);
  assert.deepEqual(lights.memory.events, ['static-layer-over-grant']);
  assert.deepEqual(said, ['shadow-memory:static-layer-over-grant']);
  assert.equal(lights.memory.bias, 0, 'a layer not made costs no resolution');
});

test('a static layer asks too for the pair rows its occlusion list follows the cull to', () => {
  // #1363: the cull's kept list grown for the GPU pages' pairs; the occlusion test the layer
  // brings grows its list to the cull's rows (`followOcclusion`), counted in the grant.
  const lights = createWebgpuLightState(8),
    say = () => {};
  const layer = shadowAtlasBytes(8) + shadowTransmittanceBytes(8);
  lights.memory.pairBytes = 1024;
  assert.equal(staticLayerGranted(lights, say, layer + 2048), true, 'held and asked: twice');
  assert.equal(staticLayerGranted(lights, say, layer + 2047), false, 'its list is asked for');
});

/** The floor and its caster, the caster moved each frame; `refuse` has the device refuse the
 *  static layer as out of memory. Returns what each moving frame drew, and what was said. */
async function movingCaster(refuse: boolean) {
  const said: string[] = [];
  const { backend, gpu } = await floorCasterBackend(SUN, {
    diagnosticDetail: 'summary',
    onDiagnostic: ({ phase }) => void said.push(phase),
  });
  const device = gpu.device as unknown as { createTexture: (d: GPUTextureDescriptor) => unknown };
  const make = device.createTexture.bind(device);
  device.createTexture = (descriptor) => {
    const texture = make(descriptor);
    if (refuse && descriptor.label?.startsWith(SHADOW_LAYER_PASS)) gpu.raise('Out of memory');
    return texture;
  };
  const view = camera(),
    frames: Array<{ pages: number; layerPasses: number; restored: number }> = [];
  for (let step = 0; step <= 6; step++) {
    const pages = backend.metrics().shadowPagesTotal ?? 0,
      passes = gpu.passes.length,
      draws = gpu.draws.length;
    if (step) backend.setTransform!('caster', along(step * 0.05));
    backend.render(view);
    await backend.flush?.();
    await new Promise((settled) => setTimeout(settled, 0));
    frames.push({
      pages: (backend.metrics().shadowPagesTotal ?? 0) - pages,
      layerPasses: gpu.passes.slice(passes).filter(({ label }) => label === SHADOW_LAYER_PASS)
        .length,
      restored: gpu.draws.slice(draws).filter(({ fragment }) => fragment === 'restore_fs').length,
    });
  }
  const metrics = backend.metrics();
  await backend.dispose();
  return { frames, said, metrics };
}

test('without pressure the bias stays 0 and no event is named', async () => {
  const { frames, said, metrics } = await movingCaster(false);
  assert.ok(
    frames.some(({ restored }) => restored > 0),
    'the static layer was made and read',
  );
  assert.equal(metrics.shadowResolutionBias, 0);
  assert.deepEqual(metrics.shadowMemoryEvents, []);
  assert.ok(!said.includes('gpu-out-of-memory'));
  const peak = metrics.shadowPeakBytes ?? 0;
  assert.ok(peak >= (metrics.shadowPoolBytes ?? Infinity) && peak <= SHADOW_GRANT_BYTES, `${peak}`);
});

test('a refused static layer is named and every shadow page is still drawn, whole', async () => {
  const { frames, said, metrics } = await movingCaster(true);
  assert.ok(said.includes('gpu-out-of-memory'), 'the refusal is said');
  assert.deepEqual(metrics.shadowMemoryEvents, ['static-layer-refused']);
  assert.equal(metrics.shadowResolutionBias, 0, 'the pool keeps its resolution');
  for (const [step, { pages, layerPasses, restored }] of frames.entries()) {
    if (!step) continue;
    assert.ok(pages > 0, `move ${step}: the caster's pages are drawn`);
    assert.deepEqual([layerPasses, restored], [0, 0], `move ${step}: drawn whole, no layer`);
  }
});
