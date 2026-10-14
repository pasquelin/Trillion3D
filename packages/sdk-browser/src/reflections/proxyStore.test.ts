// The run-time proxy's store follows the view (`createProxyStore`): an image whose camera stands where the set
// it reads was written reads and writes that set in place; one whose camera moved reads it reprojected, under
// the view of the image the radiance pyramid holds, and writes the other set; without that image, no history.
import test from 'node:test'
import assert from 'node:assert/strict'
import { STORE_MODE } from '../bounce/runtimeLayout.ts'
import { createProxyStore } from './proxyStore.ts'

const A = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const B = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.5, 0, 0, 1]
const SIZE = [4, 4] as const
/** The ranks of the sets read and written (`ReflectionView.runtime.z`). */
const sets = (words: number[]) => [words[2] & 1, words[2] >> 1]

/** A store no texture was made for, and an image of it: followed, traced, its radiance built. */
function storeOver() {
  const store = createProxyStore({} as GPUDevice, 4, 4, false)
  const image = (camera: number[], lights = 0, size: readonly [number, number] = SIZE) => {
    const words = [...store.follow(lights, 0, 0, camera, size)]
    store.traced()
    store.built()
    return words
  }
  return { store, image }
}

test('a still camera reads and writes one set in place, the epoch moving with the answers’ inputs alone', () => {
  const { image } = storeOver()
  image(A)
  const still = image(A)
  assert.equal(still[3], STORE_MODE.inPlace)
  const [read, written] = sets(still)
  assert.equal(read, written, 'one set')
  const lit = image(A, 1)
  assert.equal(lit[0], still[0] + 1, 'the lights move the epoch')
  assert.deepEqual(lit.slice(1), still.slice(1), 'not the sets')
})

test('a moved camera reads the set the image before wrote and writes the other, then reads that one', () => {
  const { image } = storeOver()
  image(A)
  const before = image(A)
  const moved = image(B)
  assert.equal(moved[3], STORE_MODE.reproject)
  assert.equal(sets(moved)[0], sets(before)[1], 'the set the image before wrote')
  assert.equal(sets(moved)[1], 1 - sets(moved)[0], 'the other')
  const after = image(B)
  assert.deepEqual([...sets(after), after[3]], [sets(moved)[1], sets(moved)[1], STORE_MODE.inPlace])
  assert.equal(image(B, 0, [2, 2])[3], STORE_MODE.reproject, 'a new drawn size is a move')
})

test('a moved camera holds no history when the radiance pyramid holds no image of the set’s view', () => {
  const { store, image } = storeOver()
  // The first image: no image before it.
  assert.equal(image(A)[3], STORE_MODE.unknown)
  // An image traced, its radiance never built: the pyramid holds an image before it.
  store.follow(0, 0, 0, A, SIZE)
  store.traced()
  assert.equal(image(B)[3], STORE_MODE.unknown)
  // Followed twice in an image: the same words.
  const once = [...store.follow(0, 0, 0, A, SIZE)]
  assert.deepEqual([...store.follow(0, 0, 0, A, SIZE)], once)
})
