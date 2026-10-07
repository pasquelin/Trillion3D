import * as G from '../../host/graph/graph.fixture.ts'
import assert from 'node:assert/strict'
import { dagRoots } from '../../engine/pagesEngine.fixture.ts'
import { webgpuPagesEngine } from './pages.ts'
import { collectClusterPages } from '../../page/selection/selection.ts'
import { packDagSelection } from '../../gpu/dag/selection.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import type { EngineContext, Engine } from '../../engine/types.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts'
import {
  QUAD_MANIFEST,
  frontCamera,
  quadIndices,
  quadScene as quadMesh,
  triangleGeometry,
} from '../../engine/pagesEngineScenes.fixture.ts'
import { rootPage, twoPrimitives } from './rootPages.fixture.ts'

/** The red quad with its two root clusters, as the WebGPU tests hand it to the backend. */
export function quadScene() {
  const { geometry, material, mesh, source } = quadMesh(G.basicSurface({ color: 0xff0000 }))
  const pages = dagRoots(
    [0, 1].map((id) => ({
      id,
      url: String(id),
      count: 3,
      min: [-1, -1, 0] as number[],
      max: [1, 1, 0] as number[],
      bytes: 12,
      sha256: 'x',
    })),
  ).pages
  const metadata: ClusterManifest = {
    ...QUAD_MANIFEST,
    primitives: [
      {
        mesh: 0,
        primitive: 0,
        pass: 'exact-clusters',
        pages,
        structure: { version: 1, roots: [0, 1], groups: [] },
      },
    ],
  }
  const indices = quadIndices()
  const associations = new Map([[mesh, { meshes: 0, primitives: 0 }]])
  return { geometry, material, source, pages, metadata, indices, associations }
}

/**
 * The WebGPU backend mounted on the red quad as the tests want it: two resident pages, a 32 px
 * viewport, and whatever the test adds. The fixture comes back for the test to dispose.
 */
export function quadBackend(
  gpuDevice: EngineContext['gpuDevice'],
  options: Partial<Omit<EngineContext, 'source' | 'metadata' | 'indices' | 'associations'>> = {},
) {
  const fixture = quadScene()
  const backend = webgpuPagesEngine({
    ...fixture,
    gpuDevice,
    maxResidentPages: 2,
    viewport: [32, 32],
    ...options,
  })
  return { fixture, backend }
}

/** A pages backend over `scene` that reads its pages on demand: nothing resident at prepare,
 *  three resident slots, a 32 px viewport. */
export function streamingQuadBackend(
  scene: Pick<EngineContext, 'source' | 'metadata' | 'associations'> & {
    indices: Map<string, Uint32Array>
  },
  gpuDevice: EngineContext['gpuDevice'],
) {
  return webgpuPagesEngine({
    ...scene,
    indices: new Map(),
    readPage: async (url) => scene.indices.get(url)!,
    gpuDevice,
    maxResidentPages: 3,
    viewport: [32, 32],
  })
}

/**
 * `scene` packed for the GPU cut, mounted on a mock GPU that runs it — two resident pages, a
 * 32 px viewport and whatever `options` add — then prepared, rendered once and flushed.
 */
export async function flushedGpuScene(
  scene: Pick<EngineContext, 'source' | 'metadata' | 'indices' | 'associations'>,
  options: Partial<EngineContext> = {},
) {
  const collected = collectClusterPages(
    scene.source,
    scene.metadata,
    scene.indices,
    scene.associations,
  )
  const packed = packDagSelection(collected.roots)
  const gpu = mockGpu({ packed })
  const backend = webgpuPagesEngine({
    ...scene,
    gpuDevice: gpu.device,
    maxResidentPages: 2,
    viewport: [32, 32],
    ...options,
  })
  await backend.prepare()
  backend.render(camera())
  await backend.flush()
  return { ...gpu, packed, backend }
}
/** A device roomy enough for the shadow tests' light cuts and pools, at the spec's alignment. */
export const SHADOW_LIMITS = {
  maxBufferSize: 1 << 28,
  maxStorageBufferBindingSize: 1 << 27,
  maxTextureDimension2D: 8192,
  maxComputeWorkgroupsPerDimension: 65535,
  minUniformBufferOffsetAlignment: 256,
}
/** A pose `x` metres along the X axis. */
export const along = (x: number) => Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1)

export function camera() {
  const cam = frontCamera()
  cam.updateMatrixWorld()
  return cam
}

/** One image under the GPU cut, the engine's one cut (#1483): drawn, then flushed — the flush adopts
 *  the readback cut under that pose, which the lists and counts read one image later. */
export async function flushedImage(backend: Pick<Engine, 'render' | 'flush'>, cam = camera()) {
  backend.render(cam)
  await backend.flush()
}

/** Renders the front view: both quad clusters are drawn, two triangles in all. */
export function assertBothQuadPagesDrawn(
  backend: Pick<Engine, 'render' | 'metrics' | 'selectedPageIds'>,
) {
  backend.render(camera())
  assert.deepEqual(backend.selectedPageIds().sort(), ['0', '1'])
  assert.equal(backend.metrics().submittedTriangles, 2)
}

/** Releases a backend and the quad it was mounted on. */
export function disposeQuadRun(
  backend: { dispose(): void },
  fixture: { geometry: G.Geometry; material: G.GraphSurface },
) {
  backend.dispose()
  fixture.geometry.dispose()
  fixture.material.dispose()
}

export function mixedBinScene() {
  const geoA = triangleGeometry([-1, -1, 0, 1, -1, 0, 1, 1, 0])
  const geoB = triangleGeometry([-1, -1, 0, 1, 1, 0, -1, 1, 0])
  const front = G.basicSurface({ color: 0xff0000, side: G.FRONT_SIDE }),
    both = G.basicSurface({ color: 0x00ff00, side: G.DOUBLE_SIDE })
  const meshA = G.mesh(geoA, front),
    meshB = G.mesh(geoB, both),
    source = new G.Group()
  source.add(meshA, meshB)
  const box = rootPage('0', [-1, -1, 0], [1, 1, 0])
  return {
    geoA,
    geoB,
    front,
    both,
    source,
    ...twoPrimitives(meshA, meshB, box, { ...box, url: '1' }),
  }
}
