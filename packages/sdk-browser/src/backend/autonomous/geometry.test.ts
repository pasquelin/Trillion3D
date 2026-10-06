// G1: `geometry.ts` detaches by the pages attached (`attachees`), not by a scan of the whole DAG.
// Oracle: the version before batch G, in `../../../../../bench/oracles/browser/autonomous-backend.ts`.
// #1234: the per-instance draw state lives in a `PageDraws` table, never on the record.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { createAutonomousGeometry } from './geometry.ts'
import { referenceAutonomousSync } from '../../../../../bench/oracles/browser/autonomous-backend.ts'
import type { ClusterRoot, PageRec } from '../../page/selection/types.ts'
import { surfaceOf } from '../../page/surface.ts'
import { makeRec, recRoots } from './pageRec.fixture.ts'
import { createPageDraws } from './pageDraws.ts'

function fakeScene() {
  const meshes = new Set<object>()
  return {
    scene: {
      add: (m: object) => meshes.add(m),
      remove: (m: object) => meshes.delete(m),
    } as unknown as Parameters<typeof createAutonomousGeometry>[0]['scene'],
    meshes,
  }
}

function environnement(
  scene: ReturnType<typeof fakeScene>['scene'],
  allPages: PageRec[],
  shown: PageRec[],
  shownPacked: number[] = [],
): Parameters<typeof createAutonomousGeometry>[0] {
  const roots = recRoots(undefined, allPages),
    draws = createPageDraws(roots)
  shownPacked.length = shown.length
  for (let i = 0; i < shown.length; i++) shownPacked[i] = draws.firstPacked(shown[i])
  return {
    ...{ scene, roots, allPages, bootstrap: [] },
    ...{ views: { live: { shown, shownPacked }, lists: () => [shown] } },
    ...{ byUrl: new Map(), descriptors: new Map() },
    ...{ draws, colorMaterials: new Map(), modifiedPages: new Set() },
  }
}

/** Two sets of identical pages (same id, triangles), one for the optimized implementation, one
 *  for the oracle: each `pilot` call moves both forward with the same list of pages displayed, then
 *  compare the attached set of the scene and the number of triangles submitted. */
function scenario(count: number) {
  const geometry = new G.Geometry()
  const recsA = Array.from({ length: count }, (_, i) => makeRec(i, (i % 7) + 1))
  // The oracle reads the pose on the record, as records carried it before #1226: its root's.
  const world = recRoots()[0].world
  const recsB = Array.from({ length: count }, (_, i) => ({
    ...makeRec(i, (i % 7) + 1),
    matrix: world,
    geometry,
    mesh: undefined,
    attached: false,
  }))
  const sceneA = fakeScene(),
    sceneB = fakeScene()
  const shownA: PageRec[] = [],
    shownPackedA: number[] = [],
    shownB: typeof recsB = []
  const impl = createAutonomousGeometry(environnement(sceneA.scene, recsA, shownA, shownPackedA))
  for (const rec of recsA) impl.draws.drawing(rec).geometry = geometry
  const oracle = referenceAutonomousSync({ scene: sceneB.scene, allPages: recsB, shown: shownB })
  return {
    driver(indices: number[]) {
      shownA.length = 0
      shownPackedA.length = 0
      shownB.length = 0
      for (const i of indices) {
        shownA.push(recsA[i])
        shownPackedA.push(impl.draws.firstPacked(recsA[i]))
        shownB.push(recsB[i])
      }
      impl.sync()
      oracle.sync()
      assert.equal(
        impl.state.submittedTriangles,
        oracle.state.submittedTriangles,
        `triangles submitted for ${JSON.stringify(indices)}`,
      )
      for (let i = 0; i < count; i++)
        assert.equal(
          sceneA.meshes.has(impl.draws.find(recsA[i])?.mesh as unknown as object),
          sceneB.meshes.has(recsB[i].mesh as unknown as object),
          `attachment of page ${i} for ${JSON.stringify(indices)}`,
        )
      assert.equal(sceneA.meshes.size, sceneB.meshes.size)
    },
  }
}

test('empty scene, empty cut: nothing to attach or detach on either side', () => {
  scenario(0).driver([])
})

test('an empty cut when everything was attached detaches everything, identically to the oracle', () => {
  const s = scenario(6)
  s.driver([0, 1, 2, 3, 4, 5])
  s.driver([])
})

