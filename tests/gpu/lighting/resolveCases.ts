// What the resolve proofs share: a seeded draw, samples of each lit model, a cell's
// record as the grid pass writes it, and the run of `resolvePage.ts` on Dawn.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { lcgRandom } from '../../../packages/math/src/sequence/random.ts'
import { lois } from '../kit/randomDraw.ts'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import type { ResolveScene } from './resolvePage.ts'
import { distanceVector3 } from '../../../packages/math/src/vector/vector.ts'
import { unit as unitTuple } from '../../../packages/math/src/vector/vectorTuple.ts'

/** A seeded draw: a number in a range, a vector in a cube, a unit vector. */
export function resolveRandom(seed: number) {
  const { hasard: r, between: between } = lois(lcgRandom(seed))
  const vector = (size: number) => [
    between(-size, size),
    between(-size, size),
    between(-size, size),
  ]
  const unit = (v: number[]) => unitTuple([v[0], v[1], v[2]])
  return { r, between, vector, unit }
}

/** `count` points in a two-metre box and their samples: a surface of each lit model (standard,
 *  diffuse, toon). */
export function resolveSamples(count: number, draw: ReturnType<typeof resolveRandom>) {
  const { r, between, vector, unit } = draw
  const points = Array.from({ length: count }, () => vector(1))
  const samples = points.flatMap((P, k) => [
    ...[between(0.1, 1), between(0.1, 1), between(0.1, 1), r() < 0.3 ? 1 : 0],
    ...[...unit(vector(1)), between(0.05, 1)],
    ...[...P, between(0.5, 1)],
    ...[...unit([between(-0.5, 0.5), between(-0.5, 0.5), 1]), [2, 4, 5][k % 3]],
  ])
  return { points, samples }
}

/** The distance between two points. */
export const distance = (a: number[], b: number[]) => distanceVector3(a, b)

/** A cell's record as the grid pass writes it, its list after it in the same buffer: its
 *  count, the high bit set when a listed rank of `shadowed` holds a shadow slot, then where its list
 *  starts — word 2 —, or with no `room` in the pool `TILE_NO_SLICE`: every light of the scene. */
export const cellRecord = (list: number[], shadowed: number[] = [], room = true) => [
  (list.length | (list.some((rank) => shadowed.includes(rank)) ? 0x80000000 : 0)) >>> 0,
  room ? 2 : 0xffffffff,
  ...(room ? list : []),
]

/** The sums of each record of each scene, as f32 bits, under the record's name. Nothing may go
 *  wrong on the way: no compilation or uncaptured error, no error a frame callback threw. */
export async function runResolves(scenes: ResolveScene[]) {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'resolvePage.ts'),
    'resolvePage',
  )) as typeof import('./resolvePage.ts')
  const pageErrors: string[] = []
  const result = await runOnDawn(page.run, scenes, pageErrors)
  assert.ok(!('unavailable' in result), 'WebGPU must be available')
  assert.deepEqual([...result.errors, ...pageErrors], [])
  return result.runs
}

/** Asserts two runs' sums are the same f32 bits, and says otherwise how many words differ and the
 *  first of them — a message, not two arrays of a thousand words. */
export function assertSameBits(actual: number[], expected: number[], name: string) {
  assert.equal(actual.length, expected.length, `${name}: one run lacks sums`)
  const apart = actual.flatMap((word, i) => (word === expected[i] ? [] : [i]))
  const first = apart.length
    ? `, word ${apart[0]}: ${actual[apart[0]]} for ${expected[apart[0]]}`
    : ''
  assert.equal(apart.length, 0, `${name}: ${apart.length} of ${actual.length} words differ${first}`)
}
