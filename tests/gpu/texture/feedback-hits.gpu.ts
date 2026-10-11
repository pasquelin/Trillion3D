// The texture feedback lists the tiles the pixels asked, not the table of every tile
// (`webgpu/tile/feedback.ts`, `reduce.ts`): each tile asked is listed once with the pixels that
// named it, the list read back is the tiles asked alone, an image after another counts afresh — the
// counters are zeroed by the gather —, and a list that overflows its capacity lists some tiles
// whole and leaves none counted for the next image.
//
//   node bench/dawn/proofs.ts tests/gpu/texture/feedback-hits.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'

type Page = typeof import('./feedbackHitsPage.ts')

const page = async () =>
  (await loadPage(resolve(import.meta.dirname, 'feedbackHitsPage.ts'), 'feedbackHitsPage')) as Page

/** The pixels naming each rank, counted off the target: the proof's oracle. */
function weights(requests: number[]) {
  const counted = new Map<number, number>()
  for (const request of requests)
    if (request) counted.set(request - 1, (counted.get(request - 1) ?? 0) + 1)
  return counted
}

/** A target of `width × height` whose pixel `n` asks rank `rank(n)`; 0 none. */
const target = (width: number, height: number, rank: (n: number) => number) =>
  Array.from({ length: width * height }, (_, n) => rank(n))

test('every pixel asked: each tile is listed once with the pixels that named it, image after image', async () => {
  const { run } = await page()
  const requests = target(64, 32, (n) => (n % 7 === 0 ? 0 : 1 + ((n * 13) % 50)))
  const { adapter, errors, listed } = await runOnDawn(run, {
    entries: 200,
    width: 64,
    height: 32,
    requests,
    every: true,
    images: 3,
  })
  assert.deepEqual(errors, [], `WebGPU errors on ${adapter}`)
  const expected = weights(requests)
  for (const [image, { ranks, weights: got }] of listed.entries()) {
    assert.equal(new Set(ranks).size, ranks.length, `image ${image}: a tile once`)
    assert.deepEqual(
      new Map(ranks.map((rank, at) => [rank, got[at]])),
      expected,
      `image ${image}: the tiles asked, and their weights`,
    )
  }
})

test('the pixels of the phase alone speak on an ordinary image', async () => {
  const { run } = await page()
  const [width, height] = [32, 16]
  const requests = target(width, height, (n) => 1 + (n % 5))
  const { errors, listed } = await runOnDawn(run, {
    entries: 8,
    width,
    height,
    requests,
    every: false,
    images: 1,
  })
  assert.deepEqual(errors, [])
  // Phase 0: the pixel (4x, 4y) of each square of four.
  const spoken = requests.filter((_, n) => (n % width) % 4 === 0 && Math.floor(n / width) % 4 === 0)
  assert.deepEqual(
    new Map(listed[0].ranks.map((rank, at) => [rank, listed[0].weights[at]])),
    weights(spoken),
  )
})

test('more tiles asked than the list holds: some listed whole, the next image counts afresh', async () => {
  const { run } = await page()
  const [width, height] = [256, 128]
  const entries = 40_000
  // 32 768 distinct tiles asked, one pixel each, against a list of 16 384.
  const requests = target(width, height, (n) => 1 + n)
  // Then an image that asks a few tiles alone: none left counted by the overflow before it.
  const then = target(width, height, (n) => (n < 100 ? 1 + n * 300 : 0))
  const { errors, listed, capacity } = await runOnDawn(run, {
    entries,
    width,
    height,
    requests,
    every: true,
    images: 3,
    then,
  })
  assert.deepEqual(errors, [])
  assert.equal(capacity, 16_384)
  const last = listed.pop()!
  assert.deepEqual(
    new Map(last.ranks.map((rank, at) => [rank, last.weights[at]])),
    weights(then),
    'the next image lists its own tiles alone, each once',
  )
  for (const [image, { ranks, weights: got }] of listed.entries()) {
    assert.equal(ranks.length, capacity, `image ${image}: the list is full`)
    assert.equal(new Set(ranks).size, capacity, `image ${image}: a tile once`)
    assert.ok(
      ranks.every((rank) => rank < width * height),
      `image ${image}: only tiles asked`,
    )
    assert.ok(
      got.every((weight) => weight === 1),
      `image ${image}: each named by its one pixel, none left counted from an image before`,
    )
  }
})
