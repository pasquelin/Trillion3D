// Toroidal storage of the bounce probes' table: `sampleLevelField` wraps its corner cell once and derives
// the seven neighbours' remainders from it. Run on the shader text itself, axis by axis — every
// operation involved is component-wise — against the per-cell remainder it replaces.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import { BOUNCE_GRID_WGSL } from './gridWgsl.ts'
import { functionBody } from '../../materials/texture/shaderRule.fixture.ts'
import { wrap } from '../../../../math/src/scalar/reals.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { PROBE_TEXELS } from './atlas.ts'
import { POOL_ROW_PROBES } from './atlas.fixture.ts'

const I32_MIN = -(2 ** 31)
const I32_MAX = 2 ** 31 - 1

/** A `let` initialiser of the sampling loop, as the shader writes it. */
const initialiser = (body: string, name: string) => {
  const found = body.match(new RegExp(`\\blet ${name}=(.+);`))
  assert.ok(found, `missing let ${name}`)
  return found[1]
}

/**
 * One axis of a WGSL expression as JavaScript: vector constructors become the scalar conversion,
 * `bounce.counts.x` the cube side `S`. Exact here: every value stays below 2^32 in magnitude.
 */
const scalar = (wgsl: string) =>
  wgsl
    .replace(/\bvec3u\(/g, 'u32(')
    .replace(/\bvec3i\(/g, 'i32(')
    .replace(/\b(\d+)u\b/g, '$1')
    .replace(/\bbounce\.counts\.x\b/g, 'S')
    .replace(/\blet /g, 'const ')

const sample = functionBody(BOUNCE_GRID_WGSL, 'sampleLevelField')
const slot = sample.match(/let slot=tableEntry\(cellEntry\(level,(.+)\)\);/)
assert.ok(slot, 'sampleLevelField reads its probe through the table, by the remainders of its cell')

/** The shader's remainder of one axis of a corner's neighbour: `probeWrap`, then the loop. */
const shaderRemainder = new Function(
  `const u32=(x)=>x>>>0,i32=(x)=>x|0,select=(f,t,c)=>c?t:f;
   return (S,corner,offset)=>{
    function probeWrap(cell){${scalar(functionBody(BOUNCE_GRID_WGSL, 'probeWrap'))}}
    const wrappedCorner=${scalar(initialiser(sample, 'wrappedCorner'))};
    const wrapAt=${scalar(initialiser(sample, 'wrapAt'))};
    const next=${scalar(initialiser(sample, 'next'))};
    return ${scalar(slot[1])};
   };`,
)() as (side: number, corner: number, offset: number) => number

/** The per-cell remainder it replaces: the i32 cell `corner + offset`, then its `probeWrap`. */
const perCellRemainder = (side: number, corner: number, offset: number) => {
  const cell = (corner + offset) | 0
  return wrap(cell, side) >>> 0
}

/** Corners at both ends of i32, whose `+ 1` neighbour stays within it. */
const EDGE_CORNERS = [I32_MIN, I32_MIN + 1, I32_MIN + 15, I32_MAX - 16, I32_MAX - 1]

const assertSameRemainders = (side: number, corners: Iterable<number>) => {
  for (const corner of corners)
    for (const offset of [0, 1])
      assert.equal(
        shaderRemainder(side, corner, offset),
        perCellRemainder(side, corner, offset),
        `side ${side}, corner ${corner}, offset ${offset}`,
      )
}

test('sampleLevelField wraps its corner once, outside the corner loop', () => {
  const loop = sample.slice(sample.indexOf('for(var index=0u'))
  assert.equal(loop.match(/probeWrap\(/g), null)
  assert.equal(sample.match(/probeWrap\(corner\)/g)?.length, 1)
  assert.ok(
    !sample.includes('cellEntry(level,probeWrap('),
    'no per-corner remainder is left in sampleLevelField',
  )
})

test('the hoisted remainder is the per-cell one on every side, near zero and at random', () => {
  const draw = lcgRandom(927)
  const randomCorners = Array.from({ length: 512 }, () => (draw() * 2 ** 32) | 0)
  const around = Array.from({ length: 200 }, (_, index) => index - 100)
  const corners = [...around, ...EDGE_CORNERS, ...randomCorners]
  const small = Array.from({ length: 64 }, (_, index) => index + 1)
  for (const side of [...small, 1000, 65535, 2 ** 20 + 7, 2 ** 30, I32_MAX])
    assertSameRemainders(side, corners)
})

test('the hoisted remainder is the per-cell one at the i32 wrap, power-of-two sides', () => {
  // A power-of-two side divides 2^32: the i32 cell that wraps past the largest corner still
  // has the next remainder, as the per-cell form computes it.
  for (let side = 1; side <= 2 ** 30; side *= 2) assertSameRemainders(side, [I32_MAX])
})

test('the levels’ own side is exact over every cell a level can hold', () => {
  // The side is 48, which does not divide 2^32: the wrap past the largest i32 cell is not the next
  // remainder. No level holds such a cell: a cell index is carried in `f32`s (a level's base, the point
  // it reads), exact to 2^24 — a world 16 million cells across, 17 000 km at the finest cell.
  const { cascadeSize } = BOUNCE_SETTINGS
  const limit = 2 ** 24
  const draw = lcgRandom(48)
  const corners = [
    ...Array.from({ length: 2000 }, () => Math.floor((draw() * 2 - 1) * limit)),
    -limit,
    limit - 1,
    -limit + 1,
    0,
    cascadeSize - 1,
    cascadeSize,
    -1,
    -cascadeSize,
  ]
  assertSameRemainders(cascadeSize, corners)
})

/** The levels' field `sampleBounceGathered` as the shader reads it, over a level of 4³ cells at
 *  spacing one and base zero, the point at (2, 2, 2) of normal up — every fade is one, the eight
 *  probes around it the cells 1–2 on each axis, their trilinear weights one half on x, 0.15 and 0.85
 *  on y, one half on z. `probeFor` gives the probe a cell holds: its radiance, its state word, the cell
 *  and the level it says it carries, or `held: false` for a cell the table names no slot for. */
function gather(
  probeFor: (cell: number[]) => {
    radiance: number
    state: number
    cell?: number[]
    level?: number
    held?: boolean
  },
) {
  const side = 4
  const table = new Map<number, number>()
  const held = new Map<string, ReturnType<typeof probeFor> & { at: number[] }>()
  let slot = 0
  const address = (s: number) => [
    (s % POOL_ROW_PROBES) * PROBE_TEXELS,
    Math.floor(s / POOL_ROW_PROBES),
    0,
  ]
  for (let x = 1; x <= 2; x++)
    for (let y = 1; y <= 2; y++)
      for (let z = 1; z <= 2; z++) {
        const cell = [x, y, z],
          probe = probeFor(cell)
        if (probe.held === false) continue
        table.set((z * side + y) * side + x, slot + 1)
        held.set(address(slot).join(), { ...probe, at: cell })
        slot++
      }
  const probeAt = (probe: number[], k: number) => {
    const found = held.get(probe.join(','))!
    const [cx, cy, cz] = found.cell ?? found.at
    return [
      [found.radiance, found.radiance, found.radiance, 1],
      [0, 0, 0, 0],
      [0, 0, 0, found.state],
      [0, 0, 0, cx],
      [0, 0, 0, cy],
      [0, 0, 0, cz],
      [0, 0, 0, 0],
      [0, 0, 0, found.level ?? 0],
      [0, 0, 0, 0],
      [100, 100, 100, 0],
      [100, 100, 100, 0],
    ][k]
  }
  const run = shaderRun<{
    sampleBounceGathered: (P: number[], N: number[]) => number[]
    shIrradiance: (probe: number[], n: number[]) => number[]
  }>(wgslModule(BOUNCE_GRID_WGSL), ['sampleBounceGathered', 'shIrradiance'], {
    bounce: { counts: [side, 1, 64, 64], levels: [{ base: [0, 0, 0], spacing: 1 }] },
    probeAt,
    tableEntry: (entry: number) => table.get(entry) ?? 0,
  })
  const one = slot ? run.shIrradiance(address(0), [0, 1, 0]) : [0, 0, 0]
  return { gathered: run.sampleBounceGathered([2, 2, 2], [0, 1, 0]), one }
}

test('a probe that holds no light yet answers "not yet": its share goes on, never to dark', () => {
  const LIGHT = 1,
    EMPTY = 0,
    BURIED = -1
  const lit = (cell: number[]) => ({ radiance: 3, state: LIGHT, cell })
  const full = gather(lit)
  assert.ok(
    Math.abs(full.gathered[3] - 1) < 1e-6,
    `every probe holds light: the share ${full.gathered[3]}`,
  )
  assert.ok(
    full.one[0] > 0 && Math.abs(full.gathered[0] - full.one[0]) < 1e-6,
    'the probes’ own irradiance',
  )
  // The four probes of x = 2 never updated: half of the point (their trilinear weight) is unanswered,
  // and what the others hold is the answer for the half they cover — not diluted, not renormalised whole.
  const empty = gather((cell) => (cell[0] === 2 ? { radiance: 0, state: EMPTY } : lit(cell)))
  assert.ok(Math.abs(empty.gathered[3] - 0.5) < 1e-6, `half is unanswered: ${empty.gathered[3]}`)
  assert.ok(Math.abs(empty.gathered[0] - full.gathered[0]) < 1e-6, 'the mean of those that answer')
  // A probe still carrying another cell (the level slid under it) is as empty as one never updated.
  const stale = gather((cell) =>
    cell[0] === 2 ? { ...lit(cell), cell: [2 + 4, 1, 1] } : lit(cell),
  )
  assert.ok(Math.abs(stale.gathered[3] - 0.5) < 1e-6, `a stale cell: ${stale.gathered[3]}`)
  // So is one the pool gave to the same cell of another level.
  const another = gather((cell) => (cell[0] === 2 ? { ...lit(cell), level: 1 } : lit(cell)))
  assert.ok(Math.abs(another.gathered[3] - 0.5) < 1e-6, `another level's: ${another.gathered[3]}`)
  // A cell no slot holds — the image never read it — names no probe: its share goes on too.
  const unread = gather((cell) =>
    cell[0] === 2 ? { radiance: 0, state: EMPTY, held: false } : lit(cell),
  )
  assert.ok(Math.abs(unread.gathered[3] - 0.5) < 1e-6, `no probe: ${unread.gathered[3]}`)
  assert.ok(Math.abs(unread.gathered[0] - full.gathered[0]) < 1e-6)
  // A probe buried in a surface weighs nothing, and the others answer the whole point.
  const buried = gather((cell) => (cell[0] === 2 ? { radiance: 0, state: BURIED } : lit(cell)))
  assert.ok(
    Math.abs(buried.gathered[3] - 1) < 1e-6,
    `buried probes weigh nothing: ${buried.gathered[3]}`,
  )
  assert.ok(Math.abs(buried.gathered[0] - full.gathered[0]) < 1e-6)
  // Nothing updated at all: nothing answers, the next source does.
  const none = gather(() => ({ radiance: 0, state: EMPTY }))
  assert.deepEqual(none.gathered, [0, 0, 0, 0])
  const nobody = gather(() => ({ radiance: 0, state: EMPTY, held: false }))
  assert.deepEqual(nobody.gathered, [0, 0, 0, 0], 'no cell read: the sky light answers')
})
