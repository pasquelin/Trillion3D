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

/** The words the table makes of the placements `held` — each its number and its root — over `rankOf`. */
function table(
  held: [number, TrackedRoot][],
  rankOf: (root: TrackedRoot) => number | undefined,
  scratch = new Uint32Array(0),
) {
  const roots = new Map(held)
  const words = instanceWords(roots.keys(), (placement) => roots.get(placement), rankOf, scratch)
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

test('a root the field’s scene does not hold has no instance, and is not told', () => {
  assert.equal(table([[1, root()]], () => undefined).words[0], 0)
})

test('the stand-ins of an HLOD cell’s actors are told by the root of the world they stand for, and an instance of several is no placement', () => {
  // Three cells' stand-ins for the root of rank 1, and a placement of its own at rank 0.
  const { listed } = table(
    [
      [5, root(1)],
      [6, root(1)],
      [8, root(1)],
      [2, root()],
    ],
    () => 0,
  )
  assert.deepEqual(listed, [2, 2, NO_PLACEMENT])
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
