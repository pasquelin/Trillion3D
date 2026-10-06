import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BODY_INDEX,
  CommandWriter,
  FLAG,
  PHYSICS_STEP,
  POSE_WORDS,
} from '../../../sdk-core/src/physics/index.ts'
import { startModule } from './module.fixture.ts'
import { createPhysicsPoses } from './poses.ts'
import { along, createStepClock } from './stepClock.ts'
import { startedWorker } from './worker.fixture.ts'
import { resultWords } from './protocol.ts'
import { body } from './records.fixture.ts'
import { records, seated } from './seatedPoses.fixture.ts'

const BODIES = 3
/** Step `n`'s state: three crates falling from rest, turning as they go. */
const stateAt = (n: number) => {
  const t = n * PHYSICS_STEP
  return records(BODIES, 10 - 4.905 * t * t, -9.81 * t)
}
/** The results of the steps after `a` up to `b`: their last state, and the one before it when the
 *  tick took both, as the worker's results hold them (`tickResults.ts`). */
function tick(a: number, b: number) {
  const words = new Uint32Array(2 * BODIES * POSE_WORDS)
  words.set(stateAt(b))
  if (b - a > 1) words.set(stateAt(b - 1), BODIES * POSE_WORDS)
  else
    for (let at = 0; at < BODIES * POSE_WORDS; at += POSE_WORDS)
      words[BODIES * POSE_WORDS + at] = ~words[at]
  return words
}

/** The frames of `deltas` (seconds) drawn while the worker delivers every `every` frames: each
 *  frame's drawn height of the first crate, `null` where the worker had not delivered the state
 *  its time needs; and whether each frame asked for the next. */
function frames(deltas: number[], every: number) {
  const { scene, meshes, bodies } = seated(BODIES)
  const poses = createPhysicsPoses(BODIES, scene)
  const clock = createStepClock(PHYSICS_STEP)
  poses.receive(stateAt(0), BODIES, bodies, 0)
  const drawn: (number | null)[] = [],
    asked: boolean[] = []
  let delivered = 0
  deltas.forEach((seconds, frame) => {
    clock.frame(seconds)
    asked.push(poses.apply(bodies, along(clock.drawn, delivered, PHYSICS_STEP, true), true))
    const y = meshes[0].position.y
    assert.ok(Number.isFinite(y), `frame ${frame} finite`)
    drawn.push(clock.drawn.step + 1 <= delivered ? y : null)
    // The worker steps the frame's time after it is drawn: its results come before a later frame.
    if ((frame + 1) % every || clock.steps === delivered) return
    poses.receive(tick(delivered, clock.steps), BODIES, bodies, clock.steps - delivered)
    delivered = clock.steps
  })
  return { drawn, asked }
}

test('the same frames draw the same poses on the simulated trajectory, whenever the worker delivers', () => {
  // 120 Hz, then 30 Hz (two steps a frame), then a frame dropped: ticks of one, two, three steps.
  const deltas = [
    ...Array.from({ length: 30 }, () => 1 / 120),
    ...Array.from({ length: 12 }, () => 1 / 30),
    3 / 60,
    ...Array.from({ length: 12 }, () => 1 / 60),
  ]
  const onTime = frames(deltas, 1)
  const clock = createStepClock(PHYSICS_STEP)
  onTime.drawn.forEach((y, frame) => {
    clock.frame(deltas[frame])
    if (frame < 2) return
    // On time, every frame is drawn between the two states of the steps that bracket its time.
    assert.notEqual(y, null, `frame ${frame} delivered`)
    const n = clock.drawn.step,
      alpha = clock.drawn.owed / PHYSICS_STEP
    const [a, b] = [stateAt(n), stateAt(n + 1)].map((w) => new Float32Array(w.buffer)[2])
    assert.equal(
      y,
      a + (b - a) * alpha,
      `frame ${frame}: on the line between steps ${n} and ${n + 1}`,
    )
  })
  // Late by two frames in three: each frame it caught up draws the very same pose, to the bit.
  const late = frames(deltas, 3)
  let compared = 0
  late.drawn.forEach((y, frame) => {
    if (y === null) return
    assert.equal(y, onTime.drawn[frame], `frame ${frame}`)
    compared++
  })
  assert.ok(compared >= deltas.length / 3 - 1, `${compared} frames caught up`)
  assert.ok(
    late.asked.every(Boolean),
    'while it waits for the worker, each frame asks for the next',
  )
})

