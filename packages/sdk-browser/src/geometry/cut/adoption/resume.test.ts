// An image waiting for its root cover must be able to resume on its own. The pending image draws
// nothing, but it requests the missing pages, publishes residency and dispatches selection: without
// that dispatch, the same readback would come back every image and the cut would stay stuck on it,
// camera still, even once the bytes have arrived.
//
// The resume readback is not supplied by the test: it is produced by the mocked selection, from
// the residency flags the pending image published to it. The bench itself (`banc()`) lives in
// `resume.fixture.ts`, to stay under 200 lines.
import test from 'node:test'
import assert from 'node:assert/strict'
import { banc } from './resume.fixture.ts'
import {
  CULL_CLIP_PLANE_OFF,
  CULL_DRAW_DISTANCE_OFF,
  CULL_SPHERE_EDGE_OFF,
} from '../../dag/shader/viewsWgsl.ts'
import { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import {
  NO_CLIP_PLANE,
  type ClipPlaneValues,
} from '../../../../../sdk-core/src/contracts/viewOptions.ts'
import type { ViewSet } from '../../../../../sdk-core/src/world/camera/viewSet.ts'
import { renderGpuCut } from '../../../frame/render/gpuCut.ts'
import { createScaleControl } from '../../../frame/scale/scaleControl.ts'

/** A view's set as the camera makes it (`Camera.write`): the temporal jitter is off where a plane clips. */
const viewSetOf = (
  clipPlane: ClipPlaneValues,
  hidden: readonly Object3D[] = [],
  showOnly: readonly Object3D[] | null = null,
): ViewSet => Object.freeze({ clipPlane, hidden, showOnly, owner: null })

test('a pending image requests, syncs and dispatches: resume has what it needs to happen', () => {
  const b = banc()
  for (let i = 0; i < 3; i++) b.image()
  assert.equal(b.comptes.attentes, 3, 'the three images waited for the root cover')
  // No pending image merely re-reads: each has advanced the stream.
  assert.equal(b.comptes.queue, 3, 'wanted pages are requested at every wait')
  assert.equal(b.comptes.sync, 3, 'residency is synced at every wait')
  assert.equal(b.comptes.envois, 3, 'selection is dispatched at every wait')
  // The wanted list is published: it is what brings the missing page in.
  assert.deepEqual(
    b.desired.map((p) => p.url),
    ['p0'],
  )
  assert.deepEqual(b.shown, [], 'nothing is drawn before the root cover')
})

test('once a page has arrived, the next readback draws it without the camera moving', () => {
  const b = banc()
  b.image()
  // The bytes arrive. The camera has not moved and the budget has not changed.
  b.arrive()
  const envoisAvant = b.comptes.envois
  // The image stays pending: the readback is not there yet.
  b.image()
  assert.ok(b.comptes.envois > envoisAvant, 'but it has published residency and dispatched')
  // The next image starts by adopting: it finds the readback that dispatch produced. The test
  // supplied none.
  b.rt.services.adoptGpuCut()
  assert.deepEqual(
    b.shown.map((p) => p.url),
    ['p0'],
    'and the page is drawn',
  )
})

// #1483: a send that fails is said and the image skipped; only `device.lost` declares a loss.
test('a wait whose dispatch fails is said once and skips the image, the device kept', () => {
  const b = banc('envoi')
  b.image()
  assert.equal(b.codes.filter((code) => code === 'gpu-selection-dispatch-failed').length, 1)
  assert.ok(!b.codes.includes('gpu-device-lost'), 'no loss announced')
  assert.equal(b.rt.run.lost, false, 'the session stays on its device')
  assert.deepEqual(b.shown, [], 'nothing is drawn before the root cover')
})

test('each image writes the scales of the draw distances into the cut, the instances’ cull following its switch', () => {
  const b = banc()
  b.image()
  Object.assign(b.rt.context, { cutViewDistanceScale: 0.5 })
  b.image()
  const { selectionUniforms: view } = b.rt.run
  assert.equal(view.viewDistanceScale, 0.5, 'and the cut itself')
  assert.equal(view.primitiveDistanceScale, 0.5, 'for an object of its own as well')
  assert.equal((view.cullOff ?? 0) & CULL_DRAW_DISTANCE_OFF, 0)
  assert.equal((view.cullOff ?? 0) & CULL_SPHERE_EDGE_OFF, 0, 'the sphere’s edge by default')
  Object.assign(b.rt.context, { cutDistanceCullToSphereEdge: false })
  b.image()
  assert.equal((view.cullOff ?? 0) & CULL_SPHERE_EDGE_OFF, CULL_SPHERE_EDGE_OFF, 'and the cut')
  Object.assign(b.rt.context, { cutDrawDistanceCulling: false })
  b.image()
  assert.equal((view.cullOff ?? 0) & CULL_DRAW_DISTANCE_OFF, CULL_DRAW_DISTANCE_OFF)
  assert.equal(view.primitiveDistanceScale, 0.5)
})

test('the scale of the draw distances is times the secondary scale only where the host turned that on', () => {
  const b = banc(),
    { selectionUniforms: view } = b.rt.run
  Object.assign(b.rt.context, { cutViewDistanceScale: 0.5, cutViewDistanceSecondaryScale: 0.5 })
  b.image()
  assert.equal(view.viewDistanceScale, 0.5, 'off by default: the secondary scale is not read')
  Object.assign(b.rt.context, { cutViewDistanceApplySecondaryScale: true })
  b.image()
  assert.equal(view.viewDistanceScale, 0.25, 'on: the two scales multiply')
})

test('an object of its own takes the scale of the view’s horizontal field of view beside the view distance scale, an instance does not', () => {
  const b = banc(),
    { selectionUniforms: view } = b.rt.run
  // A vertical field of 55 degrees at an aspect of 2: the horizontal field is 2·atan(2·tan(27.5°)).
  b.camera.aspect = 2
  const horizontal = 2 * Math.atan(2 * Math.tan((27.5 * Math.PI) / 180)) * (180 / Math.PI)
  Object.assign(b.rt.context, {
    cutViewDistanceScale: 0.5,
    cutViewDistanceFovMinAngle: 0,
    cutViewDistanceFovMinAngleScale: 1,
    cutViewDistanceFovMaxAngle: 180,
    cutViewDistanceFovMaxAngleScale: 0.25,
  })
  b.image()
  const blend = 1 - 0.75 * (horizontal / 180)
  assert.ok(
    Math.abs((view.primitiveDistanceScale ?? 1) - 0.5 * blend) < 1e-6,
    'the blend at that angle',
  )
  assert.equal(view.viewDistanceScale, 0.5, 'an instance’s scale has no field of view')
  // An orthographic view counts as a field of 0 degrees, the minimum angle’s scale.
  b.camera.perspective = 0
  b.image()
  assert.equal(view.primitiveDistanceScale, 0.5)
})

test('a view’s clip plane reaches its cut in the render frame where the project switch is on, its cull on unless turned off', () => {
  const b = banc(),
    { selectionUniforms: view } = b.rt.run
  // The camera stands at z = 5; the world plane z = 2 keeps what lies above it.
  const plane = [0, 0, 1, 2] as const
  b.camera.viewSet = viewSetOf(plane)
  b.image()
  assert.deepEqual(
    view.clipPlane,
    [0, 0, 0, 0],
    'the switch is off by default: the view’s is ignored',
  )
  Object.assign(b.rt.setup, { clipping: 'pixel' })
  b.image()
  // `dot(xyz, p) + w` at least 0 is drawn: the world point z = 2 is at -3 from the eye.
  assert.deepEqual(view.clipPlane, [0, 0, 1, 3])
  assert.equal((view.cullOff ?? 0) & CULL_CLIP_PLANE_OFF, 0)
  Object.assign(b.rt.context, { cutClipPlaneCulling: false })
  b.image()
  assert.equal((view.cullOff ?? 0) & CULL_CLIP_PLANE_OFF, CULL_CLIP_PLANE_OFF)
  b.camera.viewSet = viewSetOf(NO_CLIP_PLANE)
  b.image()
  assert.deepEqual(view.clipPlane, [0, 0, 0, 0], 'a view without a plane holds zeros')
})

test('a view’s lists reach its cut as the bits of the roots they name, none for a view with no list', () => {
  const b = banc(),
    { selectionUniforms: view } = b.rt.run
  const [group, a, c] = [new Object3D(), new Object3D(), new Object3D()]
  group.add(a)
  const nodes = [a, c]
  Object.assign(b.rt.layout, {
    selectionRoots: nodes.map((node) => ({ pages: [{ drawSource: { node } }] })),
    rootIndex: { revision: 0 },
  })
  // A placement the filter leaves out or takes back casts otherwise: its shadows are staled.
  const touched: number[] = []
  Object.assign(b.rt.lights, { mobility: { touch: (rank: number) => touched.push(rank) } })
  const lists = (hidden: Object3D[], showOnly: Object3D[] | null) =>
    (b.camera.viewSet = viewSetOf(NO_CLIP_PLANE, hidden, showOnly))
  b.image()
  assert.equal(view.filter, undefined, 'no list, no bits, nothing allocated')
  lists([group], null)
  b.image()
  assert.deepEqual(Array.from(view.filter ?? []), [0b01], 'the root under the hidden group')
  assert.deepEqual(touched, [0], 'the root it hides')
  const first = view.filter
  b.image()
  assert.equal(view.filter, first, 'the same bits while the lists stand')
  assert.deepEqual(touched, [0], 'nothing staled again')
  lists([], [c])
  b.image()
  assert.deepEqual(Array.from(view.filter ?? []), [0b01], 'only c drawn: a is not')
  assert.deepEqual(touched, [0], 'the same placements left out: none staled')
  lists([], [])
  b.image()
  assert.deepEqual(touched, [0, 1], 'c is left out now')
  Object.assign(b.rt.context, { cutViewFiltering: false })
  b.image()
  assert.equal(view.filter, undefined, 'the host turned the filter off')
  assert.deepEqual(touched, [0, 1, 0, 1], 'both are taken back')
})

test('a GPU time budget coarsens the cut’s threshold by the lesser of the edge scale and the streaming’s, on an auto render scale', () => {
  const b = banc(),
    { rt } = b,
    { scale } = rt.views.main,
    view = rt.run.selectionUniforms
  // The streaming's scale is a read-only member of the real queue: this bench's is a plain object.
  const residency = rt.services.residency as { qualityScale: number }
  let now = 0
  /** An image cut at 2 pixels per edge, whose passes took 1 ms and whose cut and raster 20, read
   *  back as the timer gives it; the threshold the cut got. */
  const image = () => {
    scale.tick((now += 8), true)
    scale.drew(scale.wanted(), true)
    renderGpuCut(rt, b.camera, 2, 0)
    scale.observe(1, scale.wanted(), true, 20)
    return view.pixelError
  }
  scale.set('auto')
  for (let i = 0; i < 20; i++) assert.equal(image(), 2, 'no budget')
  Object.assign(rt.context, { cutEdgeScaleBudgetMs: 10 })
  for (let i = 0; i < 20; i++) image()
  const coarse = image()
  const fraction = scale.edge.now
  assert.ok(fraction < 1 && fraction >= 0.3, `${fraction}`)
  assert.equal(coarse, 2 / fraction, 'the threshold over the scale')
  residency.qualityScale = fraction / 2
  assert.equal(image(), 2 / (fraction / 2), 'the streaming scale, the lesser')
  residency.qualityScale = 1
  const { main } = rt.views
  rt.views.active = { scale: createScaleControl(undefined) } as typeof main
  // The aside view's own cut is this bench's selection again.
  Object.assign(rt.run, { asideCut: rt.run.gpuSelection })
  assert.equal(image(), 2, 'a view drawn beside the main one: its cut is not coarsened')
  rt.views.active = main
  assert.equal(image(), 2 / fraction, 'the main view again')
  Object.assign(rt.context, { cutEdgeScaleBudgetMs: 0 })
  assert.equal(image(), 2, 'a budget of 0 turns it off, what it learnt kept')
  scale.set(1)
  Object.assign(rt.context, { cutEdgeScaleBudgetMs: 10 })
  for (let i = 0; i < 20; i++)
    assert.equal(image(), 2, 'a fixed render scale: no dynamic resolution')
})
