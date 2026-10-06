// #1234 step B2: the WebGL2 autonomous per-instance draw state is keyed by packed index, as the
// WebGPU consumers are (#1233). Equivalence: the draw lists (the page meshes the display graph
// carries) and the residency (which packed instances are resident) of a scene of repeated
// placements are those of develop, recorded before this batch. The test reads the new per-packed
// index API, so it cannot run on develop.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import * as G from '../../host/graph/graph.fixture.ts'
import { createAutonomousGeometry } from './geometry.ts'
import { createPageDraws } from './pageDraws.ts'
import type { ClusterRoot, PageRec } from '../../page/selection/types.ts'
import { makeRec } from './pageRec.fixture.ts'
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'

type Store = ReturnType<typeof createAutonomousGeometry>

/** One triangle geometry a page is drawn as. */
function triangle() {
  const geometry = new G.Geometry()
  geometry.setAttribute(
    'position',
    new G.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]), 3),
  )
  geometry.setIndex(G.indices([0, 1, 2]))
  return geometry
}

/** A scene that keeps the meshes attached to it, in the order they entered: the draw list. */
function displayGraph() {
  const children: G.Mesh[] = []
  const scene = {
    add: (mesh: G.Mesh) => void (children.includes(mesh) || children.push(mesh)),
    remove: (mesh: G.Mesh) => {
      const at = children.indexOf(mesh)
      if (at >= 0) children.splice(at, 1)
    },
  } as unknown as Parameters<typeof createAutonomousGeometry>[0]['scene']
  return { scene, children }
}

/**
 * Two pages, each placed by two roots: a0/b0 under root 0, a1/b1 under root 1. Every instance is
 * resident except the last: a0, b0 and a1 are drawn, b1 is held without its index array.
 */
function scene() {
  const a = triangle(),
    b = triangle()
  const page = (id: number, url: string, geometry: Geometry, resident: boolean) => {
    const rec: PageRec = { ...makeRec(id, 1), url, min: [-0.5, -0.5, 0], max: [0.5, 0.5, 0] }
    rec.array = resident ? new Uint32Array([0, 1, 2]) : undefined
    return { rec, geometry }
  }
  const [a0, b0, a1, b1] = [
    page(0, 'a', a, true),
    page(1, 'b', b, true),
    page(2, 'a', a, true),
    page(3, 'b', b, false),
  ]
  const allPages = [a0.rec, b0.rec, a1.rec, b1.rec]
  const roots: ClusterRoot<PageRec>[] = [
    { world: new G.Matrix4().makeTranslation(1, 0, 0), pages: [a0.rec, b0.rec] },
    { world: new G.Matrix4().makeTranslation(2, 1, 0), pages: [a1.rec, b1.rec] },
  ]
  const draws = createPageDraws(roots)
  for (const { rec, geometry } of [a0, b0, a1, b1]) draws.drawing(rec).geometry = geometry
  const shown = [a0.rec, b0.rec, a1.rec]
  const graph = displayGraph()
  const store = createAutonomousGeometry({
    scene: graph.scene,
    roots,
    allPages,
    bootstrap: [],
    views: { live: { shown, shownPacked: [0, 1, 2] }, lists: () => [shown] },
    byUrl: new Map([
      ['a', [a0.rec, a1.rec]],
      ['b', [b0.rec, b1.rec]],
    ]),
    descriptors: new Map(),
    draws,
    colorMaterials: new Map(),
    modifiedPages: new Set(),
  })
  return { store, graph }
}

/** The draw lists and the residency, by packed index, as develop saw them. */
function fingerprint(store: Store, children: readonly G.Mesh[]) {
  const hash = createHash('sha256')
  hash.update(`meshes:${children.length};`)
  for (const mesh of children) {
    const pose = Array.from(mesh.matrix.elements, (value) => value.toFixed(4)).join(',')
    const positions = mesh.geometry.getAttribute('position')?.array as ArrayLike<number> | undefined
    hash.update(`${mesh.renderOrder}:${pose}:${positions ? Array.from(positions).join(',') : ''};`)
  }
  for (let packed = 0; packed < store.draws.pages.length; packed++) {
    const rec = store.draws.recordOf(packed)!,
      draw = store.draws.find(rec)
    hash.update(
      `${packed}:${rec.url}:${draw?.geometry ? 1 : 0}:${draw?.mesh ? 1 : 0}:` +
        `${draw?.attached ? 1 : 0}:${rec.array ? 1 : 0};`,
    )
  }
  return hash.digest('hex').slice(0, 16)
}

test('the WebGL2 draw lists and residency of repeated placements are those of develop', () => {
  // Recorded on develop at 1d6b3ffc4, where each record carried its geometry, mesh and `attached`
  // flag, and the residency was per record: the same draw lists and the same packed state.
  const { store, graph } = scene()
  store.sync()
  assert.equal(fingerprint(store, graph.children), '62220a019a6df6f6')
})

test('a page record carries no draw state: the packed table does', () => {
  const { store } = scene()
  for (const rec of store.draws.pages)
    for (const field of ['geometry', 'mesh', 'attached', 'resident'])
      assert.ok(!(field in rec), `${rec.url} carries no ${field}`)
})
