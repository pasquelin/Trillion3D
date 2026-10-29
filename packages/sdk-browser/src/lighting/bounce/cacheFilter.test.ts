// The radiance cache's filter: the neighbours and weights of a probe.

import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { cacheFilterProgram } from './cache/cacheFilterWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { POOL_SLOT } from './pool/poolLayout.ts'
import { ATLAS_CALLS, cellProbes, oneLevel } from './atlas.fixture.ts'
import { builtins } from '../../materials/texture/shaderRunBuiltins.fixture.ts'
import { equalAreaDecode } from '../../../../math/src/wgsl/octahedral.ts'
import { WORD_LIGHT_FORMAT } from '../../gpu/core/lightAtlasFormat.ts'

const CACHE_FILTER_PROGRAM = cacheFilterProgram(WORD_LIGHT_FORMAT)

test('a probe filters with the neighbours its level holds that a probe holds: a cell past the cube’s edge, whose table entry is another cell’s, is none', () => {
  // Slots 1 to 4 hold the cells in turn: two beside the origin and the two ends of the cube along x, the table's wrap joining them.
  const atlas = cellProbes([
    [0, 0, 0],
    [-1, 0, 0],
    [23, 0, 0],
    [-24, 0, 0],
  ])
  const neighbourSlot = Array<number>(6).fill(9)
  // Slot 1 (the cell beside the origin) stands an eighth of a metre along x from its cell's place: its offset, the eighth word of a slot.
  const slotWords = new Uint32Array(64)
  new Float32Array(slotWords.buffer)[POOL_SLOT.words + POOL_SLOT.offset] = 0.125
  const neighbourPosition = Array.from({ length: 6 }, () => [0, 0, 0])
  const { cacheNeighbour } = shaderRun<{
    cacheNeighbour: (n: number, cell: number[], level: number, spacing: number) => void
  }>(CACHE_FILTER_PROGRAM, ['cacheNeighbour'], {
    bounce: oneLevel(),
    cellTable: atlas,
    neighbourSlot,
    neighbourPosition,
    poolSlots: slotWords,
    textureLoad: (_: unknown, at: number[], a: number) => ATLAS_CALLS.textureLoad(atlas, at, a),
  })
  // The axes in turn: -x, +x, -y, +y, -z, +z.
  cacheNeighbour(0, [0, 0, 0], 0, 1)
  assert.equal(neighbourSlot[0], 2, 'the cell beside the origin holds a probe: its slot plus one')
  assert.deepEqual(neighbourPosition[0], [-0.875, 0, 0], 'a probe is where its offset moved it')
  cacheNeighbour(1, [0, 0, 0], 0, 1)
  assert.equal(neighbourSlot[1], 0, 'a cell no probe holds')
  cacheNeighbour(1, [23, 0, 0], 0, 1)
  assert.equal(neighbourSlot[1], 0, 'past the edge: the table holds the cell at the other end')
  cacheNeighbour(0, [-24, 0, 0], 0, 1)
  assert.equal(neighbourSlot[0], 0, 'past the other edge')
})

const res = 16

// The depth word of a ray that went `distance` metres and met a surface (a probe's depth: the half float, its sign bit the facing,
// its last bit the two-sidedness).
const word = (distance: number, front = true, twoSided = false) =>
  (((builtins.pack2x16float([distance, 0]) as number) & 0x7ffe) |
    (front ? 0x8000 : 0) |
    (twoSided ? 1 : 0)) >>>
  0

const kit = (own: number, neighbour: number, front = true, twoSided = false) =>
  shaderRun<{
    cacheNeighbourWeight: (
      n: number,
      own: number[],
      centre: number[],
      texel: number[],
      res: number,
      ownBase: number[],
      begin: number,
    ) => number
  }>(CACHE_FILTER_PROGRAM, ['cacheNeighbourWeight'], {
    cache: {
      resolution: res,
      flags: 0,
      level: 1,
      downsampleSq: 0,
      supersampleSq: 0,
      filterAngle: 0.2,
      eye: [0, 0, 0, 0],
    },
    bounce: oneLevel(),
    cellTable: {},
    // The neighbour on +x holds slot 2 (plus one), at the next cell's probe.
    neighbourSlot: [0, 2, 0, 0, 0, 0],
    neighbourPosition: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
    // Every texel of probe 0's map went `own` metres and met a surface, probe 1's `neighbour`, facing the ray or not.
    cacheRaw: {
      load: (at: number[]) => [0, at[0] < res ? word(own) : word(neighbour, front, twoSided), 0, 0],
    },
    textureLoad: (t: { load(at: number[]): number[] }, at: number[]) => t.load(at),
  }).cacheNeighbourWeight

