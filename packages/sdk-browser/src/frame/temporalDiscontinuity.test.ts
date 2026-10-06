import test from 'node:test'
import assert from 'node:assert/strict'
import { createFrameGateCore } from './gateCore.ts'
import { createViewHold } from './viewRevision.ts'
import * as G from '../host/graph/graph.fixture.ts'
import type { HostCamera } from '../camera/world.ts'

const enter = (gate: ReturnType<typeof createFrameGateCore>, camera: HostCamera) =>
  gate.enterFrame({}, camera, {}, [640, 480], new G.Object3D(), [])

test('ordinary camera motion preserves history while an explicit cut invalidates it', () => {
  const gate = createFrameGateCore(1)
  const camera = G.perspectiveCamera() as HostCamera
  enter(gate, camera)
  const first = gate.temporalRevision
  camera.position.x = 10
  enter(gate, camera)
  assert.equal(gate.temporalRevision, first)
  camera.temporalRevision = 1
  enter(gate, camera)
  assert.equal(gate.temporalRevision, first + 1)
  enter(gate, camera)
  assert.equal(gate.temporalRevision, first + 1)
  const replacement = camera.clone()
  replacement.temporalRevision = camera.temporalRevision
  enter(gate, replacement)
  assert.equal(gate.temporalRevision, first + 1, 'an identical wrapper is continuous')
  const elsewhere = camera.clone()
  elsewhere.position.z = 20
  enter(gate, elsewhere)
  assert.equal(gate.temporalRevision, first + 2)
})

test('each persistent view retains its own camera discontinuity revision', () => {
  const gate = createFrameGateCore(1)
  const a = G.perspectiveCamera() as HostCamera
  const b = G.perspectiveCamera() as HostCamera
  enter(gate, a)
  a.temporalRevision = 1
  enter(gate, a)
  const revision = gate.temporalRevision
  const main = gate.useViewHold(createViewHold(1, 1))
  enter(gate, b)
  assert.equal(gate.temporalRevision, 1)
  gate.useViewHold(main)
  enter(gate, a)
  assert.equal(gate.temporalRevision, revision)
})
