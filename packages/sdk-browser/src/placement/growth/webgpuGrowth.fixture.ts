import * as G from '../../scene/host/graph/graph.fixture.ts'
import { Group } from '../../../../sdk-core/src/world/object/object3d.ts'
import { createSceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts'
import type { SceneLight } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { MANIFEST_IDENTITY, dagRoots } from '../../session/engine/pagesEngine.fixture.ts'
import { QUAD_MANIFEST, triangleGeometry } from '../../session/engine/pagesEngineScenes.fixture.ts'
import { rootPage } from '../../frame/backend/rootPages.fixture.ts'
import { cameraAt } from '../../frame/backend/twoPlaces.fixture.ts'
import {
  cellUrl,
  io,
  noBudget,
  opened,
  settled,
  world,
} from '../../geometry/partition/cells.fixture.ts'
import type { RowLink } from '../../geometry/partition/rows.ts'
import { collectClusterPages } from '../../geometry/selection/collect.ts'
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { createWebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { prepareWebgpuBackend } from '../../frame/prepare/prepare.ts'
import { disposeWebgpuPages } from '../../frame/io/metrics.ts'
import { renderWebgpuPages } from '../../frame/render/render.ts'
import { flushWebgpuPages } from '../../frame/render/flush.ts'
import { PAGE_INFO_STRIDE } from '../../visibility/types.ts'
import { readoutRow } from '../../geometry/dag/bufferTable.ts'
import { dagWorkLayout } from '../../geometry/dag/shader/floorWgsl.ts'
import { WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { updateWebgpuPlacements } from '../webgpuPlacements.ts'
import { webgpuPlacementApi } from './webgpuGrowth.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'
import { graphDraws } from '../../geometry/selection/drawSource.ts'
import { createTextureCaches } from '../../materials/texture/textureCaches.ts'
import { createPageCache } from '../../geometry/streaming/pageCache.ts'
import type { PageMesh } from '../../geometry/pages/pageMesh.ts'

/** A ground triangle, and the two primitives of the mesh the partition places (`cells.fixture`),
 *  each a triangle of one root cluster, on the rows of `links`. */
function placedScene(links: readonly RowLink[]) {
  const geometries = [0, 1, 2].map(() => triangleGeometry())
  const surface = G.basicSurface({ color: 0xff0000, side: G.DOUBLE_SIDE })
  const [ground, ...leaves] = geometries.map((geometry) => G.mesh(geometry, surface))
  const source = new Group()
  source.add(ground, ...leaves)
  const structure = { version: 1, roots: [0], groups: [] }
  const primitive = (mesh: number, rank: number, url: string) => ({
    mesh,
    primitive: rank,
    pass: 'exact-clusters',
    ...dagRoots([rootPage(url, [-1, -1, 0], [1, 1, 0])]),
    structure,
  })
  const metadata: ClusterManifest = {
    ...QUAD_MANIFEST,
    primitives: [primitive(0, 0, 'ground'), primitive(7, 0, 'leaf-0'), primitive(7, 1, 'leaf-1')],
    ...MANIFEST_IDENTITY,
  }
  const indices = new Map(
    ['ground', 'leaf-0', 'leaf-1'].map((url) => [url, new Uint32Array([0, 1, 2])]),
  )
  const associations = new Map<PageMesh, RowLink>([
    [ground, { meshes: 0, primitives: 0 }],
    [leaves[0], links[0]],
    [leaves[1], links[1]],
  ])
  const dispose = () => [...geometries, surface].forEach((item) => item.dispose())
  return {
    source,
    metadata,
    indices,
    associations,
    draws: graphDraws(source, associations),
    dispose,
  }
}

/** Pages the scene packs, grown: the ground and four leaf rows of two pages. */
const SCENE_PAGES = 9
/** The page-table rows the scene holds grown: the ground's, and one for each of the six leaf
 *  placements it draws (the near cell's four, the two grown in place). The binding a session that
 *  holds them all needs at least. */
export const GROWN_ROWS = 7

/**
 * The partition of `cells.fixture` — its near cell's two nodes on rows sized at open, its far one
 * five kilometres off under the same core node — drawn by a WebGPU session on a mocked device
 * whose storage binding holds `bindingRows` page-table rows, the GPU cut drawing: rows that outgrow
 * their buffer grow in place, a cut made over them (`webgpuGrowth.ts`).
 * The session is handed the partition's rows as a world hands them (`partitionFrame.ts`).
 */
export async function placedSession(bindingRows: number, light?: SceneLight) {
  installGpuGlobals()
  // Grids of 100 m: rows for the near cell's two nodes alone.
  const partition = world(0, 0, [], [100, 100, 100])
  const { cells, links, bytes } = partition
  await opened(cells, bytes, true, [1e9, 0, 0]) // rows for the ranges, nothing read
  const scene = placedScene(links)
  const collected = collectClusterPages(
    scene.source,
    graphDraws(scene.source, scene.associations),
    scene.metadata,
    scene.indices,
  )
  // A binding of `bindingRows` table rows, no smaller than the GPU cut's readout at the scene's list
  // cap nor its `work`, grown or not, at a capacity grown twice (`grownCutCapacity`): the cut is the
  // engine's one cut, and a device that cannot hold it refuses the scene (#1483).
  const work = 4 * dagWorkLayout(ceilDiv(2 * SCENE_PAGES, WORKGROUP_THREADS)).words
  const binding = Math.max(bindingRows * PAGE_INFO_STRIDE, readoutRow(SCENE_PAGES).size, work)
  // The double runs the cut on the DAG the session uploads, the grown one too (`fakeDag.ts`).
  const gpu = fakeDevice({
    ...BACKEND,
    limits: { maxBufferSize: Math.max(1 << 20, binding), maxStorageBufferBindingSize: binding },
  })
  const sceneLights = createSceneLightStore()
  if (light) sceneLights.add(light)
  const rt = createWebgpuPagesRuntime({
    textureCaches: createTextureCaches(createPageCache()),
    ...scene,
    ...(light ? { sceneLights } : {}),
    gpuDevice: gpu.device,
    maxResidentPages: 3,
    viewport: [1, 1], // The intentionally tiny storage limit also bounds receiver offsets.
  })
  const { port, held, outgrown: reopened, rebind } = io(bytes)
  ;['near.json', 'far.json'].forEach((name) => held.add(cellUrl(name)))
  port.update = (rows, from, to) => updateWebgpuPlacements(rt, rows, from, to)
  const { growsInPlace, growPlacements } = webgpuPlacementApi(rt)
  port.grow = {
    growsInPlace,
    growPlacements: (from, to) => (growPlacements(from, to), rebind(from, to)),
  }
  const view = cameraAt(0, 30)
  const draw = async () => {
    renderWebgpuPages(rt, view)
    await flushWebgpuPages(rt)
  }
  const dispose = () => {
    disposeWebgpuPages(rt)
    scene.dispose()
  }
  try {
    await prepareWebgpuBackend(rt, gpu.device)
    await settled(cells, [0, 0, 0], port, noBudget)
    await draw()
  } catch (error) {
    dispose()
    throw error
  }
  return {
    rt,
    ...partition,
    io: port,
    draw,
    reopened,
    dispose,
    metadata: scene.metadata,
    allPages: collected.allPages,
    collectedRoots: collected.roots,
  }
}

/** Shrinks the core node a thousand times: the far cell comes within range, one more node than
 *  the rows hold. The frames a world runs until the page and the cell it brings are decoded; the
 *  image whose entry asks the cut over the grown rows (`startGrownCut`) — taken in place by the
 *  running cut, or made beside it —, that cut made, and the image whose entry adopts it. */
export async function scaleDown(session: Awaited<ReturnType<typeof placedSession>>) {
  const { cells, core, io, rt, draw } = session
  core.scale.set(1e-3, 1e-3, 1e-3)
  await settled(cells, [0, 0, 0], io, noBudget)
  await draw()
  await rt.growth?.making
  await draw()
}
