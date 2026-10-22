// The probe update's group is one probe, one thread a ray (`probeGroupWgsl.ts`): its width is the
// probe's rays, never the dispatch width other kernels tune, so a retuned `WORKGROUP_THREADS`
// cannot push its partial sums past the 16 KiB of workgroup memory every device holds. Its spatial
// filter (`probeFilterWgsl.ts`) is run here on the shipped text.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslConstants } from '../../../materials/texture/shaderRule.fixture.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../../math/src/wgsl/assemble.ts'
import { BOUNCE_PROBE_SHADER } from './probeWgsl.ts'
import { FILTER_BYTES, PROBE_FILTER_WGSL } from './probeFilterWgsl.ts'
import { BOUNCE_SETTINGS } from '../../../../../sdk-core/src/bounce/contracts.ts'
import { GUARANTEED_WORKGROUP_BYTES } from '../../../gpu/core/textureLimits.ts'
import { CENSUS_WORDS, censusWgsl } from './censusWgsl.ts'

test('the probe update is as wide as a probe’s rays, its sums within the guaranteed memory', () => {
  const body = BOUNCE_PROBE_SHADER.split('fn updateProbes(')[0]
  assert.match(body, /@compute @workgroup_size\(PROBE_THREADS\)\n$/)
  assert.match(
    BOUNCE_PROBE_SHADER,
    /var<workgroup> partial:array<array<vec3f,PROBE_THREADS>,PROBE_SUMS>;/,
  )
  assert.match(BOUNCE_PROBE_SHADER, /var<workgroup> partialTravelled:array<f32,PROBE_THREADS>;/)
  const constants = wgslConstants(BOUNCE_PROBE_SHADER) as Record<string, number>
  const threads = constants.PROBE_THREADS
  assert.equal(threads, BOUNCE_SETTINGS.raysPerProbe)
  assert.equal(
    constants.PROBE_SUMS,
    15,
    'nine basis sums, four of distance and two of the neighbours’ shares',
  )
  assert.equal(threads & (threads - 1), 0, 'the sums gather by halves')
  assert.match(
    BOUNCE_PROBE_SHADER,
    new RegExp(`var<workgroup> tally:array<atomic<u32>,${CENSUS_WORDS}>;`),
  )
  assert.ok(threads * (15 * 16 + 4) + FILTER_BYTES + CENSUS_WORDS * 4 <= GUARANTEED_WORKGROUP_BYTES)
  // The census's tally gives each of its words a lane of the group; a group with fewer lanes is refused.
  assert.ok(CENSUS_WORDS <= threads)
  assert.throws(() => censusWgsl(0, CENSUS_WORDS - 1), RangeError)
})

