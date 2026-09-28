// #990: a session disposed while its work is pending — the static shadow layer the first move
// allocates, its pyramids and occlusion test — cancels that work silently: the released device
// makes it throw, and that is its cancellation, not a failure. A device that fails under a live
// session still reports by name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore, type ClusterManifest } from '../../../../../sdk-core/src/index.ts';
import { SUN } from '../../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { MANIFEST_IDENTITY } from '../../../backend/pagesBackend.fixture.ts';
import type { BackendDiagnostic } from '../../../backend/types.ts';
import { collectClusterPages } from '../../../page/selection/selection.ts';
import { packDagSelection } from '../../../gpu/dag/selection.ts';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { webgpuPagesBackend } from '../pages.ts';
import { SHADOW_LIMITS, along, camera, mixedBinScene } from '../testScenes.fixture.ts';

/** A caster over a floor, lit by the sun, moved once: its static layer is on its way. `fail`
 *  breaks the device's layouts from then on; `dispose` closes the session before it lands.
 *  Returns what the session said. */
async function pendingStaticLayer(end: 'dispose' | 'fail') {
  installGpuGlobals();
  const mixed = mixedBinScene();
  const scene = {
    ...mixed,
    metadata: { ...mixed.metadata, ...MANIFEST_IDENTITY } as ClusterManifest,
  };
  scene.source.children[0].name = 'caster';
  const { roots } = collectClusterPages(
    scene.source,
    scene.metadata,
    scene.indices,
    scene.associations,
  );
  const gpu = mockGpu({ packed: packDagSelection(roots), limits: SHADOW_LIMITS, compute: true });
  const said: string[] = [];
  const lights = createSceneLightStore();
  lights.add(SUN);
  const backend = webgpuPagesBackend({
    ...scene,
    gpuDevice: gpu.device,
    maxResidentPages: 4,
    viewport: [32, 32],
    pixelError: 0,
    sceneLights: lights,
    diagnosticDetail: 'summary',
    onDiagnostic: ({ phase }: BackendDiagnostic) => void said.push(phase),
  });
  await backend.prepare();
  const view = camera();
  backend.render(view);
  await backend.flush?.();
  backend.setTransform!('caster', along(0.1));
  backend.render(view);
  said.length = 0;
  if (end === 'fail')
    (gpu.device as { createBindGroupLayout: () => never }).createBindGroupLayout = () => {
      throw new Error('device failed');
    };
  else void backend.dispose();
  for (let tick = 0; tick < 8; tick++) await new Promise((next) => setTimeout(next, 0));
  if (end === 'fail') void backend.dispose();
  return said;
}

test('a session disposed before its static shadow layer lands says nothing', async (t) => {
  const warned = t.mock.method(console, 'warn', () => {});
  assert.deepEqual(await pendingStaticLayer('dispose'), []);
  assert.deepEqual(
    warned.mock.calls.map((call) => call.arguments[0]),
    [],
  );
});

test('a device that fails under a live session still reports the static layer by name', async (t) => {
  t.mock.method(console, 'warn', () => {});
  assert.ok((await pendingStaticLayer('fail')).includes('shadow-static-layer-unavailable'));
});
