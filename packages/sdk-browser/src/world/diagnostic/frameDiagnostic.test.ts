// `emitExplorerFrameDiagnostic` (batch 3): published `camera.position` is the world pose of the
// engine camera (`readCameraWorld(...).eye`), never `camera.position` read directly on the host camera.
// Under a rig that no one else walks, only the world pose discriminates.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { emitExplorerFrameDiagnostic } from './frameDiagnostic.ts'
import type { Engine } from '../../engine/types.ts'
import type { FrameMetrics } from '../../../../sdk-core/src/index.ts'
import { createHostRankDelta } from '../../streaming/hostRanks.ts'

test('emitExplorerFrameDiagnostic: the published camera is the world pose, under a rig the host does not walk', () => {
  const rig = new G.Object3D()
  rig.position.set(-3, 8, 2)
  const camera = G.perspectiveCamera(45, 1, 0.1, 50)
  rig.add(camera)
  rig.updateWorldMatrix(true, false)
  const expected = G.worldPosition(camera, new G.Vector3()).toArray()
  assert.notDeepEqual(expected, G.xyz(camera.position), 'witness: the rig does move the eye')

  const events: Array<{ phase: string; context: Record<string, unknown> }> = []
  // Every engine publishes its pending pages and retained ranks: none here.
  const active = {
    id: 'test-backend',
    metrics: () => ({}) as ReturnType<Engine['metrics']>,
    pendingUrls: () => [],
    retainedRanks: () => createHostRankDelta(0, []).finish(),
  } as unknown as Engine

  emitExplorerFrameDiagnostic({
    diagnosticChannel: { enabled: true, detail: 'trace' } as never,
    engine: active,
    camera,
    lookAtTarget: { x: 1, y: 2, z: 3 },
    metricsScratch: {} as FrameMetrics,
    pageIdByUrl: new Map(),
    streamer: { stats: () => ({ resident: 0, evictions: 0 }), retainRanks: () => {} } as never,
    scope: 'default' as never,
    frameNumber: 1,
    diagnose: (phase, _message, context) => events.push({ phase, context: context as never }),
  })

  assert.equal(events.length, 1)
  const published = events[0].context.camera as { position: number[]; target: number[] }
  assert.deepEqual(published.position, expected)
  assert.deepEqual(published.target, [1, 2, 3])
})

test('frame diagnostic includes retained rank pages beside pending pages', () => {
  const ranks = createHostRankDelta(2, ['root', 'detail'])
  ranks.begin()
  ranks.markRank(0)
  ranks.markRank(1)
  const delta = ranks.finish()
  const events: Array<Record<string, unknown>> = []
  let retained = 0
  const active = {
    id: 'test-backend',
    metrics: () => ({}) as ReturnType<Engine['metrics']>,
    pendingUrls: () => ['detail'],
    retainedRanks: () => delta,
  } as unknown as Engine
  emitExplorerFrameDiagnostic({
    diagnosticChannel: { enabled: true, detail: 'trace' } as never,
    engine: active,
    camera: G.perspectiveCamera(),
    lookAtTarget: { x: 0, y: 0, z: 0 },
    metricsScratch: {} as FrameMetrics,
    pageIdByUrl: new Map([
      ['root', 3],
      ['detail', 4],
    ]),
    streamer: {
      stats: () => ({ resident: 0, evictions: 0 }),
      retainRanks: () => void retained++,
    } as never,
    scope: 'default' as never,
    frameNumber: 1,
    diagnose: (_phase, _message, context) => events.push(context as never),
  })
  const display = events[0].display as { protectedOrRequestedPageIds: number[] }
  assert.deepEqual(display.protectedOrRequestedPageIds, [4, 3])
  assert.equal(retained, 1, 'a diagnostic that reads ranks applies their delta')
})
