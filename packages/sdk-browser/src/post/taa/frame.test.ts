import test from 'node:test'
import assert from 'node:assert/strict'
import { dropTaaHistory, taaConverged } from './landing.ts'
import { historySampleLaws } from './historyWgsl.ts'
import { IDENTITY_MATRIX4 } from '../../../../math/src/matrix/matrix4.ts'
import { taaRenderMatrix } from './frame.ts'
import { askVelocity } from './velocityFrame.ts'
import { runtime } from './frame.fixture.ts'
import { TAA_SAMPLES } from './jitter.ts'
import type { TaaInputs } from './inputs.ts'
import { TAA_VIEW } from './bindingsWgsl.ts'
import { NO_VIEW_SET } from '../../../../sdk-core/src/world/camera/viewSet.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { graphRastersOf } from '../../materials/graph/graphRasters.ts'
import { velocityWpo } from './velocityWpo.ts'
import { VELOCITY_INPUT_BINDINGS } from './nearestSurfaceWgsl.ts'
import { velocityInputEntries } from './inputs.ts'
import { SURFACE_VELOCITY_WGSL, surfaceVelocityShader } from './surfaceVelocityWgsl.ts'
import { velocityShader } from './nearestVelocityWgsl.ts'

/** The uniform's words a frame writes: whether the history describes nothing (a cut, none yet),
 *  and whether a placement moved. */
const CUT = TAA_VIEW.at.params,
  MOVED = CUT + 2

test("without accumulation this frame, the render matrix is the camera's and composition reads the lit image", () => {
  const { rt, cam, encoded, frame } = runtime()
  rt.capture.capturing = true
  assert.equal(frame(false), null)
  assert.equal(taaRenderMatrix(rt, cam), cam.viewProjection)
  assert.equal(encoded.length, 0)
  rt.capture.capturing = false
  rt.run.diagnostic = 'screen-error' as never
  assert.equal(frame(false), null)
  assert.equal(taaRenderMatrix(rt, cam), cam.viewProjection)
})

test('an accumulated frame advances jitter, writes the uniform and returns the written target', () => {
  const { rt, cam, temporal, encoded, frame } = runtime()
  const selection = rt.run.gpuSelection as unknown as {
    previous: GPUTextureView
    posesMoving: boolean
  }
  let u = frame(false)!
  assert.notEqual(taaRenderMatrix(rt, cam), cam.viewProjection, 'the matrix carries the jitter')
  assert.equal(encoded.length, 1)
  assert.equal(
    (encoded[0] as TaaInputs).normals,
    rt.vis.concatNrm,
    'the atlas a prism is solved by',
  )
  // The placements' motion is read from the cut's poses now and as the last drawn frame drew them
  // (`previousPoses.ts`): the velocity reads both tables, and no motion of its own is kept.
  assert.equal((encoded[0] as TaaInputs).previous, selection.previous, 'the kept poses')
  // Without history the frame is a cut (`params.x`); the next one reads it, and nobody moved
  // (`params.z`).
  assert.equal(u[CUT], 1)
  u = frame(false)!
  assert.equal(u[CUT], 0)
  assert.equal(u[MOVED], 0)
  assert.equal(temporal.frame.sample, 2)
  // A pose that moved since the kept poses is told to the pass, and the history stands.
  selection.posesMoving = true
  u = frame(false)!
  assert.equal(u[MOVED], 1)
  assert.equal(u[CUT], 0, 'a moved pose is no cut')
  // A view drawn less often than its frame — other views drew the frames between, poses moving —
  // measures from the scene's kept poses as every view does: its history stands.
  rt.run.frame += 2
  u = frame(false)!
  assert.equal(u[MOVED], 1)
  assert.equal(u[CUT], 0, 'frames the view did not draw: the history stands')
  selection.posesMoving = false
  u = frame(false)!
  assert.equal(u[CUT], 0, 'the history stands')
  // No flag is read by the pass: a debug view's as-is pixels are composed after it (it read the
  // flags of a frame with as-is pixels).
  assert.ok(!('flags' in (encoded.at(-1) as object)))
})

test('the jitter runs on every image, a cut drops the history', () => {
  const { temporal, frame } = runtime()
  // Three moving frames: the jitter advances.
  for (let i = 0; i < 3; i++) frame(false)
  assert.equal(temporal.frame.sample, 3)
  frame(false)
  // A still frame: the history is read, the jitter rank runs on.
  const start = temporal.frame.sample
  let u = frame(true)!
  assert.equal(u[CUT], 0, 'the history is kept')
  assert.equal(temporal.frame.sample, start + 1, 'the jitter rank runs on')
  for (let k = 1; k < TAA_SAMPLES; k++) frame(true)
  assert.equal(temporal.frame.sample, start, 'the cycle turns on still images')
  // Something moves: history stays and mixes at its own share.
  u = frame(false)!
  assert.equal(u[CUT], 0)
  dropTaaHistory(temporal.frame)
  assert.equal(temporal.frame.hasHistory, false)
  assert.equal(temporal.frame.sample, 0)
})

