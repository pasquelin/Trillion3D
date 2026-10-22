// The view as the source of a partition: a square cell's rank by distance weighs the angle between
// the view's heading and the way to the cell — a corner exactly along the heading makes a scalar
// product of unit vectors that rounds a hair over one, which an arc cosine would turn into no
// number at all —; the shape's forced ground, extra radius and extra angle, and the shape that is
// none; the heading of a view looking straight down; the velocity the cells may be sorted along;
// and the update's gate (`streamingUpdate.ts`), which plans the wishes again only once the view
// moved or turned enough.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveWorldStreaming } from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import { createStreamingSource, SOURCE_SHAPE } from './source.ts'
import { createSourceVelocity } from './sourceVelocity.ts'
import { aimOf } from './sourceShape.ts'
import { createStreamingUpdate, type StreamingUpdate } from './streamingUpdate.ts'
import type { LoadingCell } from './loadOrder.ts'

test('a square cell straight ahead of the heading is ranked by a number, its angle zero', () => {
  const source = createStreamingSource(resolveWorldStreaming({}), {
    scheme: 'spatialHash',
    hlod: { grids: [{ flat: true }] },
  })
  // The heading (1, 6) over its length, the cell's near corner (20, 120) on it: the scalar product
  // of the two unit vectors is 1 + 4.4e-16.
  source.set([0, 0, 0], [1, 0, 6])
  const bounds = [20, 0, 120, 30, 1, 130]
  const out: LoadingCell = { key: 0, extent: 0, level: 0, priority: 0, distance: 0, raw: 0 }
  source.ranked(bounds, 0, 50, out)
  assert.ok(Number.isFinite(out.distance), `distance ${out.distance}`)
  const expected = (25 ** 2 + 125 ** 2) * (Math.PI / 180) ** (2 * 0.4)
  assert.ok(Math.abs(out.distance - expected) / expected < 1e-9, `${out.distance} vs ${expected}`)
})

test('a view forced to the ground wishes a cell of a grid that streams in 3D by its footprint', () => {
  // 200 m above the eye, on it on the ground, within a range of 100 m.
  const box = [0, 200, 0, 10, 210, 10]
  for (const [force, wished] of [
    [false, false],
    [true, true],
  ]) {
    const options = { worldStreamingForce2D: force }
    const source = createStreamingSource(resolveWorldStreaming(options), {
      scheme: 'hashSet',
      hlod: { grids: [{ flat: false }] },
    })
    source.set([0, 0, 0], [0, 0, -1])
    assert.equal(source.meets(box, 0, { range: 100, flat: false }), wished, `forced ${force}`)
  }
})

test('an extra radius lengthens the circle, an extra angle widens the sector', () => {
  const flat = { scheme: 'hashSet', hlod: { grids: [{ flat: true }] } } as const
  const grid = { range: 100, flat: true }
  const at = (options: Parameters<typeof resolveWorldStreaming>[0]) => {
    const source = createStreamingSource(resolveWorldStreaming(options), flat)
    source.set([0, 0, 0], [0, 0, -1])
    return source
  }
  // 120 m from the eye on the ground, a range of 100 m: out, then in with 30 m more.
  const far = [120, 0, 0, 130, 1, 10]
  assert.equal(at({}).meets(far, 0, grid), false)
  const longer = at({ worldStreamingExtraRadius: 30 })
  assert.equal(longer.radius(100), 130)
  assert.equal(longer.meets(far, 0, grid), true)
  // 80 degrees off the heading, beside a sector of 90: in a sector of 180, out of one of 90.
  const aside = [48, 0, -10, 52, 1, -6]
  const sector = { worldStreamingSector: true, worldStreamingSectorAngle: 90 }
  assert.equal(at(sector).meets(aside, 0, grid), false)
  assert.equal(at({ ...sector, worldStreamingExtraAngle: 90 }).meets(aside, 0, grid), true)
  // Without a sector no angle is added.
  assert.equal(at({ worldStreamingExtraAngle: 90 }).meets(aside, 0, grid), true)
})

