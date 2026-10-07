// `pose.runPath` on the one engine (#1483): every pose drawn once, in order, after the warmup, each
// frame measured on its display frame; the A/B campaign of several engines it replaced is gone.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { CameraPose, FrameMetrics } from '../../../sdk-core/src/index.ts'
import { runCameraPath } from './path.ts'

/** Display frames 16 ms apart, the third one late. */
function displayFrames() {
  const times = [0, 16, 32, 80, 96, 112, 128, 144]
  let at = 0
  const scope = globalThis as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown }
  scope.requestAnimationFrame = (callback: (time: number) => void) => {
    const time = times[at++]
    queueMicrotask(() => callback(time))
    return at
  }
  scope.cancelAnimationFrame = () => {}
  return () => {
    delete scope.requestAnimationFrame
    delete scope.cancelAnimationFrame
  }
}

const pose = (x: number): CameraPose => ({
  position: [x, 0, 5],
  target: [0, 0, 0],
  fov: 50,
  near: 0.1,
  far: 100,
})

test('a path run draws each pose once after the warmup and measures each frame', async () => {
  const restore = displayFrames()
  try {
    const drawn: (CameraPose | undefined)[] = []
    const metrics = { cpuFrameMs: 0, rafIntervalMs: null } as unknown as FrameMetrics
    const session = {
      diagnostic: 'beauty',
      render(at?: CameraPose) {
        drawn.push(at)
        metrics.cpuFrameMs = drawn.length
        return metrics
      },
    }
    const path = [pose(0), pose(1), pose(2)]
    const run = await runCameraPath(session, path, { warmup: 2 })
    assert.deepEqual(drawn, [path[0], path[1], ...path], 'the warmup, then the path in order')
    assert.equal(run.frames.length, 3)
    assert.notEqual(run.frames[0], metrics, 'each frame is a copy of the metrics')
    assert.deepEqual(
      run.frames.map((frame) => [frame.cpuFrameMs, frame.rafIntervalMs]),
      [
        [3, null],
        [4, 48],
        [5, 16],
      ],
    )
    assert.equal(run.cpu?.max, 5)
    assert.equal(run.cadence.stutters, 0)
    assert.equal(run.cadence.p99Ms, 48)
  } finally {
    restore()
  }
})

test('a path run refuses another view than beauty, and an empty path', async () => {
  const session = { diagnostic: 'clusters', render: () => ({}) as FrameMetrics }
  await assert.rejects(runCameraPath(session, [pose(0)]), /beauty/)
  await assert.rejects(runCameraPath({ ...session, diagnostic: 'beauty' }, []), /1\.\.6000/)
})
