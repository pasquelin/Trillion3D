// A moving image's resolve on a real GPU: the shipped `directLightingWgsl`, through
// `contractLighting` with a moving image's rank left in the view's fourth viewport word, on random
// lamp sets of 1 to 256 and their edge cases — a lamp that reaches one sample only, a cell every lamp
// reaches. Every list, shadowed or not, sums what the still image (rank 0) sums, bit for bit: the
// resolve never draws a subset of its lights (it did for a shadowed list of more than four).
//
//   node bench/dawn/proofs.ts tests/gpu/lighting/moving-exact.gpu.ts
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import {
  LIGHT_SETTINGS,
  type SceneLight,
} from '../../../packages/sdk-core/src/scene/light/contracts.ts'
import type { ResolveScene } from './resolvePage.ts'
import { distanceVector3 } from '../../../packages/math/src/vector/vector.ts'
import {
  assertSameBits,
  assertWithinUlps,
  cellRecord,
  resolveRandom,
  resolveSamples,
  runResolves,
} from './resolveCases.ts'

const LIST = LIGHT_SETTINGS.tileLights
/** A moving image's rank, as the view once carried it: any but zero. */
const RANK = 37
const draw = resolveRandom(1249)
const { r, between, vector, unit } = draw
const { points, samples } = resolveSamples(64, draw)

type Lamp = { position: [number, number, number]; range: number }
const lamp = ({ position, range }: Lamp, index: number): SceneLight => {
  const spot = r() < 0.3
  return {
    id: `l${index}`,
    kind: spot ? 'spot' : 'point',
    position,
    ...(spot ? { direction: unit(vector(1)), coneAngle: 0.8, penumbra: 0.3 } : {}),
    color: [between(0.2, 1), between(0.2, 1), between(0.2, 1)],
    intensity: between(1, 20),
    range,
    castsShadow: false,
  }
}
/** `count` lamps, a share `near` of them about the samples; `all` puts each over every sample. */
const lamps = (count: number, near: number, all = false): Lamp[] =>
  Array.from({ length: count }, () => {
    const close = all || r() < near
    const position = vector(all ? 0.5 : close ? 2.5 : 10) as [number, number, number]
    return { position, range: all ? between(4, 6) : close ? between(1.5, 4) : between(0.5, 3) }
  })
/** A lamp whose sphere holds one sample alone: a hair past it, a hair wide. */
const oneSample = (): Lamp => {
  const [x, y, z] = points[5]
  return { position: [x + 0.004, y, z], range: 0.01 }
}

/** The tile's list: every lamp whose sphere comes within 30 % of a sample — those that reach
 *  one, and near misses that add an exact zero —, in rank order. */
const listOf = (set: Lamp[]) =>
  set.flatMap((l, i) =>
    points.some((P) => distanceVector3(P, l.position) < l.range * 1.3) ? [i] : [],
  )

/** A cell's record of `list`, named, as the grid pass of a scene of `count` lamps writes it:
 *  `shadowed` the listed ranks that carry a shadow slot, so the flag is the pass's. */
const record = (name: string, list: number[], count: number, shadowed: number[] = []) => ({
  name,
  narrow: count <= LIST,
  words: cellRecord(list, shadowed),
})

const sets: Lamp[][] = [1, 2, 3, 4, 5, 6, 9, 17, 33, 48, 64, 65, 120, 200, 256].map((n) =>
  lamps(n, 0.7),
)
for (let k = 0; k < 6; k++) sets.push(lamps(1 + Math.floor(r() * 256), between(0.2, 0.9)))
sets.push([...lamps(20, 0.5), oneSample(), ...lamps(19, 0.5)]) // a lamp touching one sample
sets.push(lamps(LIST, 0, true), lamps(256, 0, true)) // a tile every lamp reaches
const lists = sets.map(listOf)

/** Per set, four scenes: the moving and the still resolve of the unshadowed lamps; then, one
 *  listed lamp shadowed, the moving and the still resolve and the moving program with no
 *  rectangle code. */
const SCENES: ResolveScene[] = sets.flatMap((set, s) => {
  const lights = set.map(lamp)
  const list = lists[s]
  const shadowed = list[Math.floor(list.length / 2)]
  const shadowLights = lights.map((light, i) => ({ ...light, castsShadow: i === shadowed }))
  const slots: [number, number][] = [[shadowed, 0]]
  return [
    { lights, samples, rank: RANK, records: [record('moving', list, set.length)] },
    { lights, samples, rank: 0, records: [record('still', list, set.length)] },
    {
      lights: shadowLights,
      samples,
      rank: RANK,
      slots,
      records: [
        record('shadowMoving', list, set.length, [shadowed]),
        // The program with no rectangle code, moving too: the scene holds none.
        { ...record('rectless', list, set.length, [shadowed]), rectless: true },
      ],
    },
    {
      lights: shadowLights,
      samples,
      rank: 0,
      slots,
      records: [record('shadowStill', list, set.length, [shadowed])],
    },
  ]
})

/** Per set, its name and every record's sums under the record's name. */
let readings: { name: string; sums: Record<string, number[]> }[] = []
before(async () => {
  assert.ok(
    lists.every((list) => list.length > 0),
    'every tile lists a lamp',
  )
  assert.equal(lists.at(-2)!.length, LIST, 'every lamp reaches the tile')
  assert.ok(
    lists.some((l) => l.length > 4 && l.length <= LIST),
    'lists the moving resolve once drew',
  )
  assert.ok(
    lists.some((l) => l.length > LIST),
    'a list past its record',
  )
  // The lamp over one sample reaches it and no other, and its tile lists it.
  const edge = sets.findIndex((set) => set.length === 40)
  const { position, range } = sets[edge][20]
  const reached = points.filter((P) => distanceVector3(P, position) < range)
  assert.equal(reached.length, 1, 'one sample in reach')
  assert.ok(lists[edge].includes(20))
  const runs = await runResolves(SCENES)
  assert.equal(runs.length, SCENES.length)
  readings = sets.map((set, s) => ({
    name: `${set.length} lamps, ${lists[s].length} listed`,
    sums: Object.assign({}, ...runs.slice(4 * s, 4 * s + 4)),
  }))
})

test('a moving list with no shadowed light sums what the still image sums, bit for bit', () => {
  for (const { name, sums } of readings) {
    assertSameBits(sums.moving, sums.still, name)
    assert.ok(sums.still.some(Boolean), `${name}: the samples are lit`)
  }
})

test('a moving list holding a shadowed light sums what the still image sums, bit for bit', () => {
  for (const { name, sums } of readings) assertSameBits(sums.shadowMoving, sums.shadowStill, name)
})

test('the moving program with no rectangle code sums what the full one does, to four units in the last place', () => {
  for (const { name, sums } of readings) assertWithinUlps(sums.rectless, sums.shadowMoving, 4, name)
})
