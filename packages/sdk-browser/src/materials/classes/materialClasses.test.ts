import test from 'node:test'
import assert from 'node:assert/strict'
import { collectClusterPages } from '../../geometry/selection/collect.ts'
import { createInfoWriter } from '../../geometry/clusters/infoWrite.ts'
import { testInfoWriter } from '../../geometry/clusters/infoWrite.fixture.ts'
import { CLUSTER_INFO } from '../../geometry/dag/info/clusterInfoLayout.ts'
import { FLAG_MASK, MATERIAL_RANK_MASK } from '../../visibility/types.ts'
import { createMaterialTable } from '../table/materialTable.ts'
import { MATERIAL_RECORD, MATERIAL_RECORD_WORDS } from '../table/materialLayout.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createShadeCensus } from '../../visibility/passes/shadeCensus.ts'
import { SURFACE_MODEL } from '../surface/surfaceModelWord.ts'
import { scene } from './materialClasses.fixture.ts'
import { CLASS_FEATURE } from '../../visibility/shader/classWords.ts'
import { createPresentClasses, noteClass, presentClassKeys } from '../../gpu/core/presentClasses.ts'
import { graphDraws } from '../../geometry/selection/drawSource.ts'
import { surfaceOf } from '../../geometry/pages/surface.ts'

test('the three material classes take the three paths the engine has for them', () => {
  const { source, meshes, metadata, indices, associations } = scene()
  const collected = collectClusterPages(source, graphDraws(source, associations), metadata, indices)
  // Cut-out, blend and transmission all become cluster roots, so all are cut by the GPU selection;
  // the blend and the transmission are drawn by the transparent pass.
  assert.deepEqual(
    collected.roots.map((root) => root.pages[0].transparent),
    [false, true, true],
  )
  assert.equal(collected.roots[0].pages[0].drawSource?.node, meshes[0], 'the cut-out stays opaque')
  assert.equal(
    collected.roots[2].pages[0].drawSource?.node,
    meshes[2],
    'transmission streams pages',
  )
  assert.equal(surfaceOf(meshes[2].material).transmission > 0, true)
  assert.equal(surfaceOf(meshes[1].material).transmission, 0, 'a plain blend does not transmit')
})

test('a cut-out cluster names its surface, whose record carries its alpha test', () => {
  const { source, metadata, indices, associations } = scene()
  const collected = collectClusterPages(source, graphDraws(source, associations), metadata, indices)
  const materialTable = createMaterialTable(),
    { device, textureWrites } = fakeDevice()
  /** The threshold the record of the cluster's surface holds, as the table sends it up. */
  const cut = (rank: number) => {
    materialTable.viewFor(device)
    const sent = new Float32Array(textureWrites.at(-1)!.data.buffer as ArrayBuffer)
    return sent[(rank & MATERIAL_RANK_MASK) * MATERIAL_RECORD_WORDS + MATERIAL_RECORD.at.cut]
  }
  const writeInfo = createInfoWriter({
    geometryBlocks: new Map(),
    mapLayer: new Map(),
    dataLayer: new Map(),
    materialTable,
    asIsShown: false,
    emissiveAoShown: false,
  })
  const mask = collected.roots[0].pages[0]
  const { words } = writeInfo(mask, 0)
  assert.equal((words[CLUSTER_INFO.at.flags] & FLAG_MASK) !== 0, true, 'the cut-out flag is set')
  assert.equal(
    cut(words[CLUSTER_INFO.at.material]),
    0.5,
    'the material alpha threshold travels with its record',
  )
  // A blend never becomes a cut-out: its cluster would otherwise discard instead of blending.
  const blend = collected.roots[1].pages[0]
  const written = writeInfo(blend, 0).words
  assert.equal((written[CLUSTER_INFO.at.flags] & FLAG_MASK) !== 0, false)
  assert.equal(cut(written[CLUSTER_INFO.at.material]), 1)
})

