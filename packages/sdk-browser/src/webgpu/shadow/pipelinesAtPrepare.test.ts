// #989: every pipeline the shadow pass draws with is compiled at prepare. The frames after it — the
// first shadows, a caster moving then resting — compile none: not the light cut's row map, nor the
// static layer's page pyramids and occlusion test at the first move, nor the transmittance
// layer's draws at the first blended caster.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../../../../sdk-core/src/index.ts';
import { SUN } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { collectClusterPages } from '../../page/selection/selection.ts';
import { packDagSelection } from '../../gpu/dag/selection.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { webgpuPagesBackend } from '../pages/pages.ts';
import { camera, disposeQuadRun, mixedBinScene, quadScene } from '../pages/testScenes.fixture.ts';

const LIMITS = {
  maxBufferSize: 1 << 28,
  maxStorageBufferBindingSize: 1 << 27,
  maxTextureDimension2D: 8192,
  maxComputeWorkgroupsPerDimension: 65535,
};
const MAKERS = [
  'createRenderPipeline',
  'createComputePipeline',
  'createRenderPipelineAsync',
  'createComputePipelineAsync',
];
/** The entry points of the shadow pass's pipelines: the page and blended draws, the row map, the
 *  Hi-Z kernels and the occlusion test. */
const SHADOW_ENTRY = /^(shadow|page_quad|mapRows|buildHiz|testHiz)/;

type Stages = Partial<Record<'vertex' | 'compute', { entryPoint: string }>>;

/** A pose `x` metres along the X axis. */
const along = (x: number) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1]);

/** The red quad, or an opaque triangle beside a blended one that casts. */
function scene(blended: boolean) {
  if (!blended) return quadScene();
  const mixed = mixedBinScene();
  mixed.metadata.primitives[1].pass = 'clustered-blend';
  Object.assign(mixed.both, { transparent: true, transparentShadow: true, opacity: 0.5 });
  return { ...mixed, geometry: mixed.geoA, material: mixed.front };
}

/** The shadow pipelines made after prepare while a caster lit by a sun moves eight frames then
 *  rests four, under the CPU or the GPU cut. */
async function shadowPipelinesAfterPrepare(gpuCut: boolean, blended = false) {
  installGpuGlobals();
  const fixture = scene(blended);
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const gpu = mockGpu({
    packed: gpuCut ? packDagSelection(roots) : undefined,
    limits: LIMITS,
    compute: true,
  });
  const made: string[] = [];
  const device = gpu.device as unknown as Record<string, (d: Stages) => unknown>;
  for (const name of MAKERS) {
    const make = device[name]?.bind(device);
    if (!make) continue;
    device[name] = (d) => {
      const entry = (d.compute ?? d.vertex)!.entryPoint;
      if (SHADOW_ENTRY.test(entry)) made.push(entry);
      return make(d);
    };
  }
  const sceneLights = createSceneLightStore();
  sceneLights.add(SUN);
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: gpu.device,
    maxResidentPages: 4,
    viewport: [32, 32],
    pixelError: 0,
    sceneLights,
  });
  fixture.source.children[0].name = 'caster';
  await backend.prepare();
  made.length = 0;
  for (let frame = 0; frame < 12; frame++) {
    const x = Math.min(frame, 7) * 0.05;
    backend.setTransform!('caster', along(x));
    const view = camera();
    view.position.x = x / 2;
    view.updateMatrixWorld();
    backend.render(view);
    await backend.flush?.();
  }
  const drawn = backend.metrics().shadowPagesTotal ?? 0;
  disposeQuadRun(backend, fixture);
  return { made, drawn };
}

for (const [gpuCut, blended, name] of [
  [false, false, 'CPU cut'],
  [true, false, 'GPU cut'],
  [true, true, 'a blended caster the scene declares'],
] as const)
  test(`no shadow pipeline is made after prepare as a caster moves then rests (${name})`, async () => {
    const { made, drawn } = await shadowPipelinesAfterPrepare(gpuCut, blended);
    assert.ok(drawn > 0, 'the shadow pages are drawn');
    assert.deepEqual(made, []);
  });
