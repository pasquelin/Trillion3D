// A row's shadow change is the rows pass's (`rowCastWgsl.ts`, the shipped WGSL run in JavaScript):
// every row derived again appends the box of its sphere at the pose it left and at the one it
// entered — moving only when it was moving before and after —, nothing when nothing it casts
// changed, the pose a row enters when it arrives in a slot that held none, and the pose a row
// leaves when it is released: both a residency change, which the CPU no longer declares. The old code appended only for the rows whose change was asked: a row derived for
// another reason — the table handing it another page, a pose within a float32 step — moved its
// sphere without a box, and the pages it was drawn into kept its shadow.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { fromF32Bits } from '../../../math/src/float/bits.ts'
import { DERIVE_ROWS_WGSL, PART_CASTS, PART_SPHERES } from './rowWordsWgsl.ts'
import { INPUT_FLAGS, ROW_INPUT_DOUBLES } from './rowInputPack.ts'
import { LOD_BIT } from '../webgpu/shadow/rowLodWords.ts'
import { DOUBLE_HELPERS, pair } from './composeDoubles.fixture.ts'
import { ROW_WORDS } from '../visibility/types.ts'
import { PAGE_INFO } from '../visibility/pageInfo.ts'
import { MOBILITY_MOVING, MOBILITY_SHADOWLESS } from '../gpu/shadow/mobilityBits.ts'
import { CAST_HEADER_WORDS, CAST_RECORD_WORDS } from '../webgpu/shadow/castChanges.ts'

const ROWS = 2,
  HALF = 0.5
const NAMES = [
  ...DOUBLE_HELPERS,
  ...['toF32', 'fromF32', 'splitDouble', 'composeSphere', 'clearRow'],
  ...[
    'castCode',
    'castState',
    'rowSphere',
    'emitCast',
    'sphereHalf',
    'sphereCentre',
    'emitSphere',
    'castRow',
    'staleRow',
  ],
  ...['deriveRow'],
]

/** Two rows, each its own root's, a cube of half extent `HALF` about its origin; a change list of
 *  `records` records. */
function rig(records = 16) {
  const rootWorlds: number[][] = [],
    table = new Uint32Array(ROWS * ROW_WORDS),
    spheres = new Array<number>(ROWS * 8).fill(0),
    inputs: number[][] = [],
    mobility = new Uint32Array(ROWS),
    castChanges = new Uint32Array(CAST_HEADER_WORDS + records * CAST_RECORD_WORDS)
  for (let row = 0; row < ROWS; row++) {
    table[row * ROW_WORDS + PAGE_INFO.at.placement] = row
    for (let at = 0; at < ROW_INPUT_DOUBLES; at++)
      inputs[row * ROW_INPUT_DOUBLES + at] =
        at === INPUT_FLAGS ? [LOD_BIT.record, 0] : pair(at >= 3 && at < 6 ? HALF : 0)
  }
  const place = (rank: number, x: number) => {
    const world = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1]
    for (let k = 0; k < 16; k++) rootWorlds[rank * 16 + k] = pair(world[k])
  }
  for (let rank = 0; rank < ROWS; rank++) place(rank, rank * 10)
  type Run = { deriveRow(row: number, stale?: boolean): void }
  const run = shaderRun<Run>(DERIVE_ROWS_WGSL, NAMES, {
    arrayLength: (ref: { get(): { length: number } }) => ref.get().length,
    params: { rootCount: ROWS, parts: PART_SPHERES | PART_CASTS },
    rootWorlds,
    table,
    spheres,
    inputs,
    mobility,
    castChanges,
  })
  /** The records appended since the last call, emptied as an invalidation empties them. */
  const taken = () => {
    const count = Math.min(castChanges[0], records),
      out = []
    for (let k = 0; k < count; k++) {
      const at = CAST_HEADER_WORDS + k * CAST_RECORD_WORDS,
        [x, y, z, w] = [0, 1, 2, 3].map((c) => fromF32Bits(castChanges[at + c]))
      out.push({ centre: [x, y, z], extent: Math.abs(w), moving: w < 0 })
    }
    castChanges.fill(0, 0, CAST_HEADER_WORDS)
    return out
  }
  return { run, place, mobility, inputs, castChanges, spheres, taken }
}

/** Whether `box` holds the ball of the cube at `x`: its centre and its radius √3 · `HALF`. */
const holds = (box: { centre: number[]; extent: number }, x: number) =>
  Math.hypot(box.centre[0] - x, box.centre[1], box.centre[2]) + Math.sqrt(3) * HALF <= box.extent

