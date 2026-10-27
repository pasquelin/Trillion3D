// The cast of an orthographic view's line of sight (`vsmViewOrigin.ts`): asked of a view that casts,
// its answer the offset of the next plan, the frame replayed when an answer moves it.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { EngineCamera } from '../../../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import type { WebgpuView } from '../../../../frame/backend/state/view.ts'
import type { ViewOriginCast } from '../../../../physics/viewOriginCast.ts'
import type { ShadowValues } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import type { Object3D } from '../../../../../../sdk-core/src/world/object/object3d.ts'
import { NO_INDEX } from '../../../../../../math/src/constants.ts'
import type { VsmFrameLight } from '../frameSetup.ts'
import { setViewOriginCast, viewOriginTarget } from './vsmViewOrigin.ts'

type OnHit = (hit: Uint32Array) => void

/** The words of a hit a quarter of the way along the ray, and of one that met nothing. */
const quarter = (() => {
  const words = new Uint32Array(8)
  words[0] = 1
  new Float32Array(words.buffer)[1] = 0.25
  return words
})()
const MISS = Uint32Array.of(NO_INDEX)

/** A view as the runtime holds one, with the held frame it replays. */
const viewOf = (id: string) =>
  ({ id, hold: { view: 1 }, run: { lastCamera: undefined } }) as unknown as WebgpuView & {
    hold: { view: number }
    run: { lastCamera: { drawnFrom?: Object3D } | undefined }
  }

/** A runtime with one view, a cast that remembers what it was asked, and the replays of the view. */
function world() {
  const view = viewOf('')
  const asked: { ignore: Object3D | undefined; onHit: OnHit }[] = []
  const state = { replays: 0, revision: 0, epoch: 0, flush: 0 }
  const cast: ViewOriginCast = {
    revision: () => state.revision,
    epoch: () => state.epoch,
    // A post flushes the frame's commands first, which moves the world's revision by `flush`.
    post(_origin, _direction, _reach, ignore, onHit) {
      state.revision += state.flush
      asked.push({ ignore, onHit })
    },
  }
  // The camera the view is drawn from, apart from the runtime the planner reads it through.
  const run = {
    gate: { viewReplaced: () => state.replays++ },
    lastCamera: undefined as { drawnFrom?: Object3D } | undefined,
  }
  const rt = {
    views: { main: view, active: view, persistent: [] as WebgpuView[] },
    viewOriginCast: cast,
    run,
  } as unknown as WebgpuPagesRuntime
  return { rt, run, cast, view, asked, state }
}

const shadows = {
  shadowOrthoProjectViewOrigin: true,
  shadowOrthoRayCastViewOrigin: true,
} as ShadowValues
/** A frame light of `kind` that casts a shadow, or not. */
const lightOf = (kind: string, castsShadow = true) =>
  [{ light: { kind, castsShadow }, visible: true }] as VsmFrameLight[]
const sun = lightOf('directional')
/** An orthographic camera 50 m up the z axis, looking down it, 100 m deep. */
const camera = (more: object = {}) =>
  ({
    perspective: 0,
    near: 0,
    far: 100,
    eye: [0, 0, 50],
    world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 50, 1],
    viewTarget: [0, 0, 0],
    ...more,
  }) as unknown as EngineCamera
/** The frame's offset, a negative zero read as the zero it is. */
const plan = (w: ReturnType<typeof world>, cam = camera(), list = sun, values = shadows) =>
  Array.from(viewOriginTarget(w.rt, cam, list, values), (value) => value + 0)

test('a view that casts asks once, and plans from its last answer: the view forward by the distance', () => {
  const w = world()
  assert.deepEqual(plan(w), [0, 0, 0], 'no answer yet: the eye')
  plan(w)
  assert.equal(w.asked.length, 1, 'one cast on its way')
  w.asked[0].onHit(quarter)
  assert.equal(w.state.replays, 1, 'the answer moves the origin: the frame replays')
  assert.deepEqual(plan(w), [0, 0, -25])
  assert.equal(w.asked.length, 1, 'the same ray, the same world: no cast')
})

