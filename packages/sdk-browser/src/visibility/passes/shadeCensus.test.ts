// The census of the resolve classes is taken again only once what it reads moved — a surface's
// values, the surfaces drawables wear —, and then names the class every cluster record will carry: the frame
// entry asks it before the image that draws it (`../../frame/loop/framePipelines.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { collectClusterPages } from '../../geometry/selection/collect.ts'
import { createShadeCensus } from './shadeCensus.ts'
import { testInfoWriter } from '../../geometry/clusters/infoWrite.fixture.ts'
import { CLASS_FEATURE } from '../shader/classWords.ts'
import { scene } from '../../materials/classes/materialClasses.fixture.ts'
import type { PageSurface } from '../../geometry/pages/surface.ts'
import { graphDraws } from '../../geometry/selection/drawSource.ts'
import { surfaceWritten } from '../../geometry/pages/surfaceWrites.ts'

/** The fixture's pages, the blocks their records read, and the class a record of the cut-out carries. */
function opened() {
  const { source, metadata, indices, associations, meshes } = scene()
  const { allPages, roots } = collectClusterPages(
    source,
    graphDraws(source, associations),
    metadata,
    indices,
  )
  const block = { vertexBase: 0, count: 3, hasUv: false, hasNormal: true, hasTangent: false }
  const geometryBlocks = new Map(
    roots.map((root) => [root.pages[0].attributes, { ...block, hasColor: false }]),
  )
  const layers = { mapLayer: new Map(), dataLayer: new Map() }
  const writeInfo = testInfoWriter(geometryBlocks, layers)
  const rowClass = () => writeInfo(roots[0].pages[0], 0).classKey
  const census = createShadeCensus(allPages, geometryBlocks, layers)
  const cutout = meshes[0].material as PageSurface
  return { census, rowClass, allPages, cutout }
}

const { HAS_MASK, HAS_VERTEX_NORMAL, DOUBLE_SIDED } = CLASS_FEATURE

test('a census moved by nothing is not taken again', () => {
  const { census, rowClass } = opened()
  assert.deepEqual(census.keys, [rowClass()])
  assert.equal(census.retake(), false, 'nothing moved: nothing read')
})

test('a surface turned opaque takes, at the retake, the class its rows will carry', () => {
  const { census, rowClass, cutout } = opened()
  assert.deepEqual(census.keys, [HAS_MASK | HAS_VERTEX_NORMAL | DOUBLE_SIDED])
  cutout.alphaTest = 0
  census.moved()
  assert.equal(census.retake(), true)
  assert.deepEqual(census.keys, [HAS_VERTEX_NORMAL | DOUBLE_SIDED])
  assert.deepEqual(census.keys, [rowClass()], 'the class the record writes')
  assert.equal(census.retake(), false, 'once')
})

test('a surface made to emit is heard by the census, before any row shows it', () => {
  const { census, cutout } = opened()
  assert.equal(census.emits, false)
  cutout.emissive = [0.5, 0, 0]
  surfaceWritten(cutout)
  census.moved()
  census.retake()
  assert.equal(census.emits, true)
})

test('drawables that wear another surface are walked again, and only then', () => {
  const { census, allPages } = opened()
  const [cutout] = allPages,
    blend = allPages.find((rec) => rec.transparent)!
  const worn = cutout.material
  cutout.material = blend.material
  census.moved()
  census.retake()
  assert.deepEqual(census.keys, [HAS_MASK | HAS_VERTEX_NORMAL | DOUBLE_SIDED], 'not walked')
  census.moved(true)
  census.retake()
  assert.deepEqual(census.keys, [HAS_VERTEX_NORMAL], 'the blend surface, worn opaque')
  cutout.material = worn
})
