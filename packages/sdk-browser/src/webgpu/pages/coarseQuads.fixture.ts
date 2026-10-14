// The coarse quads the page tests draw: the red quad of `testScenes.fixture.ts` with its two
// clusters under one coarse parent, alone or twice, a hundred units apart.
import type { HostMesh } from '../../host/resources.ts'
import { dagLevel } from '../../engine/pagesEngine.fixture.ts'
import { quadScene, withDraws } from './testScenes.fixture.ts'

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
export function twoCoarseQuadsScene(
  quad: () => ReturnType<typeof coarseQuadScene> = coarseQuadScene,
) {
  const a = quad(),
    b = quad()
  const mesh = b.source.children[0] as HostMesh
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