test('it asks again when the ray changes or the physics world does, a miss standing as a hit', () => {
  const w = world()
  plan(w)
  w.asked[0].onHit(quarter)
  plan(w, camera({ eye: [1, 0, 50] }))
  assert.equal(w.asked.length, 2, 'the ray moved')
  w.asked[1].onHit(MISS)
  const moved = camera({ eye: [1, 0, 50] })
  assert.deepEqual(plan(w, moved), [0, 0, 0], 'met nothing: the eye')
  plan(w, moved)
  assert.equal(w.asked.length, 2, 'a miss stands while the world and the ray stand')
  w.state.revision++
  plan(w, moved)
  assert.equal(w.asked.length, 3, 'the world moved: asked again, a miss or a hit')
  w.asked[2].onHit(quarter)
  w.state.revision++
  plan(w, moved)
  assert.equal(w.asked.length, 4)
})

test('an answer that comes after the view stopped casting is dropped', () => {
  const w = world()
  plan(w)
  assert.deepEqual(plan(w, camera({ viewTarget: [0, 0, -10] })), [0, 0, -10], 'its own target')
  w.asked[0].onHit(quarter)
  assert.equal(w.state.replays, 0)
  plan(w)
  assert.equal(w.asked.length, 2, 'asked again once it casts again')
  assert.deepEqual(plan(w), [0, 0, 0])
})

test('no sun that casts, a perspective camera or a setting off asks nothing, and the origin stays the eye', () => {
  const w = world()
  plan(w, camera(), [])
  plan(w, camera(), lightOf('directional', false))
  plan(w, camera(), lightOf('point'))
  assert.deepEqual(plan(w, camera({ perspective: 1, viewTarget: [0, 0, -9] })), [0, 0, 0])
  plan(w, camera(), sun, { ...shadows, shadowOrthoRayCastViewOrigin: false })
  assert.deepEqual(
    plan(w, camera({ viewTarget: [0, 0, -9] }), sun, {
      ...shadows,
      shadowOrthoProjectViewOrigin: false,
    }),
    [0, 0, 0],
    'projection off: no origin moved',
  )
  assert.equal(w.asked.length, 0)
})

test('a cast that comes or goes replays the views that cast, once, and no other', () => {
  const w = world()
  const { cast } = w
  setViewOriginCast(w.rt, null)
  setViewOriginCast(w.rt, cast)
  assert.equal(w.state.replays, 0, 'no view holds a slot: nothing to replay')
  plan(w)
  setViewOriginCast(w.rt, cast)
  assert.equal(w.state.replays, 0, 'the same cast again')
  setViewOriginCast(w.rt, null)
  assert.equal(w.state.replays, 1)
  setViewOriginCast(w.rt, cast)
  assert.equal(w.state.replays, 2)
  // Past the target, the view casts no more: a cast coming or going changes nothing it plans from.
  plan(w, camera({ viewTarget: [0, 0, -10] }))
  setViewOriginCast(w.rt, null)
  assert.equal(w.state.replays, 2)
})

test('a cast on its way when the physics stops is forgotten: the view casts again with the next', () => {
  const w = world()
  plan(w)
  assert.equal(w.asked.length, 1)
  // The session that would answer is gone and its answer never comes.
  setViewOriginCast(w.rt, null)
  setViewOriginCast(w.rt, w.cast)
  plan(w)
  assert.equal(w.asked.length, 2, 'not held back by the cast that never answered')
})

test('the answer for a view drawn aside breaks its own held frame, not the drawn view’s', () => {
  const w = world()
  const aside = viewOf('view1')
  const views = w.rt.views as { active: WebgpuView }
  w.rt.views.persistent.push(aside)
  views.active = aside
  plan(w)
  assert.equal(w.asked.length, 1, 'a persistent view casts for itself')
  views.active = w.view
  w.asked[0].onHit(quarter)
  assert.equal(w.state.replays, 0, 'the gate holds the drawn view’s revision')
  assert.equal(aside.hold.view, 2, 'the view aside keeps its own')
})

