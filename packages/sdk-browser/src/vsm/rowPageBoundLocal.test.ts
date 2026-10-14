// The shadow raster's chunks by where the rows are, under local lights (`rowPageBound.ts`), from
// the GPU's joint histograms (`rowBins.fixture.ts` lands them): what a chunk of K rows is said to
// hold is never below what the K rows of the most pairs and commands make under the shipped cull
// (`bruteForceLocal`) — spots and point lights, rows near and far, with a sun or alone, a light
// that moves then holds still; lamps that cannot beat the worst case binned no more.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createVsmRowBound,
  vsmBoundChunk,
  type VsmBoundLight,
  type VsmRowBound,
} from './rowPageBound.ts'
import { vsmRenderViews } from './chunkParams.ts'
import {
  bruteForce,
  bruteForceLocal,
  localAt,
  PAGES,
  scene,
  sunAt,
  worstOf,
  type SceneRows,
} from './rowPageBound.fixture.ts'
import { landBins, topSums } from './rowBins.fixture.ts'

/** One frame's bound of `rows` under `lights`, then the histogram it asks, landed at once; commands
 *  a row at most the views' mips. */
function ask(rows: SceneRows, lights: VsmBoundLight[], bound: VsmRowBound, bin = true) {
  const end = rows.packed.length / 8,
    { views } = vsmRenderViews(lights),
    cmdsPerRow = views.reduce((n, v, i) => (i % 4 === 1 ? n + v : n), 0)
  // A worst case of 64 rows a chunk: the scenes' few hundred rows take several.
  const worst = { ...worstOf(), rows: 64, cmdsPerRow },
    range = { first: 0, end, candidates: end }
  const chunk = vsmBoundChunk(bound, rows.spheres, range, lights, worst)
  if (bin) landBins(bound, rows, range, lights)
  return chunk
}

/** Asserts the bound of `rows` under `lights` over every K, its histogram made a frame before.
 *  Returns the chunk. */
function holds(rows: SceneRows, lights: VsmBoundLight[], bound = createVsmRowBound()) {
  ask(rows, lights, bound)
  const chunk = ask(rows, lights, bound)
  assert.ok(chunk && bound.bins.landed?.lampKeys, 'the joint bins bound the rows')
  const n = rows.packed.length / 8,
    pairs = new Float64Array(n),
    cmds = new Float64Array(n)
  for (const light of lights) {
    const truth = light.clipmap ? bruteForce(rows, light, PAGES) : bruteForceLocal(rows, light)
    truth.pairs.forEach((v, i) => ((pairs[i] += v), (cmds[i] += truth.cmds[i])))
  }
  const top = topSums(pairs.map((v) => Math.min(v, PAGES))),
    topCmds = topSums(cmds)
  for (let k = 1; k <= n; k += Math.max(1, Math.floor(n / 97))) {
    assert.ok(chunk.pairs(k) >= top[k], `pairs of ${k} rows: ${chunk.pairs(k)} < ${top[k]}`)
    assert.ok(chunk.cmds(k) >= topCmds[k], `commands of ${k} rows`)
  }
  return chunk
}

const spot = (position: number[], direction: number[], range: number, coneAngle: number) =>
  localAt({ kind: 'spot', position, direction, range, coneAngle }).light
const point = (position: number[], range: number) =>
  localAt({ kind: 'point', position, range }).light

test('spots, near and far, narrow and wide: no K rows make more than the bound says', () => {
  for (let seed = 1; seed <= 3; seed++) {
    const at = [3 * seed, 2.5, -seed]
    const rows = scene(700, at, 4 * seed, 0.01, 0.6, seed)
    holds(rows, [spot(at, [0.2, -1, 0.1 * seed], 3 * seed, 0.25 + 0.3 * seed)])
  }
})

test('point lights, rows around and inside them: no K rows make more than the bound says', () => {
  for (let seed = 1; seed <= 3; seed++) {
    const at = [-2 * seed, 1.5, 4]
    holds(scene(500, at, 3 * seed, 0.02, 0.5, seed + 10), [point(at, 2.5 * seed)])
  }
})

test('a sun, two spots and a point light together, far from the origin', () => {
  const far = [8.4e5, 12, -3.1e5]
  const rows = scene(600, far, 12, 0.02, 0.8, 21)
  const lamps = [
    spot(far, [0, -1, 0], 6, 0.5),
    spot(
      far.map((v, k) => v + [3, 0, -2][k]),
      [1, -1, 0],
      9,
      0.9,
    ),
    point(
      far.map((v, k) => v + [-4, 1, 1][k]),
      5,
    ),
  ]
  holds(rows, [sunAt(far.map((v) => v + 0.4)).light, ...lamps])
})

test('a lamp among many far rows bounds a chunk far above the worst case', () => {
  const rows = scene(20_000, [0, 1.5, 0], 30, 0.05, 0.3, 5)
  const chunk = holds(rows, [point([0, 2.5, 0], 4), spot([5, 2.8, 5], [0, -1, 0], 6, 0.6)])
  assert.ok(chunk.rows > 16 * 64, `${chunk.rows} rows a chunk`)
})

test('a light that moves keeps its worst case until a histogram of where it holds lands', () => {
  const rows = scene(900, [0, 1, 0], 6, 0.02, 0.4, 31)
  const bound = createVsmRowBound()
  const cache = localAt({ kind: 'spot', position: [0, 3, 0], range: 5, coneAngle: 0.6 }).cache
  const lamp = (x: number) =>
    localAt(
      { kind: 'spot', position: [x, 3, 0], direction: [0, -1, 0], range: 5, coneAngle: 0.6 },
      cache,
    ).light
  // Moving: each histogram binned where it no longer is; no sun, no bound.
  for (let f = 0; f < 3; f++) assert.equal(ask(rows, [lamp(f * 0.5)], bound), undefined)
  // Held still: the next frame reads the histogram made where it holds.
  holds(rows, [lamp(1)], bound)
})

test('a light’s weights follow the physical pages they are capped at', () => {
  const rows = scene(300, [0, 1, 0], 2, 0.05, 0.3, 37)
  const lamp = point([0, 1, 0], 3),
    bound = createVsmRowBound()
  holds(rows, [lamp], bound)
  const range = { first: 0, end: 300, candidates: 300 }
  const more = { rows: 256, cmdsPerRow: 48, pages: 8192, cap: 1 << 21 }
  assert.equal(vsmBoundChunk(bound, rows.spheres, range, [lamp], more)!.pairs(1), 8192)
})

test('lamps whose rows cannot beat the worst case are binned no more until they change', () => {
  const rows = scene(3000, [0, 1.5, 0], 3, 0.1, 0.4, 43)
  const lamps = Array.from({ length: 9 }, (_, i) =>
    point([(i % 3) * 2 - 2, 2.5, ((i / 3) | 0) * 2 - 2], 4),
  )
  // The raster's worst case: 1024 rows a chunk of 2²¹ pairs.
  const worst = { ...worstOf(), cmdsPerRow: 9 * 48 },
    range = { first: 0, end: 3000, candidates: 3000 }
  const bound = createVsmRowBound()
  const frame = () => {
    const chunk = vsmBoundChunk(bound, rows.spheres, range, lamps, worst)
    landBins(bound, rows, range, lamps)
    return chunk
  }
  assert.equal(frame(), undefined)
  frame()
  assert.ok(bound.bins.hopeless, 'found unable to beat the worst case')
  // While they hold, no histogram is asked: nothing else to bin.
  const asked = bound.bins.seq
  for (let f = 0; f < 3; f++) frame()
  assert.equal(bound.bins.seq, asked)
})