/** The weight of the +x neighbour for a texel: the probe's rays went `ownDistance` metres, the neighbour's `neighbourDistance`. */
const weight = (
  ownDistance: number,
  neighbourDistance: number,
  texel = [3, 5],
  front = true,
  twoSided = false,
) =>
  kit(ownDistance, neighbourDistance, front, twoSided)(
    1,
    [0, word(ownDistance), 0, 0],
    [0, 0, 0],
    texel,
    res,
    [0, 0],
    Math.sqrt(3),
  )

test('a neighbour’s light weighs in the filter by the angle its ray makes seen from the probe — a contact keeps its shadow — and nothing where its ray met a back or a surface stands between the two probes', () => {
  // Both rays far: the angle is a hundredth of a radian at most, the weight nearly whole.
  const open = weight(100, 100)
  assert.ok(open > 0.9 && open <= 1, `${open}`)
  // The neighbour's ray ends much farther than the probe’s: held to the probe's own, so a contact (a short ray) is not blurred over.
  const contact = weight(1, 100)
  assert.ok(contact < open, `${contact}`)
  // A surface between the two probes: the probe's ray toward the neighbour ends before it reaches it.
  assert.equal(weight(0.3, 100), 0)
  // The neighbour's ray met the back of a one-sided surface: it weighs nothing; the back of a two-sided one weighs as a front.
  assert.equal(weight(100, 100, [3, 5], false, false), 0)
  assert.equal(weight(100, 100, [3, 5], false, true), open)
})

