import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import { surfaceOf } from '../page/surface.ts'
import { gpuFrameCostSnapshot } from './costAudit.ts'
import { createEngineCamera } from '../camera/engineCamera.ts'
import { readCameraWorld } from '../camera/world.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'

test('opt-in snapshot: bounded, without changing the selection or inventing the GPU mask', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location')
  const setSearch = (search: string) =>
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { search },
    })
  try {
    setSearch('')
    assert.equal(
      gpuFrameCostSnapshot({} as WebgpuPagesRuntime),
      undefined,
      'none outside debug mode',
    )
    setSearch('?profile')
    const item = {
      bounds: [10, 0, 0, 11, 1, 1],
      surface: surfaceOf(G.basicSurface({ side: G.DOUBLE_SIDE })),
    }
    const items = [item]
    // An item whose bounds lie out of the frustum: the snapshot reads the GPU verdict's count,
    // and walks no item — a box test here would throw.
    Object.defineProperty(item, 'bounds', { get: () => assert.fail('no CPU frustum walk') })
    const rt = {
      blendState: { visibleBlend: items, blendGpu: items },
      run: { blendDrawCalls: 2, blendFrustumRejected: 1 },
      timing: {},
      gpu: { targetSize: [32, 32] },
    } as unknown as WebgpuPagesRuntime
    const snapshot = gpuFrameCostSnapshot(rt)!
    assert.equal(snapshot.listedOutsideFrustum, 1)
    assert.equal(snapshot.gpuEmptyDraws, null)
    assert.equal(items.length, 1)
    assert.equal(items[0], item)
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'location', descriptor)
    else Reflect.deleteProperty(globalThis, 'location')
  }
})

test('gpuFrameCostSnapshot: the published pose is the engine camera’s (run.gate.cam), under a rig', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location')
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { search: '?profile' },
  })
  try {
    // Two-level rig nobody else walks: the local host camera stays trivial, only the rig carries
    // the translation. `run.lastCamera` is only a truth marker here — its shape must never be read
    // for the pose, only `run.gate.cam` (already resolved) counts.
    const rig = new Object3D()
    rig.position.set(3, -6, 9)
    const hostCamera = G.perspectiveCamera(50, 1, 0.1, 100)
    rig.add(hostCamera)
    rig.updateWorldMatrix(true, false)
    const cam = readCameraWorld(createEngineCamera(), hostCamera)
    const rt = {
      blendState: { visibleBlend: [], blendGpu: [] },
      run: { lastCamera: {}, gate: { cam }, blendDrawCalls: 0 },
      timing: {},
      gpu: { targetSize: [32, 32] },
    } as unknown as WebgpuPagesRuntime
    const snapshot = gpuFrameCostSnapshot(rt)!
    assert.deepEqual(snapshot.camera!.position, [...cam.eye])
    assert.notDeepEqual(
      snapshot.camera!.position,
      G.xyz(hostCamera.position),
      'the host camera’s local pose (the origin under this rig) is not the published pose',
    )
    assert.equal(snapshot.camera!.fov, cam.fov)
    assert.equal(snapshot.camera!.near, cam.near)
    assert.equal(snapshot.camera!.far, cam.far)
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'location', descriptor)
    else Reflect.deleteProperty(globalThis, 'location')
  }
})