/** The update's gate over the settings `options`, for a partition of the hash set. */
function gate(options: Parameters<typeof resolveWorldStreaming>[0] = {}) {
  const streaming = resolveWorldStreaming(options)
  return { update: createStreamingUpdate(streaming, 'hashSet'), streaming }
}

/** A scene root standing at the origin. */
const ROOT = Array.from({ length: 16 }, (_, at) => (at % 5 === 0 ? 1 : 0))

/** One frame of `update` at `eye` looking along `axis`: whether the update ran; the frame left work
 *  when `busy`. */
function step(
  update: StreamingUpdate,
  eye: number[],
  axis = [0, 0, -1],
  {
    blocked = false,
    busy = false,
    frames = new Map<number, unknown>(),
    world = ROOT,
    aim = axis,
  } = {},
) {
  const again = update.due(eye, axis, aim, world, blocked, frames)
  update.end(busy)
  return again
}

const turned = (degrees: number) => [
  Math.sin(degrees * (Math.PI / 180)),
  0,
  -Math.cos(degrees * (Math.PI / 180)),
]

/** The two frames that open a gate: the first runs whatever the key, the next is the first
 *  update after a frame with no key kept; both run. */
function opened(update: StreamingUpdate, eye: number[], axis?: number[]) {
  assert.equal(step(update, eye, axis), true, 'the first frame')
  assert.equal(step(update, eye, axis), true, 'the first update after a frame with no key kept')
}

test('a view moving or turning within one step keeps its update, one past it runs it', () => {
  const { update } = gate()
  opened(update, [100, 2, 100])
  // The squares are 4 m wide (25 · 4 = 100) and the yaw steps 10° wide.
  assert.equal(step(update, [102, 2, 103]), false, 'within the square')
  assert.equal(step(update, [102, 3.5, 103], turned(6)), false, 'turned within the step')
  assert.equal(step(update, [104, 2, 103], turned(6)), true, 'past the square on x')
  assert.equal(step(update, [104, 2, 103], turned(6)), false)
  assert.equal(step(update, [104, 2, 103], turned(12)), true, 'past the step')
  assert.equal(step(update, [104, 2, 103], turned(12)), false)
  assert.equal(step(update, [104, 6, 103], turned(12)), true, 'past the square in height')
  // Within a quantum of the origin the view reads as none: one key there.
  assert.equal(step(update, [1, 0, 1]), true)
  assert.equal(step(update, [-2, 0, 3]), false)
})

test('the exact view runs the update whenever it moves: no quantization', () => {
  const { update } = gate({
    worldStreamingLocationQuantization: 0,
    worldStreamingRotationQuantization: 0,
  })
  for (let frame = 0; frame < 3; frame++)
    assert.equal(step(update, [100, 2, 100]), true, 'both at 0, no frame is skipped')
  const { update: by } = gate({ worldStreamingUpdateOptimization: false })
  for (let frame = 0; frame < 3; frame++)
    assert.equal(step(by, [100, 2, 100]), true, 'the optimisation off')
  const { update: partial } = gate({ worldStreamingLocationQuantization: 0 })
  opened(partial, [100, 2, 100])
  assert.equal(step(partial, [100.001, 2, 100]), true, 'a step of 0 reads the exact position')
  assert.equal(step(partial, [100.001, 2, 100], turned(1)), false, 'the other step still reads')
})

test('a frame that left work, a blocking load, or a shaping setting runs the update', () => {
  const { update, streaming } = gate()
  const at = [100, 2, 100]
  opened(update, at)
  assert.equal(step(update, at), false)
  assert.equal(step(update, at, undefined, { busy: true }), false)
  assert.equal(step(update, at), true, 'the frame before left work')
  assert.equal(step(update, at), true, 'the first update after it')
  assert.equal(step(update, at), false, 'back to a key kept')
  assert.equal(step(update, at, undefined, { blocked: true }), true, 'a load blocks')
  assert.equal(step(update, at), true, 'the first update after an unoptimised frame')
  assert.equal(step(update, at), false)
  streaming.targetState = 'loaded'
  assert.equal(step(update, at), true, 'the target state moved')
  update.reset()
  assert.equal(step(update, at), true, 'the wishes were lost')
})