test('a neighbour allocated but not traced yet, whose map still holds the light of the probe that had its slot before, weighs nothing in the filter: the reference reads it, and reads a light made at another place', () => {
  // The reference allocates a probe for every cell the image reads, and marks it valid at once, then traces it only as far as the trace list
  // holds it: a probe whose rank in the list is past the most probes traced is written to no trace data, nor its last traced frame. The
  // probes of the first bucket, the new ones, are all traced, those over the budget downsampled, and the list holds no more than the temporary
  // atlas does, so that more new probes than that leave the surplus valid and untraced. The filter runs over the traced probes alone and
  // gathers their neighbours by their validity alone, reading each one's atlas at the probe's own texel: the depth, the radiance and the
  // sky — texels no trace has written since the slot left the free list: the atlas is never cleared, and the clearing of the free list
  // clears the list, the last-use frames and the offsets, not a texel.
  // The case: the probe of cell (0, 0, 0) traced, rays of 100 m, light 1; the cell (1, 0, 0) allocated this frame, not traced, its slot's map
  // the previous owner's: rays of 100 m, facing, light 8. Texel (3, 5); the probes 1 m apart.
  const ownLight = 1
  const staleLight = 8
  const begin = Math.sqrt(3)
  const texel = [3, 5]
  const decode = shaderRun<{ equalAreaDecode: (uv: number[]) => number[] }>(
    wgslModule(equalAreaDecode),
    ['equalAreaDecode'],
    {},
  ).equalAreaDecode
  const direction = decode([(texel[0] + 0.5) / res, (texel[1] + 0.5) / res])
  const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i])
  const add = (a: number[], b: number[]) => a.map((v, i) => v + b[i])
  const scale = (a: number[], k: number) => a.map((v) => v * k)
  const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0)
  // The reference's arccosine: Eberly's polynomial of degree one.
  const acosFast = (x: number) => {
    const res = (-0.156583 * Math.abs(x) + 0.5 * Math.PI) * Math.sqrt(1 - Math.abs(x))
    return x >= 0 ? res : Math.PI - res
  }
  // The reference's filter for the texel, the one neighbour (+x), every ray of both maps
  // 100 m and facing, so that the depth read at any texel is 100.
  const reference = (valid: boolean) => {
    let lighting = ownLight
    let total = 1
    if (valid) {
      const probe = [0, 0, 0]
      const neighbour = [1, 0, 0]
      const ownDepth = 100
      const neighbourDepth = 100
      const offset = 2 * begin
      let occlusion = 1
      const toNeighbour = sub(add(neighbour, scale(direction, offset)), probe)
      if (ownDepth * ownDepth < dot(toNeighbour, toNeighbour)) occlusion = 0
      const toProbe = sub(add(probe, scale(direction, offset)), neighbour)
      if (neighbourDepth * neighbourDepth < dot(toProbe, toProbe)) occlusion = 0
      const toHit = sub(add(neighbour, scale(direction, Math.min(neighbourDepth, ownDepth))), probe)
      const angle = acosFast(dot(toHit, direction) / Math.hypot(...toHit))
      const w = (1 - Math.min(Math.max(angle / 0.2, 0), 1)) * occlusion
      lighting += staleLight * w
      total += w
    }
    return { light: lighting / total, total: total - 1 }
  }
  const gate = (table: ReturnType<typeof cellProbes>) => {
    const neighbourSlot = Array<number>(6).fill(9)
    const { cacheNeighbour } = shaderRun<{
      cacheNeighbour: (n: number, cell: number[], level: number, spacing: number) => void
    }>(CACHE_FILTER_PROGRAM, ['cacheNeighbour'], {
      bounce: oneLevel(),
      cellTable: table,
      neighbourSlot,
      neighbourPosition: Array.from({ length: 6 }, () => [0, 0, 0]),
      poolSlots: new Uint32Array(64),
      textureLoad: (_: unknown, at: number[], a: number) => ATLAS_CALLS.textureLoad(table, at, a),
    })
    cacheNeighbour(1, [0, 0, 0], 0, 1)
    return neighbourSlot[1]
  }
  // Ours: the filter's loop over the neighbours a slot names (`continue` where it names none), the weight the shader's.
  const ours = (slot: number) => {
    let lighting = ownLight
    let total = 1
    if (slot !== 0) {
      const w = weight(100, 100, texel)
      lighting += staleLight * w
      total += w
    }
    return lighting / total
  }
  assert.match(CACHE_FILTER_PROGRAM, /if\(neighbourSlot\[n\]==0u\)\{continue;\}/)
  const traced = cellProbes([[0, 0, 0]])
  const allocated = cellProbes([
    [0, 0, 0],
    [1, 0, 0],
  ])
  // The reference's neighbour is valid (allocated, slot plus one 2); ours is not published, as only a probe the queue holds is.
  assert.equal(gate(allocated), 2)
  assert.equal(gate(traced), 0)
  // The reference's twin weighs the stale neighbour (the angle its ray makes with the probe's own, seen from the probe), and as the shader does.
  const { light, total } = reference(true)
  const shaderWeight = weight(100, 100, texel)
  assert.ok(total > 0, `weight ${total}`)
  assert.ok(Math.abs(total - shaderWeight) < 1e-6, `${total} ${shaderWeight}`)
  // It takes the stale light in: the result differs from the probe's own light by the stale share, (own + stale × w) / (1 + w) − own.
  const share = (ownLight + staleLight * total) / (1 + total) - ownLight
  assert.ok(share > 0, `share ${share}`)
  assert.ok(
    Math.abs(light - ownLight - share) < 1e-6,
    `light ${light}, own ${ownLight}, share ${share}, weight ${total}`,
  )
  // Ours is the light of the probe and of the neighbours that were traced, exactly the result without the stale one.
  assert.equal(ours(gate(traced)), reference(false).light)
  assert.equal(ours(gate(traced)), ownLight)
  // Traced, the neighbour weighs as the reference's twin does: the filter's weight is the reference's.
  assert.ok(Math.abs(ours(gate(allocated)) - light) < 1e-6, `${ours(gate(allocated))} ${light}`)
})

test('the filter measures a neighbour’s angle with the polynomial arccosine of the cosine itself, unclamped', () => {
  assert.match(CACHE_FILTER_PROGRAM, /fn fastAcos\(/)
  assert.match(CACHE_FILTER_PROGRAM, /let angle=fastAcos\(dot\(toHit,d\)\/length\(toHit\)\);/)
  assert.doesNotMatch(CACHE_FILTER_PROGRAM, /\bacos\(/)
})