test('a row derived again appends where it stood and where it lands, a held pose nothing', () => {
  const { run, place, taken } = rig()
  run.deriveRow(0)
  const arrived = taken()
  assert.equal(arrived.length, 1, 'its first derivation: an arrival, the pages it enters')
  assert.ok(holds(arrived[0], 0) && !arrived[0].moving)
  run.deriveRow(0)
  assert.deepEqual(taken(), [], 'derived again where it stands: nothing')
  place(0, 3)
  run.deriveRow(0)
  const [left, entered, ...rest] = taken()
  assert.deepEqual(rest, [])
  assert.ok(holds(left, 0) && holds(entered, 3), 'each box holds the sphere at its pose')
  assert.equal(left.moving || entered.moving, false, 'a static caster stales the static slice')
  place(0, 3 + 2 ** -20)
  run.deriveRow(0)
  const [from, to, ...more] = taken()
  assert.deepEqual(more, [])
  assert.ok(holds(from, 3) && holds(to, 3 + 2 ** -20), 'a move of a few float32 steps: its boxes')
  place(0, 3 + 2 ** -20 + 2 ** -25)
  run.deriveRow(0)
  assert.deepEqual(taken(), [], 'posed again within a float32 step, the same single world: nothing')
})

test('moving before and after stales the moving casters alone; a first move and a rest, static', () => {
  const { run, place, mobility, taken } = rig()
  run.deriveRow(0)
  taken()
  mobility[0] = MOBILITY_MOVING
  place(0, 1)
  run.deriveRow(0)
  assert.deepEqual(
    taken().map((box) => box.moving),
    [false, false],
    'its first move',
  )
  place(0, 2)
  run.deriveRow(0)
  assert.deepEqual(
    taken().map((box) => box.moving),
    [true, true],
    'a later move',
  )
  mobility[0] = 0
  run.deriveRow(0)
  const settled = taken()
  assert.equal(settled.length, 1, 'come to rest where it stands: its one box')
  assert.ok(holds(settled[0], 2) && !settled[0].moving, 'the static slice takes it')
})

test('a caster hidden stales where it stood, shown again where it stands, released where it was', () => {
  const { run, mobility, inputs, taken } = rig()
  run.deriveRow(1)
  taken()
  mobility[1] = MOBILITY_SHADOWLESS
  run.deriveRow(1)
  const hidden = taken()
  assert.equal(hidden.length, 1)
  assert.ok(holds(hidden[0], 10))
  run.deriveRow(1)
  assert.deepEqual(taken(), [], 'still hidden: nothing')
  mobility[1] = 0
  run.deriveRow(1)
  const shown = taken()
  assert.equal(shown.length, 1)
  assert.ok(holds(shown[0], 10))
  inputs[1 * ROW_INPUT_DOUBLES + INPUT_FLAGS] = [0, 0]
  run.deriveRow(1)
  const released = taken()
  assert.equal(released.length, 1)
  assert.ok(holds(released[0], 10), 'the pose it leaves')
  inputs[1 * ROW_INPUT_DOUBLES + INPUT_FLAGS] = [LOD_BIT.record, 0]
  run.deriveRow(1)
  const arrived = taken()
  assert.equal(arrived.length, 1)
  assert.ok(holds(arrived[0], 10), 'an arrival: the pose it enters, the CPU declaring none')
})

test('a change past the list sets its overflow flag, which stales every page', () => {
  const { run, place, castChanges, taken } = rig(1)
  run.deriveRow(0)
  taken()
  place(0, 5)
  run.deriveRow(0)
  assert.equal(castChanges[0], 2, 'two asked')
  assert.equal(castChanges[1], 1, 'the second past the list: the flag set')
})

// The rows the CPU names for a shadow change where they stand (`ROW_STALES`): the old code staled
// them in a kernel of their own; the rows pass now appends the sphere a row holds before deriving it.
test('a row staled where it stands appends the sphere its shadows were drawn from, then derives', () => {
  const { run, place, mobility, taken } = rig()
  run.deriveRow(0)
  taken()
  place(0, 6)
  run.deriveRow(0, true)
  const [held, left, entered, ...rest] = taken()
  assert.deepEqual(rest, [])
  assert.ok(holds(held, 0) && !held.moving, 'the sphere it held, before this derivation')
  assert.ok(holds(left, 0) && holds(entered, 6), 'then its move, as any row derived')
  run.deriveRow(0, true)
  assert.ok(holds(taken()[0], 6), 'derived: the next stale reads where it stands now')
  mobility[0] = MOBILITY_MOVING
  run.deriveRow(0, true)
  assert.equal(taken()[0].moving, false, 'static when drawn, moving now: both slices')
  run.deriveRow(0, true)
  assert.equal(taken()[0].moving, true, 'moving at both: the moving casters alone')
  mobility[0] = MOBILITY_SHADOWLESS
  run.deriveRow(0, true)
  assert.equal(taken().length, 2, 'cast when drawn: its box, staled then left')
  run.deriveRow(0, true)
  assert.deepEqual(taken(), [], 'shadowless at both: nothing')
})
