// A page row names its surface's anisotropic and clear-coat record (`PageInfo.physical`, word 67)
// and takes the physical resolve class; a surface without a lobe names none and keeps its class.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { blendFixture } from '../../page/selection/blend.fixture.ts'
import { collectClusterPages } from '../../page/selection/selection.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts'
import {
  PAGE_INFO_STRIDE,
  PAGE_PHYSICAL_WORD,
  PHYSICAL_SECOND_UV,
} from '../../visibility/buffer.ts'
import { CLASS_FEATURE } from '../../visibility/shader/classWords.ts'
import { ROW_MATERIAL_CLASS_WORD } from './pageRow.ts'
import { createPageRowWriter } from './pageRowWriter.ts'
import { createPhysicalTable } from '../visibility/physicalTable.ts'

const [template] = blendFixture().metadata.primitives[0].pages

/** The words of the row one lit triangle of `surface` writes; `hasUv1`, its float block's. */
function rowOf(surface: G.GraphSurface, hasUv1 = false) {
  const source = new G.Group()
  const geometry = new G.Geometry()
  geometry.setAttribute('position', G.floatAttribute([-1, -1, 0, 1, -1, 0, 0, 1, 0], 3))
  geometry.setIndex(G.indices([0, 1, 2]))
  const mesh = G.mesh(geometry, surface)
  source.add(mesh)
  source.updateMatrixWorld(true)
  const structure = { version: 1, roots: [0], groups: [] }
  const page = { ...template, url: 'p0', sha256: 'p0' }
  const metadata = {
    primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', pages: [page], structure }],
  } as unknown as ClusterManifest
  const [rec] = collectClusterPages(
    source,
    metadata,
    new Map([['p0', Uint32Array.of(0, 1, 2)]]),
    new Map([[mesh, { meshes: 0, primitives: 0 }]]),
  ).allPages
  const floats = new Float32Array(PAGE_INFO_STRIDE / 4),
    ints = new Uint32Array(floats.buffer)
  const physicalTable = createPhysicalTable()
  const writer = createPageRowWriter(
    {
      geometryBlocks: new Map([[rec.attributes, { vertexBase: 0, count: 3, hasUv1 }]]),
      mapLayer: new Map(),
      dataLayer: new Map(),
      physicalTable,
      asIsShown: false,
      emissiveAoShown: false,
    } as never,
    () => {},
    [{ world: new G.Matrix4() }] as never,
    (packed) => packed,
  )
  writer(rec, 0, 0, 0, floats, ints)
  return { physical: ints[PAGE_PHYSICAL_WORD], classKey: ints[ROW_MATERIAL_CLASS_WORD] }
}

test('a coated or brushed row names its record and takes the physical class', () => {
  for (const lobe of [{ clearcoat: 1 }, { anisotropy: 0.5 }]) {
    const row = rowOf(G.physicalSurface(lobe))
    assert.equal(row.physical, 1, JSON.stringify(lobe))
    assert.ok(row.classKey & CLASS_FEATURE.HAS_PHYSICAL)
  }
  const plain = rowOf(G.physicalSurface())
  assert.equal(plain.physical, 0)
  assert.equal(plain.classKey & CLASS_FEATURE.HAS_PHYSICAL, 0)
})

test('a coated float row whose geometry has a second UV set says so in its word, high bit', () => {
  const coated = rowOf(G.physicalSurface({ clearcoat: 1 }), true)
  assert.equal(coated.physical, (1 | PHYSICAL_SECOND_UV) >>> 0)
  // A surface without a lobe reads no UV set of its own: its word stays zero.
  assert.equal(rowOf(G.physicalSurface(), true).physical, 0)
})
