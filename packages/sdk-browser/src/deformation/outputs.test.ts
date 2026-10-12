import test from 'node:test'
import assert from 'node:assert/strict'
import { assignDeformationOutputs, writeRowDeformation, writeSpanDeformation } from './outputs.ts'
import { DEFORM_SOURCE_IN_POOL, DEFORM_NO_HEADER } from '../visibility/types.ts'
import type { ClusterRoot, DeformationOutput } from '../page/selection/types.ts'
import type { PageRec } from '../page/selection/selection.ts'

const page = (url: string, count: number, deformed = true) =>
  ({
    url,
    geometryPage: { url, vertexCount: count },
    attributes: {},
    drawSource: { node: deformed ? { morphTargetInfluences: [0] } : {}, dynamic: false },
  }) as unknown as PageRec
const floats = (attributes: object) =>
  ({
    url: 'f',
    attributes,
    drawSource: { node: { waves: {} }, dynamic: false },
  }) as unknown as PageRec
const rootOf = (pages: PageRec[]) => ({ pages, world: {} }) as unknown as ClusterRoot<PageRec>

test('every placement of a deformed primitive writes results of its own', () => {
  const pages = [page('a', 3), page('b', 4), page('c', 5, false)]
  const roots = [rootOf(pages), rootOf(pages), rootOf(pages)]
  const blocks = assignDeformationOutputs(roots)
  assert.equal(blocks.length, 6, 'a block for each deformed page of each placement')
  assert.equal(new Set(blocks).size, 6)
  for (const root of roots) {
    assert.deepEqual(
      Array.from(root.deformationOutputs!, (output) => output?.count),
      [3, 4, undefined],
      'none for the page that is not deformed',
    )
  }
  assert.notEqual(roots[0].deformationOutputs![0], roots[1].deformationOutputs![0])
})

test('a root that deforms nothing holds none; roots added later add their blocks alone', () => {
  const still = [page('a', 3, false)]
  const moving = [page('a', 3)]
  const roots = [rootOf(still), rootOf(moving)]
  assert.equal(assignDeformationOutputs(roots).length, 1)
  assert.equal(roots[0].deformationOutputs, undefined)
  const more = [rootOf(moving), rootOf(moving)]
  assert.equal(assignDeformationOutputs(more).length, 2, 'blocks grow by the roots added')
})

test('the pages of a geometry read as floats share one block a placement', () => {
  const geometry = { position: { count: 9 } }
  const pages = [floats(geometry), floats(geometry)]
  const roots = [rootOf(pages), rootOf(pages)]
  const blocks = assignDeformationOutputs(roots)
  assert.equal(blocks.length, 2)
  for (const root of roots) {
    const [first, second] = root.deformationOutputs!
    assert.equal(first, second)
    assert.equal(first!.count, 9)
    assert.equal(first!.pool!.world, root.world)
  }
})

// The words a row and a span put to name an output.
test('a row and a span name an output by its words', () => {
  const own: DeformationOutput = { from: 34, count: 3 },
    pool = { from: 100, count: 7, pool: {} } as DeformationOutput,
    poolWord = ((101 | DEFORM_SOURCE_IN_POOL | DEFORM_NO_HEADER) >>> 0) as number
  const ints = new Uint32Array(200),
    spans = new Uint32Array(8)
  const at = 3 * 16
  const [count, out] = [65, 66]
  writeRowDeformation(ints, at, own)
  assert.deepEqual(
    [ints[at + count], ints[at + out]],
    [3, 35],
    "a page's own: its count, its float",
  )
  writeRowDeformation(ints, at, pool)
  assert.deepEqual([ints[at + count], ints[at + out]], [0, poolWord], 'a pool block: no own count')
  writeRowDeformation(ints, at, undefined)
  assert.deepEqual([ints[at + count], ints[at + out]], [0, 0], 'none')
  writeSpanDeformation(spans, 1, own, 6)
  assert.deepEqual([...spans.subarray(6, 8)], [35, 3])
  writeSpanDeformation(spans, 1, pool, 6)
  assert.deepEqual([...spans.subarray(6, 8)], [poolWord, 0])
  writeSpanDeformation(spans, 1, own, 0)
  assert.deepEqual([...spans.subarray(6, 8)], [0, 0], 'a span that draws nothing names nothing')
})
