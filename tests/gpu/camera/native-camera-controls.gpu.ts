// The native camera controllers on Dawn: every gesture is a pointer, wheel or key event on the
// page's canvas, and a gesture undone brings the pose back, then the image to the byte. The
// controllers import nothing of the host library (`tests/integration/engine-without-three.test.ts`
// forbids it), so no addon can be loaded. The page has no pointer lock: the first-person head
// turns through drags, the way it turns while the lock is refused.
import test from 'node:test'
import assert from 'node:assert/strict'
import { measureOutput } from '../../../bench/core/paths.ts'
import { runOnDawn } from '../kit/onDawn.ts'
import { threeStackCache } from '../kit/renderHarness.ts'
import { drag, key, openCameraProbe, wheel } from './cameraGestures.ts'

type Probe = Awaited<ReturnType<typeof openCameraProbe>>
type Kind = Parameters<Probe['begin']>[0]

/** The middle of the canvas, CSS pixels: where every gesture starts. */
const CENTRE: [number, number] = [120, 80]

/** Holds `code` over one integration step of half a second, as a host's frame loop would. */
function hold(probe: Probe, code: string) {
  key('keydown', code)
  probe.step(0.5)
  key('keyup', code)
}

/** Each gesture moves the camera and answers the pose it reached, then undoes itself. */
const GESTURES: Record<Kind, (probe: Probe) => number[]> = {
  controls: (probe) => {
    drag(probe.canvas, CENTRE, 120, 0)
    wheel(probe.canvas, CENTRE, 300)
    drag(probe.canvas, CENTRE, 60, 0, 2)
    const moved = probe.step(0)
    drag(probe.canvas, CENTRE, -60, 0, 2)
    wheel(probe.canvas, CENTRE, -300)
    drag(probe.canvas, CENTRE, -120, 0)
    return moved
  },
  trackballControls: (probe) => {
    drag(probe.canvas, CENTRE, 90, 0)
    wheel(probe.canvas, CENTRE, 200)
    const moved = probe.step(0)
    wheel(probe.canvas, CENTRE, -200)
    drag(probe.canvas, CENTRE, -90, 0)
    return moved
  },
  panZoomControls: (probe) => {
    drag(probe.canvas, CENTRE, 70, 30)
    wheel(probe.canvas, CENTRE, -200)
    const moved = probe.step(0)
    wheel(probe.canvas, CENTRE, 200)
    drag(probe.canvas, CENTRE, -70, -30)
    return moved
  },
  flyControls: (probe) => {
    hold(probe, 'KeyW')
    const moved = probe.step(0)
    hold(probe, 'KeyS')
    drag(probe.canvas, CENTRE, 80, 0)
    probe.step(0)
    drag(probe.canvas, CENTRE, -80, 0)
    probe.step(0)
    return moved
  },
  firstPersonControls: (probe) => {
    drag(probe.canvas, CENTRE, 80, 0)
    const moved = probe.step(0)
    drag(probe.canvas, CENTRE, -80, 0)
    probe.step(0)
    hold(probe, 'KeyW')
    hold(probe, 'KeyS')
    return moved
  },
}

async function playGestures() {
  const { manifestUrl } = threeStackCache(measureOutput('gpu-proofs', 'native-camera-controls'))
  const probe = await openCameraProbe(manifestUrl)
  try {
    const played = []
    for (const [kind, gesture] of Object.entries(GESTURES) as [
      Kind,
      (probe: Probe) => number[],
    ][]) {
      const home = await probe.begin(kind)
      const moved = gesture(probe)
      played.push({ kind, home, moved, ...(await probe.end()) })
    }
    return played
  } finally {
    probe.dispose()
  }
}

test(
  'each native controller moves the camera and comes back to its pose and image',
  { timeout: 300_000 },
  async () => {
    const errors: string[] = []
    const played = await runOnDawn(playGestures, null, errors)
    console.log(
      JSON.stringify(
        played.map(({ kind, changes, differences }) => ({ kind, changes, differences })),
      ),
    )
    assert.deepEqual(errors, [])
    for (const { kind, home, moved, pose, changes, bytes, differences } of played) {
      assert.ok(changes > 0, `${kind} emitted no change`)
      assert.ok(bytes > 0, `${kind} drew nothing`)
      assert.notDeepEqual(moved, home, `${kind} did not move the camera`)
      // The gesture and its reverse leave the pose it started from, then the very image.
      assert.deepEqual(pose, home, `${kind} did not come back to its pose`)
      assert.equal(differences, 0, `${kind} did not come back to its image`)
    }
  },
)
