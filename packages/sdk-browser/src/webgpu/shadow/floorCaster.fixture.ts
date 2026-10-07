// A fixed floor and a caster named `caster` over it, lit by one light, on the whole pages backend
// over a mock GPU that runs the GPU cut: what the shadow tests open.
import {
  createSceneLightStore,
  type ClusterManifest,
  type SceneLight,
} from '../../../../sdk-core/src/index.ts'
import type { PlacementRows } from '../../placement/rows.ts'
import { MANIFEST_IDENTITY } from '../../engine/pagesEngine.fixture.ts'
import type { EngineContext } from '../../engine/types.ts'
import { collectClusterPages } from '../../page/selection/selection.ts'
import { packDagSelection } from '../../gpu/dag/selection.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import { webgpuPagesEngine } from '../pages/pages.ts'
import { SHADOW_LIMITS, mixedBinScene } from '../pages/testScenes.fixture.ts'

/** The backend over the floor and the caster, lit by `light`, with whatever `options` add, the
 *  caster placed by the rows of `placements` when given; prepared. */
export async function floorCasterBackend(
  light: SceneLight,
  { placements, ...options }: Partial<EngineContext> & { placements?: PlacementRows } = {},
) {
  installGpuGlobals()
  const mixed = mixedBinScene()
  const scene = {
    ...mixed,
    metadata: { ...mixed.metadata, ...MANIFEST_IDENTITY } as ClusterManifest,
  }
  const [caster, floor] = scene.source.children
  caster.name = 'caster'
  const links: EngineContext['associations'] = scene.associations
  if (placements) links.get(caster)!.placements = placements
  const { roots } = collectClusterPages(
    scene.source,
    scene.metadata,
    scene.indices,
    scene.associations,
  )
  const gpu = mockGpu({ packed: packDagSelection(roots), limits: SHADOW_LIMITS })
  const lights = createSceneLightStore()
  lights.add(light)
  const backend = webgpuPagesEngine({
    ...scene,
    gpuDevice: gpu.device,
    maxResidentPages: 4,
    viewport: [32, 32],
    pixelError: 0,
    sceneLights: lights,
    ...options,
  })
  await backend.prepare()
  return { backend, gpu, lights, scene, caster, floor }
}