test('a cluster record carries its resolve class, the census of the scene knows it before any image', () => {
  const { source, metadata, indices, associations } = scene()
  const collected = collectClusterPages(source, graphDraws(source, associations), metadata, indices)
  const geometryBlocks = new Map(
    collected.roots.map((root) => [
      root.pages[0].attributes,
      {
        vertexBase: 0,
        count: 3,
        hasUv: false,
        hasNormal: true,
        hasTangent: false,
        hasColor: false,
      },
    ]),
  )
  const layers = { mapLayer: new Map(), dataLayer: new Map() }
  const writeInfo = testInfoWriter(geometryBlocks, layers)
  const [mask, blend] = collected.roots.map((root) => root.pages[0])
  const { HAS_MASK, HAS_VERTEX_NORMAL, DOUBLE_SIDED, HAS_UV } = CLASS_FEATURE
  const cutout = HAS_MASK | HAS_VERTEX_NORMAL | DOUBLE_SIDED
  assert.equal(writeInfo(mask, 0).classKey, cutout, 'double-sided cut-out with vertex normals')
  assert.equal(writeInfo(blend, 1).classKey, HAS_VERTEX_NORMAL, 'the plain blend')
  assert.equal(cutout & HAS_UV, 0, 'no uv block, no uv class bit')
  // The census reads the same fields the records will carry, for the pages that take a record: the
  // blend and the transmission are transparent pages, so the cut-out's class alone
  // is compiled at preparation.
  const census = createShadeCensus(collected.allPages, geometryBlocks, layers)
  assert.deepEqual(census.keys, [cutout])
  assert.equal(census.emits, false, 'no surface emits or occludes')
  // An image draws the classes of its resident clusters only: the cut-out's cluster gone leaves its
  // class out.
  const present = createPresentClasses()
  noteClass(present, cutout, 1)
  noteClass(present, HAS_VERTEX_NORMAL, 1)
  assert.deepEqual(
    [...presentClassKeys(present)],
    [HAS_VERTEX_NORMAL, cutout].sort((a, b) => a - b),
  )
  noteClass(present, cutout, -1)
  assert.deepEqual([...presentClassKeys(present)], [HAS_VERTEX_NORMAL])
})

// The image reads its as-is flags from the first opaque cluster that shows a surface as-is —
// a normal or depth view —; a lit cluster, or a blended one, which writes no flag, leaves it unread.
test('an opaque cluster showing a surface as-is tells the image its flags are read', () => {
  const { source, metadata, indices, associations } = scene()
  const collected = collectClusterPages(source, graphDraws(source, associations), metadata, indices)
  const layers = { geometryBlocks: new Map(), mapLayer: new Map(), dataLayer: new Map() },
    vis = {
      ...layers,
      asIsShown: false,
      emissiveAoShown: false,
      materialTable: createMaterialTable(),
    }
  const writeInfo = createInfoWriter(vis)
  const [opaque, blend] = collected.roots.map((root) => root.pages[0])
  writeInfo(opaque, 0)
  assert.equal(vis.asIsShown, false, 'a lit surface')
  blend.material.model = SURFACE_MODEL.normal
  writeInfo(blend, 1)
  assert.equal(vis.asIsShown, false, 'a blended cluster draws no surface flag')
  opaque.material.model = SURFACE_MODEL.matcap
  writeInfo(opaque, 0)
  assert.equal(vis.asIsShown, false, 'a matcap is drawn unlit, not as-is')
  opaque.material.model = SURFACE_MODEL.depth
  writeInfo(opaque, 0)
  assert.equal(vis.asIsShown, true, 'a depth view is shown as-is')
})

// A class stays present while one resident cluster wears it; a pose moves none.
test('the classes an image draws are listed again only once a class came or went', () => {
  const present = createPresentClasses()
  ;[5, 9, 5].forEach((key) => noteClass(present, key, 1))
  assert.deepEqual([...presentClassKeys(present)], [5, 9])
  const listed = presentClassKeys(present)
  assert.equal(presentClassKeys(present), listed, 'the same list while nothing came or went')
  noteClass(present, 5, -1)
  assert.deepEqual([...presentClassKeys(present)], [5, 9], 'another cluster still wears it')
  noteClass(present, 5, -1)
  assert.deepEqual([...presentClassKeys(present)], [9])
})