test('a tick of no step leaves a moving body between its two steps, unless it moved it in place', () => {
  const { scene, meshes, bodies } = seated(BODIES)
  const poses = createPhysicsPoses(BODIES, scene)
  poses.receive(stateAt(0), BODIES, bodies, 0)
  poses.receive(tick(0, 1), BODIES, bodies, 1)
  poses.receive(tick(1, 2), BODIES, bodies, 1)
  const [a, b] = [stateAt(1), stateAt(2)].map((w) => new Float32Array(w.buffer)[2])
  // A query's run of no step sends the same poses again: drawn on as before.
  poses.receive(tick(2, 2), BODIES, bodies, 0)
  poses.apply(bodies, 0.5, true)
  assert.equal(meshes[0].position.y, a + (b - a) * 0.5)
  // One that put the body somewhere: drawn there at once.
  const moved = tick(2, 2)
  new Float32Array(moved.buffer)[2] = 7
  poses.receive(moved, BODIES, bodies, 0)
  poses.apply(bodies, 0.5, true)
  assert.equal(meshes[0].position.y, 7)
})

test('a worker held for room takes every step asked, in order, at its own pace', async () => {
  // The worker's clock: a step reads it before and after, and each step is 25 ms long.
  let now = 0,
    reads = 0
  const clock = () => {
    const read = now
    if (reads++ % 2 === 1) now += 25
    return read
  }
  // One contact event a step fills a tick's results in four: then the steps wait for a buffer.
  const { sent, receive, budget } = await startedWorker(clock, { contactEvents: 1 })
  const writer = new CommandWriter()
  writer.gravity([0, -9.81, 0])
  writer.add(body(0, 0, -50, 50))
  // Crates landing on the floor one after the other, each an enter event.
  for (let i = 1; i < 8; i++) writer.add(body(i, 2, 0.7 + 0.35 * i, 0.1, FLAG.events))
  const scene = writer.take()
  writer.gravity([0, -3, 0])
  const lighter = writer.take()
  const results = () => sent.filter((m) => m.type === 'results')
  // Two frames of a step each fill both buffers, which the page keeps; then frames of 4 steps.
  receive({ type: 'commands', words: scene.slice() })
  receive({ type: 'advance', to: 1, steps: 1 })
  receive({ type: 'advance', to: 2, steps: 1 })
  for (let to = 6; to <= 90; to += 4) {
    if (to === 34) receive({ type: 'commands', words: lighter.slice() })
    receive({ type: 'advance', to, steps: 4 })
  }
  assert.equal(results().length, 2, 'the page holds both buffers: the rest waits')
  const bound = resultWords(budget) * 4
  receive({ type: 'buffer', buffer: new ArrayBuffer(bound) })
  assert.ok(results()[2].steps < 88, `held for room: ${results()[2].steps} steps, not 88`)
  while (results().reduce((n, m) => n + m.steps, 0) < 90)
    receive({ type: 'buffer', buffer: new ArrayBuffer(bound) })
  assert.equal(results().at(-1)!.step, 90)
  // The same steps straight on the module, the lighter gravity at the first step of its frame.
  const jolt = await startModule({ bodies: 8, contactEvents: 1 })
  const last = new Map<number, string>(),
    expected = new Map<number, string>()
  for (const m of results())
    for (let r = 0; r < m.poses; r++) {
      const record = new Uint32Array(m.buffer, r * POSE_WORDS * 4, POSE_WORDS)
      last.set(record[0] & BODY_INDEX, record.join())
    }
  for (let step = 1; step <= 90; step++) {
    const count = jolt.step(step === 1 ? scene : step === 31 ? lighter : null, PHYSICS_STEP)
    const words = jolt.poses(count)
    for (let r = 0; r < count; r++) {
      const record = words.subarray(r * POSE_WORDS, (r + 1) * POSE_WORDS)
      expected.set(record[0] & BODY_INDEX, record.join())
    }
  }
  assert.ok(now > 90 * PHYSICS_STEP * 1000, 'the worker ran slower than the frames')
  assert.deepEqual(last, expected, 'every body where the same steps leave it, to the bit')
})
