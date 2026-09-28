// #990: a page whose static casters did not change keeps them in the static layer. Once a caster
// moves, the pages it crosses are restored from that layer and its moving casters drawn over —
// also when the light cut draws one short, and when a moving caster is hidden —, while what
// changes the static casters themselves (a still caster hidden, a lamp moved, a surface's alpha
// changed) draws them again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore, type SceneLight } from '../../../../sdk-core/src/index.ts';
import { LAMP, SUN } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { collectClusterPages } from '../../page/selection/selection.ts';
import { packDagSelection } from '../../gpu/dag/selection.ts';
import { OUT_FLAGS } from '../../gpu/dag/layout.ts';
import { WORK_DROPPED } from '../../gpu/dag/shader/viewsWgsl.ts';
import { SHADOW_LAYER_PASS } from '../../gpu/shadow/staticLayer.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { webgpuPagesBackend } from '../pages/pages.ts';
import { camera, mixedBinScene } from '../pages/testScenes.fixture.ts';

const LIMITS = {
  maxBufferSize: 1 << 28,
  maxStorageBufferBindingSize: 1 << 27,
  maxTextureDimension2D: 8192,
  maxComputeWorkgroupsPerDimension: 65535,
};

/** A pose `x` metres along the X axis. */
const along = (x: number) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1]);

/**
 * A floor that never moves and a caster over it, lit by `light` under the GPU cut. `frame` runs one
 * image after `act`, the light cut dropping work when `dropped`, and says what its shadow pass drew:
 * the static layer's passes, the pool pages cleared and those restored from the static layer.
 */
async function floorAndCaster(light: SceneLight = SUN) {
  installGpuGlobals();
  const scene = mixedBinScene();
  const [caster, floor] = scene.source.children;
  caster.name = 'caster';
  const { roots } = collectClusterPages(
    scene.source,
    scene.metadata,
    scene.indices,
    scene.associations,
  );
  const gpu = mockGpu({ packed: packDagSelection(roots), limits: LIMITS, compute: true });
  const lights = createSceneLightStore();
  lights.add(light);
  const backend = webgpuPagesBackend({
    ...scene,
    geometry: scene.geoA,
    material: scene.front,
    gpuDevice: gpu.device,
    maxResidentPages: 4,
    viewport: [32, 32],
    pixelError: 0,
    sceneLights: lights,
  });
  await backend.prepare();
  const view = camera();
  const flags = () => {
    const out = gpu.buffers.find(({ label }) => label === 'Trillion3D light cut output')!;
    return new Uint32Array(out.data.buffer, out.data.byteOffset, OUT_FLAGS + 1);
  };
  const frame = async (act?: () => void, dropped = false) => {
    const passes = gpu.passes.length,
      draws = gpu.draws.length,
      pages = backend.metrics().shadowPagesTotal ?? 0;
    act?.();
    if (dropped) flags()[OUT_FLAGS] = WORK_DROPPED;
    backend.render(view);
    await backend.flush?.();
    flags()[OUT_FLAGS] = 0;
    // The flag readback settles after the frame: the next plan reads it.
    await new Promise((settled) => setTimeout(settled, 0));
    const quads = gpu.draws.slice(draws).filter(({ entryPoint }) => entryPoint === 'page_quad_vs');
    return {
      pages: (backend.metrics().shadowPagesTotal ?? 0) - pages,
      layerPasses: gpu.passes.slice(passes).filter(({ label }) => label === SHADOW_LAYER_PASS)
        .length,
      cleared: quads.filter(({ fragment }) => !fragment).length,
      restored: quads.filter(({ fragment }) => fragment === 'restore_fs').length,
    };
  };
  const move = (x: number) => () => backend.setTransform!('caster', along(x));
  /** The caster's first moves: the static layer is made, and the pages it crossed drawn whole. */
  const warmUp = async () => {
    for (let step = 1; step <= 4; step++) await frame(move(step * 0.05));
  };
  return { backend, lights, scene, caster, floor, frame, move, warmUp };
}

/** Asserts that a frame drew pages, every one restored from the static layer, none into it. */
function restoredOnly(
  drawn: Awaited<ReturnType<Awaited<ReturnType<typeof floorAndCaster>>['frame']>>,
  what: string,
) {
  assert.ok(drawn.pages > 0, `${what}: pages drawn`);
  assert.equal(drawn.layerPasses, 0, `${what}: no static caster drawn`);
  assert.equal(drawn.cleared, 0, `${what}: no page cleared, the floor's depth kept`);
  assert.ok(drawn.restored > 0, `${what}: restored from the static layer`);
}

test('a caster moving over a fixed floor draws no static caster after warm-up, even drawn short', async () => {
  const { frame, move, warmUp } = await floorAndCaster();
  await warmUp();
  for (let step = 5; step < 9; step++) restoredOnly(await frame(move(step * 0.05)), `move ${step}`);
  // Drawn short, its pages are drawn again: their moving casters, over the static layer.
  restoredOnly(await frame(move(0.45), true), 'the light cut dropped work, its pages drawn again');
});

test('a caster that stops draws nothing, and moving again redraws its moving casters alone', async () => {
  const { frame, move, warmUp } = await floorAndCaster();
  await warmUp();
  for (let still = 0; still < 3; still++)
    assert.equal((await frame(move(0.2))).pages, 0, 'at rest: nothing drawn');
  // Its old place and its new one are drawn again, from the static layer: the old silhouette goes.
  restoredOnly(await frame(move(0.6)), 'moving again');
});

test('hiding a moving caster redraws its pages from the static layer; hiding the floor redraws it', async () => {
  const { frame, warmUp, caster, floor } = await floorAndCaster();
  await warmUp();
  restoredOnly(await frame(() => void (caster.visible = false)), 'the moving caster hidden');
  restoredOnly(await frame(() => void (caster.visible = true)), 'shown again');
  const hidden = await frame(() => void (floor.visible = false));
  assert.ok(hidden.layerPasses > 0, 'the still floor hidden: the static layer drawn again');
});

test('a lamp that moves draws its static casters again', async () => {
  const { frame, warmUp, lights } = await floorAndCaster(LAMP);
  await warmUp();
  assert.equal((await frame()).layerPasses, 0, 'nothing moved: nothing drawn');
  const moved = await frame(() => lights.set(LAMP.id, { position: [0.5, 3, 0] }));
  assert.ok(moved.pages > 0 && moved.layerPasses > 0, 'every page of the lamp, static layer too');
});

test("a still surface's changed alpha draws its static casters again", async () => {
  const { backend, frame, warmUp, scene } = await floorAndCaster();
  await warmUp();
  const changed = await frame(() =>
    backend.refreshMaterials!(true, { surfaces: [scene.both], from: 'opaque', to: 'mask' }),
  );
  assert.ok(changed.layerPasses > 0, 'the floor re-rasterised into the static layer');
});
