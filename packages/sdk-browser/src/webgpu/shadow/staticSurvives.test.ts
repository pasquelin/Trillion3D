// #990: a page whose static casters did not change keeps them in the static layer. Once a caster
// moves, the pages it crosses are restored from that layer and its moving casters drawn over —
// also when the light cut draws one short, and when a moving caster is hidden —, while what
// changes the static casters themselves (a still caster hidden, a lamp moved, a surface's alpha
// changed) draws them again.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SceneLight } from '../../../../sdk-core/src/index.ts';
import { LAMP, SUN } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { OUT_FLAGS } from '../../gpu/dag/layout.ts';
import { WORK_DROPPED } from '../../gpu/dag/shader/viewsWgsl.ts';
import { SHADOW_LAYER_PASS } from '../../gpu/shadow/staticLayer.ts';
import { along, camera, disposeQuadRun } from '../pages/testScenes.fixture.ts';
import { floorCasterBackend } from './floorCaster.fixture.ts';

/** What a frame's shadow pass drew. */
type Drawn = { pages: number; layerPasses: number; cleared: number; restored: number };

/**
 * A floor that never moves and a caster over it, lit by `light` under the GPU cut. `frame` runs one
 * image after `act`, the light cut dropping work when `dropped`, and says what its shadow pass drew:
 * the static layer's passes, the pool pages cleared and those restored from the static layer.
 */
async function floorAndCaster(light: SceneLight = SUN) {
  const { backend, gpu, lights, scene, caster, floor } = await floorCasterBackend(light);
  const view = camera();
  const flags = () => {
    const out = gpu.buffers.find(({ label }) => label === 'Trillion3D light cut output')!;
    return new Uint32Array(out.data.buffer, out.data.byteOffset, OUT_FLAGS + 1);
  };
  const frame = async (act?: () => void, dropped = false): Promise<Drawn> => {
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
  const dispose = () => disposeQuadRun(backend, { geometry: scene.geoA, material: scene.front });
  return { backend, lights, scene, caster, floor, frame, move, warmUp, dispose };
}

/** Asserts that a frame drew pages, every one restored from the static layer, none into it. */
function restoredOnly(drawn: Drawn, what: string) {
  assert.ok(drawn.pages > 0, `${what}: pages drawn`);
  assert.equal(drawn.layerPasses, 0, `${what}: no static caster drawn`);
  assert.equal(drawn.cleared, 0, `${what}: no page cleared, the floor's depth kept`);
  assert.ok(drawn.restored > 0, `${what}: restored from the static layer`);
}

test('a caster moving over a fixed floor draws no static caster after warm-up, even drawn short', async () => {
  const run = await floorAndCaster();
  const { frame, move, warmUp } = run;
  await warmUp();
  for (let step = 5; step < 9; step++) restoredOnly(await frame(move(step * 0.05)), `move ${step}`);
  // Drawn short, its pages are drawn again: their moving casters, over the static layer.
  restoredOnly(await frame(move(0.45), true), 'the light cut dropped work, its pages drawn again');
  run.dispose();
});

test('a caster that stops draws nothing, and moving again redraws its moving casters alone', async () => {
  const run = await floorAndCaster();
  const { frame, move, warmUp } = run;
  await warmUp();
  for (let still = 0; still < 3; still++)
    assert.equal((await frame(move(0.2))).pages, 0, 'at rest: nothing drawn');
  // Its old place and its new one are drawn again, from the static layer: the old silhouette goes.
  restoredOnly(await frame(move(0.6)), 'moving again');
  run.dispose();
});

test('hiding a moving caster redraws its pages from the static layer; hiding the floor redraws it', async () => {
  const run = await floorAndCaster();
  const { frame, warmUp, caster, floor } = run;
  await warmUp();
  restoredOnly(await frame(() => void (caster.visible = false)), 'the moving caster hidden');
  restoredOnly(await frame(() => void (caster.visible = true)), 'shown again');
  const hidden = await frame(() => void (floor.visible = false));
  assert.ok(hidden.layerPasses > 0, 'the still floor hidden: the static layer drawn again');
  run.dispose();
});

test('a lamp that moves draws its static casters again', async () => {
  const run = await floorAndCaster(LAMP);
  const { frame, warmUp, lights } = run;
  await warmUp();
  assert.equal((await frame()).layerPasses, 0, 'nothing moved: nothing drawn');
  const moved = await frame(() => lights.set(LAMP.id, { position: [0.5, 3, 0] }));
  assert.ok(moved.pages > 0 && moved.layerPasses > 0, 'every page of the lamp, static layer too');
  run.dispose();
});

test("a still surface's changed alpha draws its static casters again", async () => {
  const run = await floorAndCaster();
  const { backend, frame, warmUp, scene } = run;
  await warmUp();
  const changed = await frame(() =>
    backend.refreshMaterials!(true, { surfaces: [scene.both], from: 'opaque', to: 'mask' }),
  );
  assert.ok(changed.layerPasses > 0, 'the floor re-rasterised into the static layer');
  run.dispose();
});
