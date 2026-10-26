// The coarse quads the page tests draw: the red quad of `testScenes.fixture.ts` with its two
// clusters under one coarse parent, alone or twice, a hundred units apart.
import type { ClusterManifest, Primitive } from '../../../../sdk-core/src/contracts/geometry.ts'
import { createPageCache } from '../../geometry/streaming/pageCache.ts'
import { createTextureCaches } from '../../materials/texture/textureCaches.ts'
import type { Engine } from '../../session/engine/types.ts'
import { dagLevel, MANIFEST_IDENTITY } from '../../session/engine/pagesEngine.fixture.ts'
import { deepQuadScene } from './deepQuad.fixture.ts'
import { webgpuPagesEngine } from './pages.ts'
import { quadScene, withDraws } from './testScenes.fixture.ts'
import type { PageMesh } from '../../geometry/pages/pageMesh.ts'

/** The quad, with its two clusters replaced by a single coarse cluster of the given screen error. */
export function coarseQuadScene(error = 1) {
  const fixture = quadScene()
  const leaves = fixture.metadata.primitives[0].pages
  const level = dagLevel(leaves, [{ ...leaves[0], id: 2, url: '2', count: 6, bytes: 24 }], error)
  return {
    ...fixture,
    metadata: {
      ...fixture.metadata,
      primitives: [{ ...fixture.metadata.primitives[0], ...level }],
    },
    indices: new Map([...fixture.indices, ['2', new Uint32Array([0, 1, 2, 0, 2, 3])]] as [
      string,
      Uint32Array,
    ][]),
  }
}

/** Two coarse quads a hundred units apart, as two primitives of one source, each drawn by `quad`:
 *  their clusters share the resident slots, so a camera jump between them evicts and recycles rows
 *  once the slots hold less than both. */
function twoCoarseQuadsScene(quad: () => ReturnType<typeof coarseQuadScene> = coarseQuadScene) {
  const a = quad(),
    b = quad()
  const mesh = b.source.children[0] as PageMesh
  mesh.position.x = 100
  a.source.add(mesh)
  const primitive = {
    ...b.metadata.primitives[0],
    mesh: 1,
    pages: b.metadata.primitives[0].pages.map((page: { url: string }) => ({
      ...page,
      url: 'b' + page.url,
    })),
  }
  const associations = new Map([...a.associations, [mesh, { meshes: 1, primitives: 0 }]])
  return withDraws({
    source: a.source,
    metadata: { primitives: [...a.metadata.primitives, primitive] },
    indices: new Map([
      ...a.indices,
      ...[...b.indices].map(([url, bytes]) => ['b' + url, bytes] as const),
    ]),
    associations,
    dispose() {
      for (const scene of [a, b]) {
        scene.geometry.dispose()
        scene.material.dispose()
      }
    },
  })
}

/** `twoCoarseQuadsScene(deepQuadScene)`, its manifest completed with the cache-identity fields the
 *  fixture omits — unread by the backends under test. Its second primitive's `pages` carry every
 *  `Page` field at runtime (`...page` spread in the fixture); only the inline callback annotation
 *  there narrows the static type to `{ url: string }`, which this cast corrects. */
export function deepCoarseQuadsScene() {
  const raw = twoCoarseQuadsScene(deepQuadScene)
  const metadata: ClusterManifest = {
    ...raw.metadata,
    ...MANIFEST_IDENTITY,
    primitives: raw.metadata.primitives as Primitive[],
  }
  return { ...raw, metadata }
}

/** The pages engine over `deepCoarseQuadsScene()` on `device`, with the streaming slots that make
 *  a camera jump between its quads evict: three of the widest page (24 bytes) beside the two roots'
 *  (`geometryPoolFor`), five, below the eight clusters' 144, so the pool holds no home of each
 *  (`poolBytes`). */
export function deepCoarseQuadsEngine(device: GPUDevice) {
  const fixture = deepCoarseQuadsScene()
  const backend = webgpuPagesEngine({
    textureCaches: createTextureCaches(createPageCache()),
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 3,
    viewport: [32, 32],
  }) as Engine
  return { fixture, backend }
}