test('every setting the source reads to shape the view runs the update when it moves', () => {
  for (const field of SOURCE_SHAPE) {
    const { update, streaming } = gate()
    const at = [100, 2, 100]
    opened(update, at)
    assert.equal(step(update, at), false, field)
    const was = streaming[field]
    ;(streaming as Record<string, unknown>)[field] = typeof was === 'boolean' ? !was : was + 1
    assert.equal(step(update, at), true, `${field} moved`)
  }
  for (const field of ['blockOnSlowStreaming', 'hlod', 'useVelocity'] as const) {
    const { update, streaming } = gate()
    opened(update, [100, 2, 100])
    streaming[field] = !streaming[field]
    assert.equal(step(update, [100, 2, 100]), true, `${field} moved`)
  }
  const { update, streaming } = gate()
  opened(update, [100, 2, 100])
  streaming.priority = 64
  assert.equal(step(update, [100, 2, 100]), true, 'the priority moved')
})

test('a view looking straight down keys on the way it heads on the ground', () => {
  const { update } = gate()
  const heading = (x: number, z: number) =>
    step(update, [100, 2, 100], [0, -1, 0], { aim: [x, 0, z] })
  // Opened, standing twice, then turned a quarter turn in place.
  const ran = [heading(0, -1), heading(0, -1), heading(0, -1), heading(0, -1), heading(1, 0)]
  assert.deepEqual(ran, [true, true, false, false, true])
})

test('a frame forced every few frames runs the update, and the next one with it', () => {
  const { update } = gate({ worldStreamingForceUpdateFrameCount: 4 })
  const ran = Array.from({ length: 9 }, () => step(update, [100, 2, 100]))
  assert.deepEqual(ran, [true, true, false, true, true, false, false, true, true])
})

test('a core parent or the scene root that moved runs the update, the view standing', () => {
  const { update } = gate()
  const at = [100, 2, 100]
  const frames = new Map<number, unknown>([[0, [1, 1]]])
  step(update, at, undefined, { frames })
  step(update, at, undefined, { frames })
  assert.equal(step(update, at, undefined, { frames }), false)
  frames.set(0, [1, 1])
  assert.equal(step(update, at, undefined, { frames }), true, 'its frame made anew')
  // A parent no longer listed is forgotten, and that is a move; one listed again is new.
  frames.delete(0)
  assert.equal(step(update, at, undefined, { frames }), true, 'a parent left')
  frames.set(0, [1, 1])
  assert.equal(step(update, at, undefined, { frames }), true, 'a parent came back')
  const moved = [...ROOT.slice(0, 12), 5, 0, 0, 1]
  assert.equal(step(update, at, undefined, { frames, world: moved }), true, 'the root moved')
  assert.equal(step(update, at, undefined, { frames, world: moved }), false)
})

test('a shape whose radius or angle is nearly zero is none: it meets nothing, a cell ranks last', () => {
  const flat = { scheme: 'hashSet', hlod: { grids: [{ flat: true }] } } as const
  const grid = { range: 100, flat: true }
  const at = (options: Parameters<typeof resolveWorldStreaming>[0]) => {
    const source = createStreamingSource(resolveWorldStreaming(options), flat)
    source.set([0, 0, 0], [0, 0, -1])
    return source
  }
  // The eye inside the box: a radius of 0 would meet it, a sector of 0° straddles it.
  const around = [-5, -1, -5, 5, 1, 5]
  assert.equal(at({}).meets(around, 0, grid), true)
  assert.equal(at({ worldStreamingRangeScale: 0 }).meets(around, 0, grid), false, 'no radius')
  const fixed = { worldStreamingRadius: 0, worldStreamingUseGridRange: false }
  assert.equal(at(fixed).meets(around, 0, grid), false, 'no fixed radius')
  const none = { worldStreamingSector: true, worldStreamingSectorAngle: 0 }
  assert.equal(at(none).meets(around, 0, grid), false, 'no angle')
  // Behind the view, 50 m off: at radius 0 the ratio is the largest, 1, not 0.
  const behind = [-5, -1, 50, 5, 1, 60]
  const out: LoadingCell = { key: 0, extent: 0, level: 0, priority: 0, distance: 0, raw: 0 }
  at({ worldStreamingRangeScale: 0 }).ranked(behind, 0, 100, out)
  assert.equal(out.distance, 1)
})

