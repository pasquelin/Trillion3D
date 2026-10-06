import test from 'node:test'
import assert from 'node:assert/strict'
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts'
import type { PreparedSceneTables } from '../../../../sdk-core/src/scene/core/tableContracts.ts'
import type { TableDocument } from '../../../../sdk-core/src/scene/core/tableDocuments.ts'
import type { TableMaterial } from '../../../../sdk-core/src/index.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts'
import type { HostMesh, HostMaterials } from '../../host/resources.ts'
import { clothPrimitives, preparedGraph } from '../../host/prepared/graph.ts'
import { preparedMaterials } from '../../host/prepared/materials.ts'
import { surfaceOf, surfaceSide } from '../../page/surface.ts'
import { emptyGeometryBlock, rowMaterial } from '../../webgpu/row/pageRowMaterial.ts'
import { FLAG_DOUBLE } from '../../visibility/types.ts'
import { visMaterial } from '../../visibility/shader/material.ts'
import { createdSurface, assignment, PLAIN } from '../api/createdMaterials.ts'
import { createWorldBatches } from './worldBatches.ts'
import { buildWorldSource } from './worldSource.ts'
import type { Cut } from './worldCuts.ts'
import type { MaterialEntry } from './worldMaterials.ts'

/**
 * What every pass reads of the faces a host surface draws: the side the WebGPU pipelines cull by
 * and the cut's cones open on, the row flag the material pass flips a back face's normal by and the
 * shadow raster culls nothing on, and the record the WebGL2 binder culls and turns normals by.
 */
function faces(surface: HostMaterials) {
  const record = surfaceOf(surface)
  const layers = { mapLayer: new Map(), dataLayer: new Map() }
  return {
    side: surfaceSide(record),
    rowDouble: (rowMaterial(record, emptyGeometryBlock(), layers).flags & FLAG_DOUBLE) !== 0,
    webgl: visMaterial(surface).doubleSided,
  }
}
const BOTH = { side: 'double', rowDouble: true, webgl: true }
const FRONT = { side: 'front', rowDouble: false, webgl: false }

/** A world resource of one triangle, its pages none. */
const cut = (): Cut =>
  ({
    key: 'sheet',
    drawn: {
      positions: new Float32Array(9),
      normals: new Float32Array(9),
      uvs: null,
      colors: null,
      indices: new Uint32Array([0, 1, 2]),
    },
    runtime: { primitive: { pages: [] }, urls: [] },
    users: new Set(),
    held: false,
  }) as unknown as Cut

test('a cloth the page builds is drawn and casts on both faces; a rigid body of its material is not', () => {
  const paint = material.meshStandard({ color: 0xc23b3b })
  const entry: MaterialEntry = { id: 1, key: '', material: paint }
  const flag = new Mesh(new Geometry(), paint),
    board = new Mesh(new Geometry(), paint)
  flag.physics = { type: 'cloth', pins: [0] }
  board.physics = 'dynamic'
  const batches = createWorldBatches(() => {})
  const shared = cut()
  batches.seat(flag, shared, entry)
  batches.seat(board, shared, entry)
  const opened = batches.reopen()
  const source = buildWorldSource({ batches: opened, models: [] })!
  const byBatch = new Map(opened.map((batch, i) => [batch, source.root.children[i] as HostMesh]))
  const worn = (mesh: Mesh) => byBatch.get(batches.seats.get(mesh)!.batch)!.material
  assert.equal(paint.side, 'front', 'the page material is left as the page set it')
  assert.deepEqual(faces(worn(flag)), BOTH)
  assert.deepEqual(faces(worn(board)), FRONT)
})

/** A material table entry as the compiler writes a plain opaque one. */
const tableMaterial = {
  alphaMode: 'OPAQUE',
  alphaTest: 0,
  aoIntensity: 1,
  aoMap: null,
  attenuationColor: [1, 1, 1],
  attenuationDistance: 0,
  backSide: false,
  baseColor: [0.76, 0.23, 0.23],
  derivativeTangents: true,
  doubleSided: false,
  emissive: [0, 0, 0],
  emissiveMap: null,
  extensions: {},
  ior: 1.5,
  kind: 'standard',
  lit: true,
  map: null,
  metalness: 0,
  metalnessMap: null,
  name: 'flag',
  normalMap: null,
  normalScale: 1,
  normalScaleY: -1,
  opacity: 1,
  roughness: 0.9,
  roughnessMap: null,
  thickness: 0,
  transmission: 0,
} as unknown as TableMaterial

/** A compiled scene of two nodes wearing material 0: a cloth's (mesh 0) and a pole's (mesh 1). */
async function cookedScene() {
  const node = (mesh: number) => ({
    ...{ name: `node_${mesh}`, children: [], mesh, light: null, camera: null, skin: null },
    ...{ weights: null, matrix: null, translation: null, rotation: null, scale: null },
    visible: true,
  })
  const tables = {
    scene: { name: '', nodes: [0, 1] },
    nodes: [node(0), node(1)],
    skins: [],
    animations: [],
    cameras: [],
    lights: [],
    materials: [tableMaterial],
  } as unknown as PreparedSceneTables
  const meshes = [0, 1].map((mesh) => ({
    name: `mesh_${mesh}`,
    weights: null,
    primitives: [{ material: 0 }],
  })) as unknown as TableDocument['meshes']
  const deformed = { joints: [], targets: [], softVertices: 3, softKind: 'cloth' as const }
  const metadata = {
    primitives: [
      { mesh: 0, primitive: 0, pass: 'exact-clusters', pages: [], deformation: deformed },
      { mesh: 1, primitive: 0, pass: 'exact-clusters', pages: [] },
    ],
  } as unknown as ClusterManifest
  const geometryOf = () => {
    const geometry = new Geometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3))
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(9), 3))
    return geometry
  }
  const { scene } = await preparedGraph({
    tables,
    meshes,
    geometryOf,
    materialOf: preparedMaterials(tables.materials, () => Promise.resolve(null)),
    clothOf: clothPrimitives(metadata, Promise.resolve()),
  })
  const parts: HostMesh[] = []
  scene.traverse((part) => part instanceof Mesh && parts.push(part as HostMesh))
  return parts
}

test('a cooked cloth is drawn and casts on both faces; the pole wearing its material is not', async () => {
  const [flag, pole] = await cookedScene()
  assert.deepEqual(faces(flag.material), BOTH)
  assert.deepEqual(faces(pole.material), FRONT)
  assert.notEqual(flag.material, pole.material, 'one surface per variant, the table entry shared')
})

test('a material the page creates and gives a cooked cloth is drawn on both faces too', async () => {
  const [flag, pole] = await cookedScene()
  const variants = new Map([[PLAIN, createdSurface({ baseColor: [1, 1, 1] })]])
  const { meshes } = assignment(variants, new Set([flag, pole]))
  assert.deepEqual(faces(meshes.get(flag)!), BOTH)
  assert.deepEqual(faces(meshes.get(pole)!), FRONT)
})