test('the cast passes through the body of the page camera the view casting is drawn from', () => {
  const w = world()
  const body = {} as Object3D
  w.run.lastCamera = { drawnFrom: body }
  plan(w)
  assert.equal(w.asked[0].ignore, body)
})

test('a capture drawn aside casts for itself: its own ray, body and slot, and its own held frame', () => {
  const w = world()
  plan(w)
  const body = {} as Object3D
  const capture = viewOf('')
  const views = w.rt.views as { active: WebgpuView }
  views.active = capture
  w.run.lastCamera = { drawnFrom: body }
  plan(w, camera({ eye: [5, 0, 50] }))
  assert.equal(w.asked.length, 2, 'the capture’s ray is its own, not the main view’s')
  assert.equal(w.asked[1].ignore, body, 'through the body of the camera it is drawn from')
  // The capture ends; its answer moves its own offset and breaks its own hold, the main view's stands.
  views.active = w.view
  w.run.lastCamera = undefined
  w.asked[1].onHit(quarter)
  assert.equal(w.state.replays, 0, 'the drawn view’s gate is not asked to replay')
  assert.equal(capture.hold.view, 2, 'the capture’s hold is broken')
  assert.deepEqual(plan(w), [0, 0, 0], 'the main view’s offset is not the capture’s')
  w.asked[0].onHit(quarter)
  assert.deepEqual(plan(w), [0, 0, -25])
})

test('an answer to a cast given up is dropped even when the view casts again before it comes', () => {
  const w = world()
  plan(w)
  plan(w, camera({ viewTarget: [0, 0, -10] }))
  assert.equal(plan(w).join(), '0,0,0')
  assert.equal(w.asked.length, 1, 'the first cast is still on its way: one at a time')
  w.asked[0].onHit(quarter)
  assert.deepEqual(plan(w, camera(), sun), [0, 0, 0], 'the answer of the old ray moves nothing')
  assert.equal(w.state.replays, 1, 'the frame plans again, and asks for its own ray')
  assert.equal(w.asked.length, 2)
  w.asked[1].onHit(quarter)
  assert.deepEqual(plan(w), [0, 0, -25])
})

test('the revision a cast is posted at is the one after its post flushed the frame’s commands', () => {
  const w = world()
  w.state.flush = 1
  plan(w)
  w.asked[0].onHit(MISS)
  plan(w)
  assert.equal(w.asked.length, 1, 'the flush of its own post is no change of the world')
  w.state.revision++
  plan(w)
  assert.equal(w.asked.length, 2, 'a change after it is')
})

test('it asks again when the body the view is drawn from changes', () => {
  const w = world()
  const first = {} as Object3D
  w.run.lastCamera = { drawnFrom: first }
  plan(w)
  w.asked[0].onHit(quarter)
  plan(w)
  assert.equal(w.asked.length, 1)
  w.run.lastCamera = { drawnFrom: {} as Object3D }
  plan(w)
  assert.equal(w.asked.length, 2, 'another body to pass through: another cast')
})

test('a cast on its way when the session that was asked ended is forgotten, though no frame saw the physics off', () => {
  const w = world()
  plan(w)
  assert.equal(w.asked.length, 1)
  plan(w)
  assert.equal(w.asked.length, 1, 'the session stands: one at a time')
  // Another session began between two frames (the same cast object): the first never answers.
  w.state.epoch++
  plan(w)
  assert.equal(w.asked.length, 2, 'not held back by the cast that never answers')
})

test('a cast given up in a session that ended does not hold the view back when it casts again', () => {
  const w = world()
  plan(w)
  plan(w, camera({ viewTarget: [0, 0, -10] }))
  w.state.epoch++
  plan(w)
  assert.equal(w.asked.length, 2, 'asks for its own ray')
  w.asked[1].onHit(quarter)
  assert.deepEqual(plan(w), [0, 0, -25])
})
