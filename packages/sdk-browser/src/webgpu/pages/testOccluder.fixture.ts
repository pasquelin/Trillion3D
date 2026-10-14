import { createEngineCamera } from '../../camera/engineCamera.ts'
import { readCameraWorld } from '../../camera/world.ts'
import * as G from '../../host/graph/graph.fixture.ts'
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import { Group } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import assert from 'node:assert/strict'
import { compareImages } from '../../../../sdk-core/src/runtime/compareImages.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'
import { shadeVisibility } from '../../../../../bench/oracles/browser/cpu-image/shade.ts'
import { webgpuPagesEngine } from './pages.ts'
import type { PageRec, ClusterRoot } from '../../page/selection/types.ts'
import { selectVisiblePages } from '../../page/cut/cut.fixture.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'
import { dagRoots } from '../../engine/pagesEngine.fixture.ts'
import { camera, withDraws } from './testScenes.fixture.ts'
import type { Placements } from '../../page/selection/placements.ts'
import {
  backendRasterRgba,
  backendVisibilityIds,
} from '../../../../../bench/oracles/browser/cpu-image/backendImage.ts'
import { rasterVisibilityIds } from '../../../../../bench/oracles/browser/cpu-image/raster.ts'
import { unpackVisibilityId } from '../../../../../bench/oracles/browser/cpu-image/ids.ts'
import { manifestCulling } from '../../gpu/dag/culling.fixture.ts'

export function occluderScene() {
  const geometry = new Geometry()
  geometry.setAttribute(
    'position',
    G.floatAttribute(
      [
        -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, -0.2, -0.2, -2, 0.2, -0.2, -2, 0.2, 0.2, -2, -0.2,
        0.2, -2,
      ],
      3,
    ),
  )
  geometry.setIndex(G.indices([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]))
  const material = G.basicSurface({ color: 0xff0000 }),
    mesh = G.mesh(geometry, material),
    source = new Group()
  source.add(mesh)
  const pages = dagRoots([
    {
      id: 0,
      url: 'front',
      count: 6,
      min: [-1, -1, 0] as number[],
      max: [1, 1, 0] as number[],
      bytes: 24,
      sha256: 'x',
    },
    {
      id: 1,
      url: 'back',
      count: 6,
      min: [-0.2, -0.2, -2] as number[],
      max: [0.2, 0.2, -2] as number[],
      bytes: 24,
      sha256: 'x',
    },
  ]).pages
  const metadata = {
    errorModel: 'dag-group-qem-v3',
    clusterStrategy: 'dag-groups',
    primitives: [
      {
        mesh: 0,
        primitive: 0,
        pass: 'exact-clusters',
        pages,
        structure: { version: 1, roots: [0, 1], groups: [] },
        culling: manifestCulling(pages),
      },
    ],
  }
  const indices = new Map([
    ['front', new Uint32Array([0, 1, 2, 0, 2, 3])],
    ['back', new Uint32Array([4, 5, 6, 4, 6, 7])],
  ])
  const associations = new Map([[mesh, { meshes: 0, primitives: 0 }]])
  return withDraws({ geometry, material, source, metadata, indices, associations })
}

/** The GPU image of the occluder scene equals the CPU raster of the cut (one placement, every shown
 *  page placed by root 0), and only the front page survives in the visibility identifiers. */
export function assertOccluderImage(
  backend: ReturnType<typeof webgpuPagesEngine>,
  shown: PageRec[],
  roots: Placements,
  camera: Camera,
  viewport: [number, number],
) {
  const cam = readCameraWorld(createEngineCamera(), camera)
  const visPages = shown
    .filter((page) => page.array)
    .map((page) => ({ ...page, array: page.array! }))
  const locations = {
    roots,
    packed: visPages.map((_, i) => i),
    placement: { baseOfRoot: Int32Array.of(0), packedCount: visPages.length },
  }
  assert.equal(
    compareImages(
      backendRasterRgba(backend.rasterView()),
      shadeVisibility(
        rasterVisibilityIds(visPages, locations, cam, viewport),
        visPages,
        locations,
        cam,
        viewport,
      ),
    ).maxChannelError,
    0,
  )
  const drawn = new Set(
    [...backendVisibilityIds(backend.rasterView())].flatMap((id) => {
      const unpacked = unpackVisibilityId(id)
      return unpacked ? [unpacked.pageIndex] : []
    }),
  )
  assert.deepEqual([...drawn].sort(), [0])
}

/** The occluder scene on a pages backend over `device` (four resident pages, occlusion culling
 *  on) and the oracle's cut (`selectVisiblePages`) its Hi-Z result must stay inside. */
export async function preparedOccluderRun(
  scene: ReturnType<typeof occluderScene>,
  metadata: ClusterManifest,
  roots: ClusterRoot<PageRec>[],
  device: GPUDevice,
  viewport: [number, number],
) {
  const { source, indices, draws } = scene
  const backend = webgpuPagesEngine({
    source,
    metadata,
    indices,
    draws,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport,
  })
  const cam = camera()
  const cpu = selectVisiblePages(roots, engineCamera(cam), { pixelError: 0, viewport })
  await backend.prepare()
  assert.equal(backend.capabilities.unsupported.includes('occlusion culling'), false)
  return { backend, cam, cpu }
}