test('a cut that grows and then shrinks in jerks remains the same image after image', () => {
  const s = scenario(10)
  s.driver([0, 1, 2])
  s.driver([0, 1, 2, 3, 4, 5, 6])
  s.driver([3, 4, 5, 6])
  s.driver([9])
  s.driver([])
  s.driver([0, 9])
})

test('duplicates in the displayed cut count triangles twice, on both sides', () => {
  const s = scenario(4)
  s.driver([0, 0, 1, 1, 1, 2])
  s.driver([2, 2])
})

test('a page with zero triangles attaches without distorting the sum', () => {
  const s = scenario(3)
  s.driver([0])
  s.driver([0, 1])
})

test('a large DAG with random churn matches the oracle exactly, cut after cut', () => {
  let seed = 0x9e3779b9
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  const count = 400
  const s = scenario(count)
  for (let frame = 0; frame < 40; frame++) {
    const indices: number[] = []
    for (let i = 0; i < count; i++) if (rand() < 0.15) indices.push(i)
    s.driver(indices)
  }
  s.driver([])
})

// #297: `attach` mounts the host declaration the page was collected from, never the engine's own
// surface record. A record carries no `visible`, and the host library drops every mesh whose
// material lacks one: 430 meshes attached, 430 draw calls, zero triangle on screen.
test('an attached page wears the host declaration, not the engine surface record', () => {
  const { scene, meshes } = fakeScene()
  const declaration = G.standardSurface()
  const rec: PageRec = {
    ...makeRec(0, 1),
    declaration,
    material: surfaceOf(declaration),
  }
  const shown = [rec]
  const env = environnement(scene, [rec], shown)
  env.draws.drawing(rec).geometry = new G.Geometry()
  createAutonomousGeometry(env).sync()
  const [attached] = [...meshes] as G.Mesh[]
  assert.equal(attached.material, declaration)
  assert.equal((attached.material as G.GraphSurface).visible, true)
  declaration.dispose()
})

test('the store keeps a page by page, checked against the catalogue even when nothing draws it', () => {
  const { scene } = fakeScene()
  const material = G.standardSurface()
  const recs = [0, 1].map((id) => ({ ...makeRec(id, 1), url: 'p.bin', array: undefined }))
  const env = environnement(scene, recs, [])
  const descriptor = { vertexCount: 3, indexCount: 3, flags: 0 } as never
  env.byUrl.set('p.bin', recs).set('empty.bin', [])
  env.descriptors.set('p.bin', descriptor).set('empty.bin', descriptor)
  for (const rec of recs) env.draws.drawing(rec).material = material
  env.modifiedPages.add('replaced.bin')
  const store = createAutonomousGeometry(env)
  // One placement laid out as `requests.ts` lays it: the cut's readiness follows the store's feed.
  const root = { pages: recs } as unknown as ClusterRoot<PageRec>,
    ready = () => recs.map((_, at) => store.held.readiness(root).isReady(at))
  store.held.track([root])
  assert.deepEqual(ready(), [false, false], 'entered whole: nothing held yet')
  const page = () => ({
    ...{ indices: new Uint32Array([0, 1, 2]), vertexCount: 3, flags: 0, decodedBytes: 48 },
    ...{ attributes: { position: new Float32Array(9) }, quantizationError: 0 },
  })
  assert.equal(store.acceptGeometryPage('replaced.bin', page()), false, 'the host replaced it')
  assert.equal(store.acceptGeometryPage('unknown.bin', page()), false)
  const wrong = { ...page(), vertexCount: 4 }
  assert.throws(() => store.storeGeometryPage('empty.bin', wrong), /METADATA_MISMATCH/)
  assert.equal(store.storeGeometryPage('empty.bin', page()), false, 'no record draws it')
  assert.equal(store.storeGeometryPage('p.bin', page()), true)
  assert.equal(store.storeGeometryPage('p.bin', page()), true)
  assert.equal(store.state.residentPages, 1, 'one page, two records, stored twice')
  assert.deepEqual(ready(), [true, true], 'the load reached the cut')
  assert.deepEqual([store.releasePage('p.bin'), store.releasePage('p.bin')], [true, false])
  assert.equal(store.state.residentPages, 0, 'the page, not its two records, left')
  assert.deepEqual([...ready(), store.held.unroutedReads], [false, false, 0], 'routed moves')
  store.dispose()
  material.dispose()
})
