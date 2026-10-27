/**
 * The proof that the prepared scene built from the cache tables is the scene the compiled document
 * (`source.gltf`) describes: on every cache the repository compiles, the document's JSON is walked
 * on its own — nodes in depth-first order, each mesh node expanded into its primitives — and the
 * prepared scene's drawn meshes must agree with it one for one: the rank of the mesh and primitive
 * each draws, its vertex count and, where it is not instanced, its world matrix. Lamps
 * are left aside: `lights.json` carries them.
 *
 * Images are decoded by a stand-in answering the size of the bytes given.
 */
import { fileRanges } from './binary.fixture.ts'
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { ClusterManifest } from '../../../../../sdk-core/src/contracts/geometry.ts'
import { assertSceneTables } from '../../../../../sdk-core/src/scene/core/tableContracts.ts'
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import { composeMatrix4 } from '../../../../../math/src/matrix/matrix4Compose.ts'
import { multiplyMatrix4 } from '../../../../../math/src/matrix/matrix4.ts'
import { sceneCacheFiles } from '../../../../../../tests/kit/scenes/caches.ts'
import { buildPreparedScene } from './build.ts'
import { decodingImages } from './decodedImages.fixture.ts'
import { SCENE_FILE } from '../../tables.ts'
import { meshes } from '../../meshes.ts'

const repository = new URL('../../../../../../', import.meta.url)

/** Every compiled scene cache: the key folder its pointer names. */
async function caches() {
  const found: URL[] = []
  for (const file of await sceneCacheFiles('clusters.json'))
    found.push(new URL('./', new URL(file, repository)))
  return found
}

/** Files served from disk, and images decoded to the size of their bytes. */
function serveFiles(t: TestContext) {
  const browserFetch = globalThis.fetch
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.startsWith('blob:')) return browserFetch(input)
    return new Response(await readFile(fileURLToPath(url)))
  })
  decodingImages(t)
}

type Node = {
  mesh?: number
  children?: number[]
  matrix?: number[]
  translation?: number[]
  rotation?: number[]
  scale?: number[]
  extensions?: Record<string, unknown>
}
type Document = {
  scene?: number
  scenes: { nodes?: number[] }[]
  nodes: Node[]
  meshes: { primitives: { attributes: { POSITION?: number } }[] }[]
  accessors: { count: number }[]
}

/** What the document says one drawn mesh is: its rank, its vertex count and its world matrix. */
interface Expected {
  mesh: number
  primitive: number
  vertices: number | null
  world: Float64Array | null
}

/** The document's drawn meshes, nodes depth first, a mesh node's primitives in order. */
function expectedDraws(document: Document) {
  const out: Expected[] = []
  const visit = (index: number, parent: Float64Array) => {
    const node = document.nodes[index]
    const local = node.matrix
      ? Float64Array.from(node.matrix)
      : composeMatrix4(
          new Float64Array(16),
          node.translation ?? [0, 0, 0],
          node.rotation ?? [0, 0, 0, 1],
          node.scale ?? [1, 1, 1],
        )
    const world = multiplyMatrix4(new Float64Array(16), parent, local)
    if (node.mesh !== undefined)
      document.meshes[node.mesh].primitives.forEach((primitive, p) => {
        const position = primitive.attributes.POSITION
        out.push({
          mesh: node.mesh!,
          primitive: p,
          vertices: position === undefined ? null : document.accessors[position].count,
          // An instanced node places its mesh at each of its own matrices.
          world: node.extensions?.EXT_mesh_gpu_instancing ? null : world,
        })
      })
    for (const child of node.children ?? []) visit(child, world)
  }
  const identity = composeMatrix4(new Float64Array(16), [0, 0, 0], [0, 0, 0, 1], [1, 1, 1])
  for (const root of document.scenes[document.scene ?? 0].nodes ?? []) visit(root, identity)
  return out
}

/** The prepared scene's drawn meshes, each with the rank it was built from. */
async function preparedDraws(folder: URL) {
  const file = JSON.parse(await readFile(new URL('scene-tables.json', folder), 'utf8'))
  // The caches compared here have no partition (`partition.test.ts` reads those).
  const tables = { ...assertSceneTables(file), partition: null }
  const built = await buildPreparedScene({
    tables,
    // The caches compared here draw no cloth: their manifest lists no primitive a cloth draws.
    metadata: { primitives: [] } as unknown as ClusterManifest,
    base: folder.href,
    readRange: fileRanges,
    signal: undefined,
    track: (_resource, read) => read,
  })
  const ranks = built.associations as Map<object, { meshes?: number; primitives?: number }>
  const source = built.source as unknown as Object3D
  const drawn = meshes(source)
  // Its host vertices, each geometry once (`Geometry.loadVertices`), which no session fetches.
  await Promise.all(
    Array.from(new Set(drawn.map((mesh) => mesh.geometry)), (g) => g.loadVertices()),
  )
  source.updateMatrixWorld(true)
  return drawn.map((mesh) => ({
    mesh: ranks.get(mesh)?.meshes,
    primitive: ranks.get(mesh)?.primitives ?? 0,
    vertices: mesh.geometry.attributes.position?.count ?? null,
    world: 'isInstancedMesh' in mesh && mesh.isInstancedMesh ? null : mesh.matrixWorld.elements,
  }))
}

test('the scene built from the tables is the scene the document describes, on every compiled cache', async (t) => {
  serveFiles(t)
  const folders = await caches()
  assert.ok(folders.length > 0, 'the fixture scenes hold compiled caches')
  for (const folder of folders) {
    // A partitioned cache draws its placements from rows, not nodes: `partition.test.ts` proves
    // them.
    const tables = JSON.parse(await readFile(new URL('scene-tables.json', folder), 'utf8'))
    if (tables.partition) continue
    const label = `${fileURLToPath(folder)}${SCENE_FILE}`
    const document = JSON.parse(await readFile(new URL(SCENE_FILE, folder), 'utf8')) as Document
    const expected = expectedDraws(document)
    const actual = await preparedDraws(folder)
    assert.equal(actual.length, expected.length, `${label}: drawn meshes`)
    expected.forEach((want, i) => {
      const got = actual[i]
      assert.equal(got.mesh, want.mesh, `${label} #${i}: mesh rank`)
      assert.equal(got.primitive, want.primitive, `${label} #${i}: primitive rank`)
      assert.equal(got.vertices, want.vertices, `${label} #${i}: vertex count`)
      if (want.world && got.world)
        for (let k = 0; k < 16; k++)
          assert.ok(Math.abs(got.world[k] - want.world[k]) <= 1e-6, `${label} #${i}: world[${k}]`)
    })
  }
})
