// The table from an object of the field's object grid to its placement in the surface cache (`hitInstances.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import type { TrackedRoot } from '../distanceField/objectTable.ts'
import { instanceWords } from './hitInstances.ts'

/** The word of an instance with no placement. */
const NO_PLACEMENT = 0xffffffff

/** A root of the cut: the world is of no matter here. */
const root = (standsFor?: number): TrackedRoot => ({
  world: { elements: [] },
  ...(standsFor === undefined ? {} : { standsFor }),
})

/** The words the table makes of the placements `held` — each its number and its root, or its roots — over `rankOf`. */
function table(
  held: [number, TrackedRoot | TrackedRoot[]][],
  rankOf: (root: TrackedRoot) => number | undefined,
  scratch = new Uint32Array(0),
) {
  const roots = new Map(held)
  const words = instanceWords(
    roots.keys(),
    (placement) => [roots.get(placement)!].flat(),
    rankOf,
    scratch,
  )
  return { words, listed: [...words.subarray(0, 1 + words[0])] }
}

test('a placement is told by the rank of its root, an instance with none by no placement', () => {
  const [a, b] = [root(), root()]
  const ranks = new Map([
    [a, 0],
    [b, 2],
  ])
  const { listed } = table(
    [
      [7, a],
      [4, b],
    ],
    (r) => ranks.get(r),
  )
  assert.deepEqual(listed, [3, 7, NO_PLACEMENT, 4])
})

test('every root that stands as a placement is told it: a hit of any primitive of its mesh finds its cards', () => {
  const [a, b, c] = [root(), root(), root()]
  const ranks = new Map([
    [a, 0],
    [b, 1],
    [c, 3],
  ])
  const { listed } = table(
    [
      [9, [a, b]],
      [4, c],
    ],
    (r) => ranks.get(r),
  )
  assert.deepEqual(listed, [4, 9, 9, NO_PLACEMENT, 4])
})

test('several roots of one placement sharing an instance are told that placement, not several', () => {
  const [a, b] = [root(2), root(2)]
  assert.deepEqual(table([[6, [a, b]]], () => undefined).listed, [3, NO_PLACEMENT, NO_PLACEMENT, 6])
})

test('a root the field’s scene does not hold has no instance, and is not told', () => {
  assert.equal(table([[1, root()]], () => undefined).words[0], 0)
})

test('the stand-ins of an HLOD cell’s actors are told by their own rank, and by the root of the world they stand for, where an instance of several is no placement', () => {
  // A placement of its own at rank 0, the root of the world DAG at rank 1, three cells' stand-ins after the cut's roots.
  const [own, ...standIns] = [root(), root(1), root(1), root(1)]
  const ranks = new Map([[own, 0], ...standIns.map((stand, at) => [stand, 2 + at] as const)])
  const { listed } = table(
    [
      [2, own],
      [5, standIns[0]],
      [6, standIns[1]],
      [8, standIns[2]],
    ],
    (r) => ranks.get(r),
  )
  // The instance of the world's root is told no placement; each stand-in is its own object, the one a hit of
  // the scene's triangles on its cell's actor names.
  assert.deepEqual(listed, [5, 2, NO_PLACEMENT, 5, 6, 8])
})

test('a table that fits the array given is written in it, the words past its count left none; a larger instance grows it', () => {
  const scratch = new Uint32Array(8).fill(9)
  const { words, listed } = table([[3, root()]], () => 1, scratch)
  assert.equal(words, scratch)
  assert.deepEqual(listed, [2, NO_PLACEMENT, 3])
  assert.equal(words[5], NO_PLACEMENT)
  const grown = table([[3, root()]], () => 20, scratch)
  assert.notEqual(grown.words, scratch)
  assert.deepEqual([grown.listed.length, grown.listed[21]], [22, 3])
})
