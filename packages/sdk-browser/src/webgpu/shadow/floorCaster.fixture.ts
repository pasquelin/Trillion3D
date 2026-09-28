// A fixed floor and a caster named `caster` over it, lit by one light, on the whole pages backend
// over a mock GPU that runs the GPU cut: what the shadow tests of #990 open.
import {
  createSceneLightStore,
  type ClusterManifest,
  type SceneLight,
} from '../../../../sdk-core/src/index.ts';
import type { PlacementRows } from '../../placement/rows.ts';
import { MANIFEST_IDENTITY } from '../../backend/pagesBackend.fixture.ts';
import type { BackendContext } from '../../backend/types.ts';
import { collectClusterPages } from '../../page/selection/selection.ts';
import { packDagSelection } from '../../gpu/dag/selection.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { webgpuPagesBackend } from '../pages/pages.ts';
import { SHADOW_LIMITS, mixedBinScene } from '../pages/testScenes.fixture.ts';

/** The backend over the floor and the caster, lit by `light`, with whatever `options` add, the
 *  caster placed by the rows of `placements` when given; prepared. */
export async function floorCasterBackend(
  light: SceneLight,
  { placements, ...options }: Partial<BackendContext> & { placements?: PlacementRows } = {},
) {
  installGpuGlobals();
  const mixed = mixedBinScene();
  const scene = {
    ...mixed,
    metadata: { ...mixed.metadata, ...MANIFEST_IDENTITY } as ClusterManifest,
  };
  const [caster, floor] = scene.source.children;
  caster.name = 'caster';
  const links: BackendContext['associations'] = scene.associations;
  if (placements) links.get(caster)!.placements = placements;
  const { roots } = collectClusterPages(
    scene.source,
    scene.metadata,
    scene.indices,
    scene.associations,
  );
  const gpu = mockGpu({ packed: packDagSelection(roots), limits: SHADOW_LIMITS, compute: true });
  const lights = createSceneLightStore();
  lights.add(light);
  const backend = webgpuPagesBackend({
    ...scene,
    gpuDevice: gpu.device,
    maxResidentPages: 4,
    viewport: [32, 32],
    pixelError: 0,
    sceneLights: lights,
    ...options,
  });
  await backend.prepare();
  return { backend, gpu, lights, scene, caster, floor };
}
