// The placement tree lays its members side by side whatever the rows hold: a parked row — a hidden
// node, a partition row waiting for its cell — never drops the order back to the rows' own, so its
// groups stay small; and a partition's rows lie by their cell. On generated fields.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placementField } from './placementTree.fixture.ts'
import { packDagSelection } from './selection.ts'
import { createPlacementRows } from '../../placement/rows.ts'
import { setRowCell } from '../../partition/rowCells.ts'
import type { DagRoot } from './types.ts'

/** The mean extent, over x and z, of the translations each group of 64 members spans. */
function meanGroup(roots: readonly DagRoot[]) {
  const tree = packDagSelection(roots).placementTree!
  let sum = 0,
    groups = 0
  for (let first = 0; first < tree.count; first += 64, groups++) {
    const xs: number[] = [],
      zs: number[] = []
    for (let k = first; k < Math.min(tree.count, first + 64); k++) {
      const t = roots[tree.order[k]].world.elements
      xs.push(t[12])
      zs.push(t[14])
    }
    sum += Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs))
  }
  return sum / groups
}

/** A field of 40² placements 6 m apart, their ranks shuffled: the rows' order is no place's. */
function shuffled() {
  const roots = placementField(40, 6)
  let seed = 3
  const next = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  for (let k = roots.length - 1; k > 0; k--) {
    const j = Math.floor(next() * (k + 1))
    ;[roots[k], roots[j]] = [roots[j], roots[k]]
  }
  return roots
}

test('a parked placement leaves the tree’s groups side by side', () => {
  const roots = shuffled(),
    side = 39 * 6
  const free = meanGroup(roots)
  roots[17] = { ...roots[17], parked: true }
  assert.equal(meanGroup(roots), free, 'the same order, one row parked')
  assert.ok(free < side / 2, `${free} m a group, the field ${side} m`)
})

test('a partition’s rows lie by their cell', () => {
  const roots = shuffled(),
    rows = createPlacementRows(roots.length)
  // Each placement a row of its cell: cells of 64 rows, ranks spread across the list.
  roots.forEach((root, w) => {
    const cell = Math.floor(((w * 37) % roots.length) / 64)
    setRowCell(rows, w, { cell, node: w })
    roots[w] = { ...root, placement: { rows, index: w } }
  })
  const tree = packDagSelection(roots).placementTree!
  const cells = Array.from(tree.order.subarray(0, tree.count), (w) => rows.cells![w]!.cell)
  for (let k = 1; k < cells.length; k++) assert.ok(cells[k] >= cells[k - 1], `member ${k}`)
})
