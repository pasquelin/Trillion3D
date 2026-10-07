// A dispatch past one dimension's workgroups runs in rows instead of being refused: the host's
// flat dispatches and the kernels' indirect arguments take the same rows, and the kernels' flat
// rank reaches every thread of them once. The WGSL runs in Node, as shipped.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_GROUP_WIDTH,
  FLAT_INDEX_WGSL,
  GROUP_GRID_WGSL,
  dispatchGrid,
  dispatchRows,
} from './grid.ts'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'

type Kernel = { groupGrid: (g: number) => number[]; flatIndex: (...v: unknown[]) => number }
const kernel = (width: number) =>
  shaderRun<Kernel>(`${GROUP_GRID_WGSL}${FLAT_INDEX_WGSL}`, ['groupGrid', 'flatIndex'], {
    GROUP_WIDTH: width,
  })

test('the WGSL split is the host one, and slice by slice it rises to it', () => {
  for (const width of [1, 3, 7]) {
    const k = kernel(width)
    let raised = [0, 0]
    for (let groups = 0; groups <= 40; groups++) {
      assert.deepEqual(k.groupGrid(groups), dispatchGrid(groups, width), `${groups} by ${width}`)
      // An append opening slice `groups - 1` raises the argument to its own split: monotone, so
      // the largest slice's is the list's.
      if (groups) raised = raised.map((v, i) => Math.max(v, k.groupGrid(groups)[i]))
      if (groups) assert.deepEqual(raised, dispatchGrid(groups, width))
    }
  }
  const wide = kernel(DEFAULT_GROUP_WIDTH)
  for (const groups of [0, 1, 65_535, 65_536, 131_071, 200_000])
    assert.deepEqual(wide.groupGrid(groups), dispatchGrid(groups), `${groups} groups`)
  assert.deepEqual(dispatchGrid(65_535), [65_535, 1], 'one row: the dispatch of before')
  assert.deepEqual(dispatchGrid(65_536), [65_535, 2])
})

test('the flat rank reaches every thread and every group of the rows once, in order', () => {
  const { flatIndex } = kernel(DEFAULT_GROUP_WIDTH)
  for (const groups of [1, 3, 4, 10]) {
    const [x, y] = dispatchGrid(groups, 3),
      n = [x, y, 1],
      threads: number[] = [],
      ranks: number[] = []
    for (let row = 0; row < y; row++) {
      for (let at = 0; at < x * 64; at++) threads.push(flatIndex([at, row, 0], n, 64))
      for (let at = 0; at < x; at++) ranks.push(flatIndex([at, row, 0], n, 1))
    }
    assert.deepEqual(
      threads,
      threads.map((_, i) => i),
      `${groups} groups' threads`,
    )
    assert.deepEqual(
      ranks,
      ranks.map((_, i) => i),
      `${groups} groups`,
    )
  }
})

test('dispatchRows dispatches the split of dispatchGrid, z deep', () => {
  const calls: number[][] = []
  const pass = { dispatchWorkgroups: (...xyz: number[]) => void calls.push(xyz) }
  for (const [groups, width, z] of [[0], [1], [65_535], [65_536], [10, 3], [10, 3, 7]]) {
    dispatchRows(pass, groups, z, width)
    assert.deepEqual(calls.pop(), [...dispatchGrid(groups, width), z ?? 1])
  }
})
