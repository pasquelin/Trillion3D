// The mixers' view axis (`worldMixerView.ts`) moved from `Math.hypot` and three divisions to the
// engine's one length rule and normalise, `length3` then a product by `-1 / length`
// (docs/MATHS.md "Lengths"): the axis may part in the last bit of a double. The axis only feeds
// the mixer hold (`packages/sdk-core/src/world/animation/mixerHold.ts`): a rig's drift in pixels,
// whether it stays under half a pixel, and how many frames a drifting rig is written unasked.
// The sweep holds the old axis as its oracle and proves both decisions identical. A camera column
// shorter than about 1e-162, where `length3` underflows to 0 and `Math.hypot` does not, is no
// camera's: its scale would be that small.
import test from 'node:test'
import assert from 'node:assert/strict'
import { screenErrorBound } from '../../../../sdk-core/src/lod/screenErrorBound.ts'
import { copyScaledVector3, length3 } from '../../../../math/src/vector/vector.ts'
import { HALTON_SWEEP, haltonSpan } from '../../../../math/src/sequence/sweep.fixture.ts'

const MOST_PIXELS = 0.5,
  WAITS = 30

/** `pixelsOf` of the mixer hold: `moved` metres at `rig` as pixels at the view, stretch 1. */
function pixels(
  rig: ArrayLike<number>,
  eye: ArrayLike<number>,
  forward: ArrayLike<number>,
  moved: number,
  radius: number,
  focal: number,
  perspective: number,
) {
  const x = rig[0] - eye[0],
    y = rig[1] - eye[1],
    z = rig[2] - eye[2],
    depth = x * forward[0] + y * forward[1] + z * forward[2],
    lateral = Math.sqrt(Math.max(0, x * x + y * y + z * z - depth * depth))
  const p = screenErrorBound(moved, 1, lateral, depth, radius, focal, 0.1, perspective)
  return p < Infinity ? p : Number.MAX_VALUE
}

/** The hold's two decisions on a drift of `p` pixels over one frame: held, and the frames left
 *  unasked. */
const decisions = (p: number) => [
  p < MOST_PIXELS,
  p > MOST_PIXELS && p < Number.MAX_VALUE
    ? Math.min(WAITS, Math.floor(2 * Math.log2(p / MOST_PIXELS)))
    : 0,
]

test('the mixer hold decides from the length3 axis as from the hypot one', () => {
  const m = new Float64Array(16),
    eye = new Float64Array(3),
    rig = new Float64Array(3),
    old = new Float64Array(3),
    now = new Float64Array(3)
  let parted = 0,
    held = 0
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    // The camera's back column: a direction on the sphere, scaled by the camera's own scale.
    const turn = haltonSpan(i, 2, 0, 2 * Math.PI),
      rise = haltonSpan(i, 3, -1, 1),
      scale = haltonSpan(i, 5, 0.2, 5),
      ring = Math.sqrt(1 - rise * rise)
    m[8] = scale * ring * Math.cos(turn)
    m[9] = scale * rise
    m[10] = scale * ring * Math.sin(turn)
    for (let c = 0; c < 3; c++) {
      eye[c] = haltonSpan(i, 7 + c * 6, -100, 100)
      rig[c] = haltonSpan(i, 11 + c * 6, -1000, 1000)
    }
    // Old: `Math.hypot`, then each component divided.
    const oldBack = Math.hypot(m[8], m[9], m[10])
    old[0] = -m[8] / oldBack
    old[1] = -m[9] / oldBack
    old[2] = -m[10] / oldBack
    // New: the module's `length3` and product.
    const back = length3(m[8], m[9], m[10])
    copyScaledVector3(now, m, -1 / back, 0, 8)
    if (old[0] !== now[0] || old[1] !== now[1] || old[2] !== now[2]) parted++
    const moved = haltonSpan(i, 29, 1e-4, 0.5),
      radius = haltonSpan(i, 31, 0.05, 3),
      focal = haltonSpan(i, 37, 200, 3000),
      perspective = i & 1
    const before = pixels(rig, eye, old, moved, radius, focal, perspective),
      after = pixels(rig, eye, now, moved, radius, focal, perspective)
    assert.deepEqual(decisions(after), decisions(before), `view ${i}`)
    if (before < MOST_PIXELS) held++
  }
  // The sweep meets axes where the two rules part, and both held and written rigs.
  assert.ok(parted > 0, 'no axis parts')
  assert.ok(held > 0 && held < HALTON_SWEEP, `${held} held`)
})
