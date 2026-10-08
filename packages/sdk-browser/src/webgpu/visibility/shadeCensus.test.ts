// The census of the resolve classes is taken again only once what it reads moved — a surface's
// values, the surfaces drawables wear —, and then names the class every row will carry: the frame
// entry asks it before the image that draws it (`../frame/framePipelines.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { collectClusterPages } from '../../page/selection/selection.ts'
import { createShadeCensus } from './shadeCensus.ts'
import { ROW_MATERIAL_CLASS_WORD } from '../row/pageRow.ts'
import { createPageRowWriter } from '../row/pageRowWriter.ts'
import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts'
import { CLASS_FEATURE } from '../../visibility/shader/classWords.ts'
import { scene } from '../core/materialClasses.fixture.ts'
import type * as G from '../../host/graph/graph.fixture.ts'

/** The fixture's pages, the blocks their rows read, and the class a row of the cut-out carries. */
function opened() {
  const { source, metadata, indices, associations, meshes } = scene()
  const { allPages, roots } = collectClusterPages(source, metadata, indices, associations)
  const block = { vertexBase: 0, count: 3, hasUv: false, hasNormal: true, hasTangent: false }
  const geometryBlocks = new Map(
    roots.map((root) => [root.pages[0].attributes, { ...block, hasColor: false }]),
  )
  const layers = { mapLayer: new Map(), dataLayer: new Map() }
  const writeRow = createPageRowWriter(
    { geometryBlocks, ...layers, asIsShown: false, emissiveAoShown: false },
    () => {},
    roots,
    (packed) => packed,
  )
  const ints = new Uint32Array(PAGE_INFO_STRIDE / 4)
  const rowClass = () => {
    writeRow(roots[0].pages[0], 0, 0, 0, new Float32Array(ints.buffer), ints)
    return ints[ROW_MATERIAL_CLASS_WORD]
  }
  const census = createShadeCensus(allPages, geometryBlocks, layers)
  const cutout = meshes[0].material as unknown as {
    alphaTest: number
    emissive: G.Color
    needsUpdate: boolean
  }
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
  assert.deepEqual(census.keys, [rowClass()], 'the class the row writes')
  assert.equal(census.retake(), false, 'once')
})

test('a surface made to emit is heard by the census, before any row shows it', () => {
  const { census, cutout } = opened()
  assert.equal(census.emits, false)
  cutout.emissive.setRGB(0.5, 0, 0)
  cutout.needsUpdate = true
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
