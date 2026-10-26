// A cluster record names its surface's record in the material table (`ClusterInfo.material`) and takes
// the physical resolve class where the surface carries a lobe; a surface without one keeps its class.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../../scene/host/graph/graph.fixture.ts'
import { Group } from '../../../../../sdk-core/src/world/object/object3d.ts'
import { Geometry } from '../../../../../sdk-core/src/world/geometry/geometry.ts'
import { blendFixture } from '../../selection/blend.fixture.ts'
import { collectClusterPages } from '../../selection/collect.ts'
import type { ClusterManifest } from '../../../../../sdk-core/src/contracts/geometry.ts'
import { MATERIAL_SECOND_UV } from '../../../visibility/types.ts'
import { CLASS_FEATURE } from '../../../visibility/shader/classWords.ts'
import { createInfoWriter } from '../../clusters/infoWrite.ts'
import { CLUSTER_INFO } from '../../dag/info/clusterInfoLayout.ts'
import { createMaterialTable } from '../../../materials/table/materialTable.ts'
import { graphDraws } from '../../selection/drawSource.ts'
import { manifestCulling } from '../../dag/culling.fixture.ts'
import type { PageSurface } from '../../pages/surface.ts'

const [template] = blendFixture().metadata.primitives[0].pages

/** The words of the record one lit triangle of `surface` writes; `hasExtraUv`, its float block's. */
function rowOf(surface: PageSurface, hasExtraUv = false) {
  const source = new Group()
  const geometry = new Geometry()
  geometry.setAttribute('position', G.floatAttribute([-1, -1, 0, 1, -1, 0, 0, 1, 0], 3))
  geometry.setIndex(G.indices([0, 1, 2]))
  const mesh = G.mesh(geometry, surface)
  source.add(mesh)
  source.updateMatrixWorld(true)
  const structure = { version: 1, roots: [0], groups: [] }
  const page = { ...template, url: 'p0', sha256: 'p0' }
  const metadata = {
    primitives: [
      {
        mesh: 0,
        primitive: 0,
        pass: 'exact-clusters',
        pages: [page],
        structure,
        culling: manifestCulling([page]),
      },
    ],
  } as unknown as ClusterManifest
  const [rec] = collectClusterPages(
    source,
    graphDraws(source, new Map([[mesh, { meshes: 0, primitives: 0 }]])),
    metadata,
    new Map([['p0', Uint32Array.of(0, 1, 2)]]),
  ).allPages
  const writer = createInfoWriter({
    geometryBlocks: new Map([[rec.attributes, { vertexBase: 0, count: 3, hasExtraUv }]]),
    mapLayer: new Map(),
    dataLayer: new Map(),
    materialTable: createMaterialTable(),
    asIsShown: false,
    emissiveAoShown: false,
  } as never)
  const { words, classKey } = writer(rec, 0)
  return { material: words[CLUSTER_INFO.at.material], classKey }
}

test('a coated or brushed cluster takes the physical class; a plain one keeps its own', () => {
  for (const lobe of [{ clearcoat: 1 }, { anisotropy: 0.5 }]) {
    const record = rowOf(G.physicalSurface(lobe))
    // Each table its first record: rank zero.
    assert.equal(record.material, 0, JSON.stringify(lobe))
    assert.ok(record.classKey & CLASS_FEATURE.HAS_PHYSICAL)
  }
  const plain = rowOf(G.physicalSurface())
  assert.equal(plain.material, 0)
  assert.equal(plain.classKey & CLASS_FEATURE.HAS_PHYSICAL, 0)
})

test('a float cluster whose geometry has a second UV set says so in its word, high bit', () => {
  assert.equal(rowOf(G.physicalSurface({ clearcoat: 1 }), true).material, MATERIAL_SECOND_UV)
  // Whatever its surface: the bit is the geometry's.
  assert.equal(rowOf(G.physicalSurface(), true).material, MATERIAL_SECOND_UV)
})