test('a view looking straight down heads where its up vector points, up it heads the other way', () => {
  const out = [0, 0, 0]
  const up = [0, 0, -1]
  const aim = (axis: number[]) => Array.from(aimOf(axis, up, out), (value) => value + 0)
  assert.deepEqual(aim([0, -1, 0]), [0, 0, -1], 'down: ahead')
  assert.deepEqual(aim([0, 1, 0]), [0, 0, 1], 'up: behind')
  assert.deepEqual(aimOf([0.6, -0.8, 0], up, out), [0.6, -0.8, 0], 'any other heads along its axis')
  // A square grid sorts by the angle to the heading: the cell ahead of a down-looking view loads
  // before the one behind it, as they do when it looks a hair off the vertical.
  const rank = (bounds: number[], aim?: number[]) => {
    const source = createStreamingSource(resolveWorldStreaming({}), {
      scheme: 'spatialHash',
      hlod: { grids: [{ flat: true }] },
    })
    source.set([0, 0, 0], [0, -1, 0], aim)
    const cell: LoadingCell = { key: 0, extent: 0, level: 0, priority: 0, distance: 0, raw: 0 }
    return source.ranked(bounds, 0, 100, cell).distance
  }
  const ahead = [-5, 0, -60, 5, 1, -50],
    behind = [-5, 0, 50, 5, 1, 60]
  assert.equal(rank(ahead), rank(behind), 'no heading: the same rank')
  assert.ok(rank(ahead, [0, 0, -1]) < rank(behind, [0, 0, -1]), 'a heading: ahead first')
})

test("the velocity is the weighted average of the view's steps, none after a jump or an idle", () => {
  const velocity = createSourceVelocity()
  assert.deepEqual([...velocity.update([0, 0, 0], 10)], [0, 0, 0], 'a view seen the first time')
  // 1.6 m in 16 ms: the weight of a step of 10 ms or more is 1, the whole of it.
  const [vx] = velocity.update([1.6, 0, 0], 10.016)
  assert.ok(Math.abs(vx - 100) < 1e-9, `${vx}`)
  // 5 ms later and the same speed: half of the new step, half of the running one.
  const half = velocity.update([2.1, 0, 0], 10.021)[0]
  assert.ok(Math.abs(half - 100) < 1e-9, `${half}`)
  const slower = velocity.update([2.2, 0, 0], 10.026)[0]
  assert.ok(Math.abs(slower - 60) < 1e-9, `${slower} = 100 · 0.5 + 20 · 0.5`)
  assert.deepEqual([...velocity.update([500, 0, 0], 10.04)], [0, 0, 0], 'a jump of over 100 m')
  velocity.update([501, 0, 0], 10.056)
  assert.deepEqual([...velocity.update([502, 0, 0], 16)], [0, 0, 0], 'idle for over 5 s')
  assert.deepEqual([...velocity.update([503, 0, 0], 16)], [0, 0, 0], 'a clock that stood')
})

test("the cells are sorted along the view's velocity when the settings ask", () => {
  const rank = (options: Parameters<typeof resolveWorldStreaming>[0], velocity: number[]) => {
    const source = createStreamingSource(resolveWorldStreaming(options), {
      scheme: 'hashSet',
      hlod: { grids: [{ flat: true }] },
    })
    // Looking along -z, moving at 1 m/s along +x.
    source.set([0, 0, 0], [0, 0, -1], undefined, velocity)
    const cell: LoadingCell = { key: 0, extent: 0, level: 0, priority: 0, distance: 0, raw: 0 }
    const ranked = (x: number) => source.ranked([x, 0, -5, x + 5, 1, 5], 0, 100, cell).distance
    return [ranked(50), ranked(-55)]
  }
  const [right, left] = rank({ worldStreamingUseVelocity: true }, [1, 0, 0])
  assert.ok(right < left, `${right} < ${left}: ahead of where it goes first`)
  const [still, other] = rank({}, [1, 0, 0])
  assert.equal(still, other, 'the velocity counts for nothing unless asked')
})
