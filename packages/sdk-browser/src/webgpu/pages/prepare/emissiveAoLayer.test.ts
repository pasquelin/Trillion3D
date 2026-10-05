// S8: the emission-and-occlusion layer (8 B/px) is an image's only when one of its surfaces can
// mark a texel of it. Without, the resolve leaves its attachment empty and marks nothing, and the
// readers bind a 1×1 `(0, 0, 0, 1)` they never load. A surface that comes to emit brings the layer
// before the first image that draws it, its classes compiled off the frame meanwhile.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as G from '../../../host/graph/graph.fixture.ts';
import { MATERIAL_SURFACES_PASS } from '../../../stage/passLabels.ts';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { camera, disposeQuadRun, quadScene } from '../testScenes.fixture.ts';
import { webgpuPagesBackend } from '../pages.ts';
import { runtime } from './targets.fixture.ts';
import { frameTargetAllocation } from './targetAllocation.ts';
import { wantsEmissiveAo } from './emissiveAoLayer.ts';

type Gpu = ReturnType<typeof mockGpu>;
const count = (list: string[], item: string) => list.filter((at) => at === item).length;

async function opened(emits: boolean) {
  installGpuGlobals();
  const gpu = mockGpu({ compute: true });
  const fixture = quadScene();
  const material = G.standardSurface({ roughness: 0.5 });
  if (emits) (material.emissive as G.Color).setRGB(0.5, 0.25, 0);
  (fixture.source.children[0] as G.HostMesh).material = material;
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: gpu.device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  await backend.prepare();
  // The images it takes for the frame targets to settle (made aside, then in place).
  for (let image = 0; image < 3; image++) {
    backend.render(camera());
    await backend.flush?.();
  }
  return { gpu, fixture, backend, material };
}

/** The live half-float surface targets' sizes, the resolve's pipelines and its last pass. */
function surfacesOf(gpu: Gpu) {
  const layers = gpu.textures
    .filter(({ label, destroyed }) => label === 'Trillion3D surface v1 rgba16float' && !destroyed)
    .map(({ width, height }) => `${width}×${height}`);
  const shade = gpu.renderPipelines
    .filter(({ fragment }) => fragment?.entryPoint?.startsWith('shade_fs'))
    .map(({ fragment }) => ({
      target: [...fragment!.targets][2] ?? null,
      constant: fragment!.constants?.EMISSIVE_AO,
    }));
  const pass = gpu.passes.filter(({ label }) => label === MATERIAL_SURFACES_PASS).at(-1);
  return { layers, shade, slot: pass?.formats[2] };
}

test('an image none of whose surfaces emits or occludes holds a 1×1 stand-in and writes no layer', async () => {
  const { gpu, fixture, backend } = await opened(false);
  try {
    const seen = surfacesOf(gpu),
      sets = seen.layers.length / 3;
    // Each frame set: two layers of the frame's size, the third a stand-in.
    assert.equal(count(seen.layers, '1×1'), sets);
    assert.equal(count(seen.layers, '32×32'), 2 * sets);
    assert.ok(seen.shade.length > 0);
    for (const pipeline of seen.shade) assert.deepEqual(pipeline, { target: null, constant: 0 });
    assert.equal(seen.slot, '', 'the attachment is empty');
  } finally {
    disposeQuadRun(backend, fixture);
  }
});

test('an emitting surface keeps the layer, written by the pipelines of before', async () => {
  const { gpu, fixture, backend } = await opened(true);
  try {
    const seen = surfacesOf(gpu);
    assert.equal(count(seen.layers, '1×1'), 0);
    for (const pipeline of seen.shade)
      assert.deepEqual(pipeline, { target: { format: 'rgba16float' }, constant: undefined });
    assert.equal(seen.slot, 'rgba16float');
  } finally {
    disposeQuadRun(backend, fixture);
  }
});

test('a surface made to emit after open brings the layer before the image that draws it', async () => {
  const { gpu, fixture, backend, material } = await opened(false);
  const hdr = () =>
    gpu.textures.filter(
      ({ label, destroyed }) => label === 'Trillion3D HDR lighting' && !destroyed,
    );
  try {
    const lit = hdr(),
      before = surfacesOf(gpu).layers,
      standIn = gpu.textures.find(
        ({ label, width }) => label === 'Trillion3D surface v1 rgba16float' && width === 1,
      )!;
    (material.emissive as G.Color).setRGB(0, 0.5, 1);
    material.needsUpdate = true;
    backend.refreshMaterials?.(true);
    const resolves = () => gpu.passes.filter(({ label }) => label === MATERIAL_SURFACES_PASS);
    const drawn = resolves().length;
    backend.render(camera());
    // The census heard the surface: the image is held while the classes that write the layer
    // compile, off the frame — none is drawn without it, none compiled by the frame.
    assert.equal(resolves().length, drawn, 'held, the previous image shown');
    await backend.flush?.();
    const seen = surfacesOf(gpu);
    assert.equal(seen.slot, 'rgba16float', 'the first image drawn writes the emission');
    assert.equal(
      count(seen.layers, '32×32'),
      count(before, '32×32') + 1,
      'the drawn view grew one',
    );
    assert.equal(count(seen.layers, '1×1'), count(before, '1×1'), 'its stand-in kept a while');
    // The classes compiled since write it; the other targets stay in place.
    assert.deepEqual(seen.shade.at(-1), { target: { format: 'rgba16float' }, constant: undefined });
    // The scene's one class keeps its direct draw, now writing the layer: no tile classified.
    const shaded = gpu.draws.filter(({ entryPoint }) => entryPoint?.startsWith('shade_'));
    assert.equal(shaded.at(-1)?.entryPoint, 'shade_vs', 'drawn whole, as before it emitted');
    assert.deepEqual(hdr(), lit, 'no frame target remade');
    backend.dispose();
    assert.equal(standIn.destroyed, true, 'the stand-in goes with the buffer that took its place');
  } finally {
    disposeQuadRun(backend, fixture);
  }
});

test("the frame's bytes count the layer only where it is made; water and cards keep it", () => {
  const { rt } = runtime();
  rt.vis.writesEmissiveAo = true;
  const full = frameTargetAllocation(rt, {
    width: 64,
    height: 32,
    renderWidth: 64,
    renderHeight: 32,
    apart: false,
  });
  rt.vis.writesEmissiveAo = false;
  const size = { width: 64, height: 32, renderWidth: 64, renderHeight: 32, apart: false };
  assert.equal(full - frameTargetAllocation(rt, size), 64 * 32 * 8 - 8);
  const scene = (patch: object) =>
    wantsEmissiveAo({
      context: {},
      blendState: { transmissive: 0 },
      gpu: {},
      vis: { shadeCensus: { emits: false } },
      ...patch,
    } as unknown as Parameters<typeof wantsEmissiveAo>[0]);
  assert.equal(scene({}), false);
  assert.equal(scene({ vis: { shadeCensus: { emits: true } } }), true, 'a surface emits');
  assert.equal(scene({ blendState: { transmissive: 1 } }), true, 'the water composite reads it');
  assert.equal(scene({ gpu: { impostorCode: {} } }), true, 'a card carries its occlusion');
});