test('a probe’s rays are its threads: each lane its one ray', () => {
  assert.match(BOUNCE_PROBE_SHADER, /let d=rayDirection\(lane,jitter,rotation\);/)
  assert.doesNotMatch(BOUNCE_PROBE_SHADER, /for\(var ray=/)
})

test('the update counts the rays that left the scene, what their shadow rays found, what spent them and where their work went', () => {
  // Each ray counts in the group's tally, flushed to the buffer once, after the rays' last barrier.
  const counted = (word: string) => new RegExp(`tallyAdd\\(${word}`)
  for (const word of [
    'CENSUS_ESCAPED',
    'CENSUS_SHADOW_FREE',
    'CENSUS_SHADOW_BLOCKED',
    'CENSUS_EXHAUSTED_BY',
    'CENSUS_WALK_WORK',
    'CENSUS_WALK_MEMBERS',
  ])
    assert.match(BOUNCE_PROBE_SHADER, counted(word), word)
  assert.match(BOUNCE_PROBE_SHADER, /flushTally\(lane\);\n if\(lane!=0u\)\{return;\}/)
})

test('no ray is left out of a probe’s estimate: an exhausted one answers, every lane adds its sums', () => {
  // `rtProbeRay` answers a distance for every ray (an exhausted walk is a hit, a shadow ray that is
  // exhausted a blocker): the update has no branch for a ray without an answer.
  assert.match(BOUNCE_PROBE_SHADER, /let rays=f32\(PROBE_THREADS\);/)
})

/** The filter's functions over the neighbours `slots` name — a zero for one that does not filter — each
 *  with its two distance vectors, as the group's workgroup memory holds them. */
function filter(
  slots: number[],
  distances: [number[], number[]] = [
    [100, 100, 100],
    [100, 100, 100],
  ],
) {
  const scope = {
    filterSlot: slots,
    filterPositive: slots.map(() => distances[0]),
    filterNegative: slots.map(() => distances[1]),
  }
  return shaderRun<{
    filterShare: (
      axis: number[],
      spacing: number,
      d: number[],
      own: number,
      other: number,
    ) => number
    filterShares: (d: number[], own: number, spacing: number) => { low: number[]; high: number[] }
    filterWeight: (
      n: number,
      share: number,
      positive: number[],
      negative: number[],
      spacing: number,
    ) => number
  }>(
    wgslModule(PROBE_FILTER_WGSL),
    ['filterShare', 'filterShareOf', 'filterShares', 'filterWeight'],
    scope,
  )
}

test('a neighbour’s light is shared by the rays that ended where its own did, not by a contact', () => {
  const { filterShare } = filter([])
  const angle = BOUNCE_SETTINGS.filterHitAngle
  const share = (axis: number[], d: number[], own: number, other: number) =>
    filterShare(axis, 1, d, own, other)
  // Along the axis the two rays are one: whatever they met, the neighbour's light is the probe's.
  assert.ok(Math.abs(share([1, 0, 0], [1, 0, 0], 3, 3) - 1) < 1e-6)
  // A ray square to the axis, both ending at ten metres: the neighbour a metre aside sees it at an angle.
  const far = 1 - Math.atan(1 / 10) / angle
  assert.ok(Math.abs(share([1, 0, 0], [0, 1, 0], 10, 10) - far) < 1e-6, `${far}`)
  // Close — two metres —, that angle is past the filter's: a contact is not shared.
  assert.equal(share([1, 0, 0], [0, 1, 0], 2, 2), 0)
  // The shorter end counts: a neighbour that saw a long way, the probe a contact, shares none of it...
  assert.equal(share([1, 0, 0], [0, 1, 0], 0.5, 100), 0)
  // ...nor does the probe share what it saw far when the neighbour met a contact.
  assert.equal(share([1, 0, 0], [0, 1, 0], 100, 0.5), 0)
  // The sky, two hundred metres off, is shared.
  assert.ok(share([0, 0, 1], [0, 1, 0], 200, 200) > 0.97)
})

test('a ray shares only with the neighbours that filter, one weight an axis', () => {
  // Neighbours 0 (below on x), 2 (below on y) and 5 (above on z) filter; the others hold nothing.
  const { filterShares } = filter([1, 0, 1, 0, 0, 1])
  const { low, high } = filterShares([0, 0, 1], 30, 1)
  // Along z, the neighbours below on x and y are a metre aside a ray that ended 30 m off — nearly on it —;
  // the one above on z is on the ray: all its light is the probe's. The others share nothing.
  assert.deepEqual(
    [low[1], high[0], high[1]],
    [0, 0, 0],
    'a neighbour that does not filter shares none',
  )
  assert.ok(low[0] > 0.8 && low[2] > 0.8, `${low}`)
  assert.ok(Math.abs(high[2] - 1) < 1e-6, `${high}`)
})

test('a neighbour weighs its share where nothing stands between it and the probe, none where it does not filter', () => {
  const { filterWeight } = filter([1, 0, 1, 1, 1, 1])
  const open = [100, 100, 100],
    spacing = 2
  assert.equal(filterWeight(0, 0.6, open, open, spacing), 0.6)
  assert.equal(filterWeight(1, 0.6, open, open, spacing), 0, 'a neighbour that does not filter')
  // A wall a tenth of a metre from the probe on +x, which every neighbour filters past: the neighbour
  // on +x (n = 1) is behind it, the one on -x (n = 0) is not.
  const wall = [0.1, 100, 100]
  const filtering = filter([1, 1, 1, 1, 1, 1]).filterWeight
  assert.equal(filtering(1, 0.6, wall, open, spacing), 0, 'a wall on the probe’s +x side')
  assert.equal(filtering(0, 0.6, wall, open, spacing), 0.6, 'the wall is on the other side')
})

test('a neighbour filters only when the table names a probe that holds light for its cell and level, in view of this one', () => {
  const side = 4,
    cell = [1, 1, 1]
  // The probe each neighbour's cell holds: its state word (1 light, 0 empty, -1 buried), the cell and the
  // level it carries, and its mean distance toward the cell it looks at.
  const held: Record<string, { state: number; cell?: number[]; level?: number; toward?: number }> =
    {
      '0,1,1': { state: 1 },
      '2,1,1': { state: 0 },
      '1,0,1': { state: -1 },
      '1,2,1': { state: 1, cell: [1, 2, 3] },
      '1,1,0': { state: 1, level: 2 },
      '1,1,2': { state: 1, toward: 0.1 },
    }
  const slots = Object.keys(held)
  const table = (entry: number) => {
    const x = entry % side,
      y = Math.floor(entry / side) % side,
      z = Math.floor(entry / side ** 2) % side
    return slots.indexOf(`${x},${y},${z}`) + 1
  }
  const scope = {
    bounce: { counts: [side, 1, 64, 64] },
    filterSlot: new Array<number>(6).fill(0),
    filterPositive: new Array<number[]>(6).fill([0, 0, 0]),
    filterNegative: new Array<number[]>(6).fill([0, 0, 0]),
    tableEntry: table,
    poolProbe: (slot: number) => [slot, 0, 0],
    probeAt: (probe: number[], k: number) => {
      const key = slots[probe[0]],
        probeHeld = held[key],
        at = probeHeld.cell ?? key.split(',').map(Number)
      const w = [0, 0, probeHeld.state, ...at, 0, probeHeld.level ?? 0, 0, 0, 0][k]
      return k >= 9 ? [100, 100, probeHeld.toward ?? 100, 0] : [0, 0, 0, w]
    },
  }
  const { filterRead } = shaderRun<{
    filterRead: (n: number, cell: number[], level: number, spacing: number) => void
  }>(wgslModule(PROBE_FILTER_WGSL), ['filterRead'], scope)
  for (let n = 0; n < 6; n++) filterRead(n, cell, 0, 1)
  // Only the neighbour on -x: empty, buried, another cell's, another level's and walled-off ones hold none.
  assert.deepEqual(
    scope.filterSlot,
    [1, 0, 0, 0, 0, 0],
    'one neighbour filters, the other five do not',
  )
  assert.deepEqual(scope.filterPositive[0], [100, 100, 100])
})

test('the update averages a fresh estimate with the neighbours’ it weighs, and no probe is filtered with itself', () => {
  assert.match(BOUNCE_PROBE_SHADER, /if\(PROBE_FILTER&&!buried\)\{\n {2}var total=1\.0;/)
  assert.match(BOUNCE_PROBE_SHADER, /estimate\[k\]\+=weight\*probeAt\(neighbour,k\)\.xyz;/)
  assert.match(BOUNCE_PROBE_SHADER, /estimate\[k\]\/=total;/)
  // The neighbours are the cells beside the probe's own, never its own cell.
  assert.match(PROBE_FILTER_WGSL.text, /axis\[n>>1u\]=select\(-1\.0,1\.0,\(n&1u\)==1u\);/)
})