test('motion restarts the convergence count: a still view after it holds once its own images fill the history', () => {
  const { rt, cam, temporal, frame } = runtime()
  const converged = () => taaConverged(temporal.frame, 64, 64)
  for (let i = 0; i < 30; i++) frame(true)
  assert.equal(temporal.frame.accumulated, 30, 'a still view counts every image')
  // The camera moves: the history is kept, its count restarts with this image.
  cam.viewProjection = Float64Array.from(IDENTITY_MATRIX4, (v, i) => (i === 12 ? 0.25 : v))
  frame(false)
  assert.equal(temporal.frame.accumulated, 1)
  assert.equal(temporal.frame.hasHistory, true)
  // Still again: never whole before the history holds its most samples of still images.
  let images = 1
  while (!converged()) {
    frame(true)
    images++
  }
  const { samples } = historySampleLaws(1)
  assert.ok(images >= samples, `${images} still images, at least ${samples}`)
  assert.equal(temporal.frame.sample, 0, 'held at the end of a jitter cycle')
  // A resource landing restarts it too.
  rt.run.gate.resourcesChanged()
  frame(true)
  assert.equal(temporal.frame.accumulated, 1)
})

test('a view that has a plane is jittered like any other, the pass accumulating', () => {
  const { rt, cam, temporal, frame } = runtime()
  cam.viewSet = Object.freeze({ ...NO_VIEW_SET, clipPlane: [0, 0, 1, 2] }) as never
  frame(false)
  assert.notDeepEqual(Array.from(temporal.frame.jitter), [0, 0], 'a sub-pixel sample')
  assert.notDeepEqual(Array.from(taaRenderMatrix(rt, cam)), Array.from(cam.viewProjection))
  assert.equal(temporal.frame.active, true)
})

test("the frame's tessellation picks the velocity stage's program and the pass's: decided once", () => {
  const { rt, temporal, velocity, frame } = runtime()
  frame(false)
  assert.deepEqual(velocity.drawn, [false], 'no displaced surface: the surfaces are flat')
  Object.assign(rt.vis.materialTable.displaced, { count: 1 })
  frame(false)
  assert.deepEqual(velocity.drawn, [false, true])
  assert.equal(temporal.frame.tessellated, true, 'decided once, by the stage, for the pass')
  Object.assign(rt.context, { tessellation: false })
  frame(false)
  assert.deepEqual(velocity.drawn, [false, true, false], 'the setting off draws them flat')
})

test('an image that draws displaced surfaces asks the velocity programs that solve their flat points, any other asks none', () => {
  const { rt, device, computePipelines, temporal } = runtime()
  const stages = () =>
    computePipelines
      .filter(({ compute }) => compute.entryPoint === 'surfaceVelocity')
      .map(({ compute }) => compute.constants)
  askVelocity(rt, device)
  assert.deepEqual(stages(), [undefined], 'the flat program only')
  assert.equal(temporal.askedDisplaced, 0)
  Object.assign(rt.vis.materialTable.displaced, { count: 1 })
  askVelocity(rt, device)
  assert.deepEqual(stages(), [undefined, { DISPLACED: 1 }], 'the same module, the displaced stage')
  assert.equal(temporal.askedDisplaced, 1, 'and the analysis asks its own')
})

test('where an offset moves vertices, the velocity places a pixel on them now and before, over the records and the frame it reads', () => {
  const g = material.graph('surface')
  g.output('baseColor', g.constant(1, 0, 0))
  g.output('worldPositionOffset', g.multiply(g.time(), g.constant(1, 0, 0)))
  const rasters = graphRastersOf([{ graph: g }])
  assert.equal(rasters.offsets.length, 1)
  const offsets = velocityWpo(rasters)
  assert.deepEqual(
    velocityInputEntries().map(({ binding }) => binding),
    Object.values(VELOCITY_INPUT_BINDINGS).sort((a, b) => a - b),
    'the records and the frame are in the layout whatever the session holds: a program that joins later is a module',
  )
  for (const text of [surfaceVelocityShader(offsets), velocityShader(offsets)]) {
    assert.match(text, /let word=materialGraphWord\(page\.material\);/)
    assert.match(text, /@binding\(13\) var materialTable/)
    assert.match(text, /@binding\(14\) var<uniform> graphFrame/)
    // A row whose offset is a motion is measured as one that moves, and reprojected by the vertices
    // of the image before, the placement's motion taking the object back.
    assert.match(text, /\(page\.wpo&2u\)!=0u/)
    assert.match(text, /pagePreviousPosition\(page,h,corners\.x,before\)/)
  }
  assert.doesNotMatch(SURFACE_VELOCITY_WGSL, /materialGraphWord|@binding\(13\)/)
})
