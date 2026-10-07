// loading a scene.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { collectClusterPages } from '../../../packages/sdk-browser/src/page/selection/collect.ts'
import { pagesBounds } from '../../../packages/sdk-browser/src/world/scene/pagesBounds.ts'
import {
  indexManifestBundles,
  indexManifestPages,
} from '../../../packages/sdk-browser/src/scene/manifestPageIndex.ts'
import { measure, stress, rapport } from '../../core/index.ts'
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/types.ts'
import { referenceCollectClusterPages } from '../../oracles/browser/page-collection.ts'
import {
  referenceExactPagesBounds,
  referenceIndexManifestBundles,
  referenceIndexManifestPages,
} from '../../oracles/browser/bounds-and-index.ts'
import { manifesteEtScene } from './support/scenesLoading.ts'
import { DEFAULT_SCOPE, type ClusterManifest } from '../../../packages/sdk-core/src/index.ts'

/** A box the reference returns, or the engine's six numbers. */
type Box = { readonly min: { toArray(): number[] }; readonly max: { toArray(): number[] } }
const boxToArray = (box: Box | ArrayLike<number>): number[] =>
  'min' in box ? [...box.min.toArray(), ...box.max.toArray()] : Array.from(box as ArrayLike<number>)

type ChargementScene = ReturnType<typeof manifesteEtScene>

const grande = manifesteEtScene({ primitives: 200, pages: 12, triangles: 8 })
const petite = manifesteEtScene({ primitives: 1, pages: 1, triangles: 1, seed: 77 })
const orpheline = manifesteEtScene({ primitives: 3, pages: 2, triangles: 2, seed: 99 })
// Simulates a mesh without a prepared primitive: `.get(mesh)` reads `undefined` either way,
// and nothing here reads `.has(mesh)` — deleting the key keeps the map's own value type.
for (const mesh of orpheline.associations.keys()) orpheline.associations.delete(mesh)
const emptyMetadata: ClusterManifest = {
  schema: 0,
  status: 'ready',
  key: 'bench-empty',
  scope: DEFAULT_SCOPE,
  sourceTriangles: 0,
  selectedTriangles: 0,
  selectedNodes: 0,
  totalNodes: 0,
  primitives: [],
}
const emptyScene: ChargementScene = {
  source: new G.Group(),
  associations: new Map(),
  metadata: emptyMetadata,
  indices: new Map(),
}

const recDe = (rec: PageRec) => ({
  id: rec.id,
  url: rec.url,
  clusterId: rec.clusterId,
  array: rec.array,
  triangles: rec.triangles,
  indexBytes: rec.indexBytes,
  min: rec.min,
  max: rec.max,
  role: rec.role,
  level: rec.level,
  lodError: rec.lodError,
  sphere: rec.sphere,
  parentError: rec.parentError,
  parentSphere: rec.parentSphere,
  group: rec.group,
  source: rec.source,
  streamUrl: rec.streamUrl,
  streamOffset: rec.streamOffset,
  depthLayer: rec.depthLayer,
  transparent: rec.transparent,
  sourceOrder: rec.sourceOrder,
  renderOrder: rec.renderOrder,
  requestIndex: rec.requestIndex,
  keyIndex: rec.keyIndex,
})

const passeCollect =
  (fn: typeof collectClusterPages | typeof referenceCollectClusterPages) =>
  (input: ChargementScene) => {
    let output
    try {
      output = fn(input.source, input.metadata, input.indices, input.associations)
    } catch (error) {
      return { refusal: error instanceof Error ? error.message : String(error) }
    }
    return {
      refusal: null,
      requestCount: output.requestCount,
      prepared: output.prepared,
      blendCopies: output.blendCopies.length,
      bootstrap: output.bootstrap.length,
      pages: output.allPages.map(recDe),
      boxes: output.roots.flatMap((root) => [
        ...boxToArray(root.localBox ?? new Float64Array(6)),
        ...boxToArray(root.worldBox ?? new Float64Array(6)),
      ]),
      bornes: output.roots.map((root) => root.culling?.bounds ?? null),
    }
  }

const passeBounds =
  (fn: typeof pagesBounds | typeof referenceExactPagesBounds) => (input: ChargementScene) => {
    const manquants: string[] = []
    const box = fn(input.source, input.associations, input.metadata, (mesh) =>
      manquants.push(mesh.name),
    )
    return { box: boxToArray(box), manquants }
  }

const passeIndex =
  (pages: typeof indexManifestPages, bundles: typeof indexManifestBundles) =>
  (metadata: import('../../../packages/sdk-core/src/index.ts').ClusterManifest) => {
    const index = pages(metadata)
    return {
      pages: index.pages.map((page) => page.url),
      identifiants: index.pages.map((page) => page.id),
      geometryPages: index.geometryPages.map((page) => page.url),
      pageIdByUrl: index.pageIdByUrl,
      bundles: bundles(metadata).map((bundle) => bundle.url),
    }
  }

const cas = [
  { name: '200 primitives, 2 600 pages', input: grande, size: 2600 },
  { name: 'one primitive, one page', input: petite, size: 1 },
  { name: 'mesh without a primitive', input: orpheline, size: 3 },
  { name: 'empty scene', input: emptyScene, size: 0 },
]

const resCollect = await measure({
  name: 'cluster page collection',
  fichier: 'packages/sdk-browser/src/page/selection/collect.ts',
  cas,
  calculation: passeCollect(collectClusterPages),
  expected: passeCollect(referenceCollectClusterPages),
  options: { tours: 40, budgetMs: 1500 },
})

const resBounds = await measure({
  name: 'exact page bounds',
  fichier: 'packages/sdk-browser/src/world/scene/pagesBounds.ts',
  cas,
  calculation: passeBounds(pagesBounds),
  expected: passeBounds(referenceExactPagesBounds),
  options: { tours: 40, budgetMs: 1500 },
})

const resIndex = await measure({
  name: 'manifest indexing',
  fichier: 'packages/sdk-browser/src/scene/manifestPageIndex.ts',
  cas: [
    { name: '2 400 pages', input: grande.metadata, size: 2400 },
    { name: 'one page', input: petite.metadata, size: 1 },
  ],
  calculation: passeIndex(indexManifestPages, indexManifestBundles),
  expected: passeIndex(referenceIndexManifestPages, referenceIndexManifestBundles),
  options: { tours: 100, budgetMs: 1500 },
})

await stress({
  name: 'pagesBounds extremes',
  calculation: (scene: ChargementScene) =>
    pagesBounds(scene.source, scene.associations, scene.metadata, () => {}),
  extremes: [{ name: 'empty', input: emptyScene }],
})

rapport(
  'chargement-scene',
  [resCollect, resBounds, resIndex],
  'F16 and F17 recover the exact same pages, indices and boxes',
)
