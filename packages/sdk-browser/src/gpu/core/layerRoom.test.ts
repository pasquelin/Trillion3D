import assert from 'node:assert/strict'
import test from 'node:test'
import { IDLE_KEEP_IMAGES } from './idleKeep.ts'
import { destroyRetired } from './frameRetire.ts'
import { perViewLayers, type LayerRoom } from './layerRoom.ts'

const device = {} as GPUDevice
const key = {}

test('a window of images asking nothing ends too, and lets a bigger set go', () => {
  const destroyed: number[] = []
  const views = perViewLayers<LayerRoom & { id: number }>((old) => destroyed.push(old.id))
  let made = 0
  const make = () => ({ id: ++made })
  const first = views.layers(key, device, 's', 4, 0, make)
  // Images without an ask: folded by keep, none by layers; the first window still holds the first ask, the second asks nothing.
  for (let frame = 1; frame <= 2 * IDLE_KEEP_IMAGES; frame++) views.keep(key, frame)
  // The window ended below what is held: the set was released (retired with the frame, destroyed on its drain).
  const next = views.layers(key, device, 's', 1, 2 * IDLE_KEEP_IMAGES + 1, make)
  assert.notEqual(next, first)
  assert.equal(next.capacity, 1)
  destroyRetired(device)
  assert.deepEqual(destroyed, [first.id])
})

test('the extra part asked in a window stays through the start of the next, and goes when a window ends without it', () => {
  const alsos: boolean[] = []
  const views = perViewLayers<LayerRoom & { also: boolean }>(() => {})
  const make = (_room: number, also: boolean) => {
    alsos.push(also)
    return { also }
  }
  const lacks = (have: { also: boolean }, also: boolean) => have.also !== also
  const ask = (frame: number, also: boolean) =>
    views.layers(key, device, 's', 2, frame, make, lacks, also)
  const first = ask(0, true)
  // The first window asked it and ends on an image that does not: the set keeps it.
  assert.equal(ask(IDLE_KEEP_IMAGES, false), first)
  // The next window has not asked it yet: nothing is remade while the window before asked it.
  assert.equal(ask(IDLE_KEEP_IMAGES + 1, false), first)
  assert.equal(ask(IDLE_KEEP_IMAGES + 2, false), first)
  assert.deepEqual(alsos, [true])
  // That window ends without it: the set is made again without the extra part.
  const without = ask(2 * IDLE_KEEP_IMAGES, false)
  assert.notEqual(without, first)
  assert.deepEqual(alsos, [true, false])
})

test('keep leaves an image that layers already folded alone', () => {
  const views = perViewLayers<LayerRoom>(() => {})
  const first = views.layers(key, device, 's', 2, 0, () => ({}))
  views.layers(key, device, 's', 2, 5, () => ({}))
  views.keep(key, 5)
  assert.equal(first.foldedAt, 5)
  assert.equal(
    views.layers(key, device, 's', 2, 6, () => ({})),
    first,
  )
})
