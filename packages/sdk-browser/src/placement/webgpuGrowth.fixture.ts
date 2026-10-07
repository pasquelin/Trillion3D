import * as G from '../host/graph/graph.fixture.ts'
import { createSceneLightStore, type SceneLight } from '../../../sdk-core/src/index.ts'
import { MANIFEST_IDENTITY } from '../engine/pagesEngine.fixture.ts'
import { dagRoots } from '../engine/pagesEngine.fixture.ts'
import { QUAD_MANIFEST, triangleGeometry } from '../engine/pagesEngineScenes.fixture.ts'
import { rootPage } from '../webgpu/pages/rootPages.fixture.ts'
import { cameraAt } from '../webgpu/pages/twoPlaces.fixture.ts'
import { cellUrl, io, noBudget, opened, settled, world } from '../partition/cells.fixture.ts'
import type { RowLink } from '../partition/rows.ts'
import { collectClusterPages } from '../page/selection/selection.ts'
import { mockGpu } from '../../../../tests/kit/gpu/mockGpu.ts'
import { installGpuGlobals } from '../../../../tests/kit/gpu/globals.ts'
import { createWebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { prepareWebgpuBackend } from '../webgpu/pages/prepare/prepare.ts'
import { disposeWebgpuPages } from '../webgpu/pages/io/metrics.ts'
import { renderWebgpuPages } from '../webgpu/pages/render/render.ts'
import { flushWebgpuPages } from '../webgpu/pages/render/flush.ts'
import { PAGE_INFO_STRIDE } from '../visibility/buffer.ts'
import { readoutRow } from '../gpu/dag/bufferTable.ts'
import { updateWebgpuPlacements } from './webgpuPlacements.ts'
import { growWebgpuPlacements, grownCutMade, webgpuGrowsInPlace } from './webgpuGrowth.ts'
import type { ClusterManifest } from '../../../sdk-core/src/index.ts'

/** A ground triangle, and the two primitives of the mesh the partition places (`cells.fixture`),
 *  each a triangle of one root cluster, on the rows of `links`. */
function placedScene(links: readonly RowLink[]) {
  const geometries = [0, 1, 2].map(() => triangleGeometry())
  const surface = G.basicSurface({ color: 0xff0000, side: G.DOUBLE_SIDE })
  const [ground, ...leaves] = geometries.map((geometry) => G.mesh(geometry, surface))
  const source = new G.Group()
  source.add(ground, ...leaves)
  const structure = { version: 1, roots: [0], groups: [] }
  const primitive = (mesh: number, rank: number, url: string) => ({
    mesh,
    primitive: rank,
    pass: 'exact-clusters',
    pages: dagRoots([rootPage(url, [-1, -1, 0], [1, 1, 0])]).pages,
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
  const associations = new Map<G.HostMesh, RowLink>([
    [ground, { meshes: 0, primitives: 0 }],
    [leaves[0], links[0]],
    [leaves[1], links[1]],
  ])
  const dispose = () => [...geometries, surface].forEach((item) => item.dispose())
  return { source, metadata, indices, associations, dispose }
}

/** Pages the scene packs, grown: the ground and four leaf rows of two pages. */
const SCENE_PAGES = 9

/**
 * The partition of `cells.fixture` — its near cell's two nodes on rows sized at open, its far one
 * five kilometres off under the same core node — drawn by a WebGPU session on a mocked device
 * whose storage binding holds `bindingRows` page-table rows, the GPU cut drawing: rows that outgrow
 * their buffer grow in place, a cut made over them (`webgpuGrowth.ts`).
 * The session is handed the partition's rows as a world hands them (`partitionFrame.ts`).
 */
export async function placedSession(bindingRows: number, light?: SceneLight) {
  installGpuGlobals()
  const partition = world(0, 0)
  const { cells, links, bytes } = partition
  await opened(cells, bytes, 100, true, [1e9, 0, 0]) // rows for the view, nothing read
  const scene = placedScene(links)
  const collected = collectClusterPages(
    scene.source,
    scene.metadata,
    scene.indices,
    scene.associations,
  )
  // A binding of `bindingRows` table rows, no smaller than the GPU cut's readout at the scene's list
  // cap, grown or not: the cut is the engine's one cut, and a device that cannot hold it refuses
  // the scene (#1483).
  const binding = Math.max(bindingRows * PAGE_INFO_STRIDE, readoutRow(SCENE_PAGES).size)
  // The double runs the cut on the DAG the session uploads, the grown one too (`mockDag.ts`).
  const gpu = mockGpu({
    limits: { maxBufferSize: Math.max(1 << 20, binding), maxStorageBufferBindingSize: binding },
  })
  const sceneLights = createSceneLightStore()
  if (light) sceneLights.add(light)
  const rt = createWebgpuPagesRuntime({
    ...scene,
    ...(light ? { sceneLights } : {}),
    gpuDevice: gpu.device,
    maxResidentPages: 3,
    viewport: [1, 1], // The intentionally tiny storage limit also bounds receiver offsets.
  })
  const { port, held, outgrown: reopened } = io(bytes)
  ;['near.json', 'far.json'].forEach((name) => held.add(cellUrl(name)))
  port.update = (rows, from, to) => updateWebgpuPlacements(rt, rows, from, to)
  port.grow = {
    growsInPlace: (from) => webgpuGrowsInPlace(rt, from),
    growPlacements: (from, to) => growWebgpuPlacements(rt, from, to),
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
    await settled(cells, [0, 0, 0], 100, port, noBudget)
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

/** Shrinks the core node a thousand times: the far cell comes within reach, one more node than
 *  the rows hold. The frames a world runs until the page and the cell it brings are decoded; the
 *  image whose entry asks the cut over the grown rows (`startGrownCut`) — taken in place by the
 *  running cut, or made beside it —, that cut made, and the image whose entry adopts it. */
export async function scaleDown(session: Awaited<ReturnType<typeof placedSession>>) {
  const { cells, core, io, rt, draw } = session
  core.scale.set(1e-3, 1e-3, 1e-3)
  await settled(cells, [0, 0, 0], 100, io, noBudget)
  await draw()
  await grownCutMade(rt)
  await draw()
}
