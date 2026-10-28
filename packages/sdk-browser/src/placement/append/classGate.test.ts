// An object enters the GPU scene once the pipelines of its classes are compiled, the image's and the cards' (`classGate.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { FEATURE_CLASS_KEYS } from '../../visibility/shader/materialClass.ts'
import { compiledClasses, featureClasses } from './classGate.ts'

/** A class pipeline whose compile the test lands or refuses. */
function pending() {
  let land!: () => void, refuse!: (error: Error) => void
  const promise = new Promise<void>((resolve, reject) => ((land = resolve), (refuse = reject)))
  return { prepare: () => promise, land, refuse }
}
const setOf = (made: Map<number, ReturnType<typeof pending>>) => ({
  of: (key: number) => {
    if (!made.has(key)) made.set(key, pending())
    return made.get(key)!
  },
})

test("an object whose class compiles has not entered: it does, with its cards, once the image's and the cards' class landed", async () => {
  const image = new Map<number, ReturnType<typeof pending>>(),
    cards = new Map<number, ReturnType<typeof pending>>()
  const classes = { ...setOf(image), cards: () => setOf(cards) } as never
  let entered = false
  const gate = compiledClasses(classes, [5, 9], true).then(() => (entered = true))
  await Promise.resolve()
  assert.equal(entered, false, 'no placement, no caster, no card yet')
  assert.deepEqual([...image.keys()], [5, 9])
  assert.deepEqual([...cards.keys()], [5, 9], "the cards' twin is asked too")
  image.get(5)!.land()
  image.get(9)!.land()
  cards.get(5)!.land()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(entered, false, 'a class of the cards still compiles')
  cards.get(9)!.land()
  await gate
  assert.equal(entered, true, 'it enters at the arrival')
})

test('a session without a cache asks no card; a refused compile does not keep the object out for ever', async () => {
  const image = new Map<number, ReturnType<typeof pending>>()
  let twinAsked = false
  const classes = {
    ...setOf(image),
    cards: () => ((twinAsked = true), setOf(new Map())),
  } as never
  const gate = compiledClasses(classes, [3], false)
  image.get(3)!.refuse(new Error('REFUSED'))
  await gate
  assert.equal(twinAsked, false, 'no cache, no card')
  assert.equal(
    await compiledClasses(undefined, [3], true),
    undefined,
    'no class set: nothing to wait for',
  )
})

test('the classes of the graphs are no part of the gate: only those of the features are waited for', () => {
  assert.deepEqual(featureClasses([0, 5, FEATURE_CLASS_KEYS, FEATURE_CLASS_KEYS + 3]), [0, 5])
})
