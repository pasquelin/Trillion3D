// The lengths five pages took with `Math.hypot` are the engine's, `math.vector3(...).length()` and
// `math.vector2(...).length()` read in a scratch of the page (the length rule, docs/MATHS.md
// "Lengths"): the framing's radius and distance, the dolly page's distance, level reach and the
// town's delays, the camera wall's reach, aim and cone, the lamp's wall. Each is held to the
// float32 of the expression it replaced, or to the same decision; the stats header's drag
// threshold compares the squared reach, with no length at all.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  HALTON_SWEEP,
  assertSameFloat32,
  haltonSpan,
} from '../../packages/math/src/sequence/sweep.fixture.ts'
import { math } from '../../packages/sdk-core/src/world/math/index.ts'
import { ease } from './kit/opening.ts'

/** Lengths from tiny to large, the spans the sweeps draw each component from. */
const SPANS = [
  [-1e-6, 1e-6],
  [-1, 1],
  [-40, 40],
  [-1e3, 1e3],
  [-1e6, 1e6],
]

test('a length through math.vector3 and math.vector2 reaches the float32 of Math.hypot, and what reads it', () => {
  const reach = math.vector3(),
    ground = math.vector2()
  for (const [lo, hi] of SPANS)
    for (let i = 1; i <= HALTON_SWEEP; i++) {
      const [x, y, z] = [2, 3, 5].map((base) => haltonSpan(i, base, lo, hi)),
        turn = haltonSpan(i, 7, -Math.PI, Math.PI),
        at = `${x}, ${y}, ${z}`
      const pairs: [number, number][] = [
        [Math.hypot(x, y, z), reach.set(x, y, z).length()],
        [Math.hypot(x, z), ground.set(x, z).length()],
      ]
      for (const [old, now] of pairs) {
        assertSameFloat32(old, now, `length ${at}`)
        // The framing's radius, the town's delay, the wall's aim and the dolly's turn and log.
        assertSameFloat32(old / 2, now / 2, `half ${at}`)
        assertSameFloat32(old * 0.06, now * 0.06, `delay ${at}`)
        assertSameFloat32(old * Math.sin(turn), now * Math.sin(turn), `turned ${at}`)
        assertSameFloat32(Math.atan2(y, old * 0.8), Math.atan2(y, now * 0.8), `pitch ${at}`)
        assertSameFloat32(Math.log(old), Math.log(now), `log ${at}`)
        // The camera wall's zoom on what it tracks, and the lamp's wall.
        const zoom = (far: number) =>
          Math.max(14, Math.min(58, (2 * Math.atan(5 / far) * 180) / Math.PI))
        assertSameFloat32(zoom(old), zoom(now), `zoom ${at}`)
        const wall = (far: number) => math.clamp((y - 0.07 - far) / 0.12, 0, 1)
        assertSameFloat32(wall(old), wall(now), `wall ${at}`)
      }
    }
})

test("the town's buildings rise at the same float32 heights from every block's length", () => {
  // `tall · ease((time − delay) / 1.2)`, the delay `length · 0.06 + random · 0.3`: Math.hypot
  // and the rule part in the last bit on some blocks (−10, −6 first).
  const ground = math.vector2(),
    rise = (delay: number, time: number, tall: number) =>
      Math.max(0.02, tall * ease.inOut((time - delay) / 1.2))
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 6; j++) {
      const cx = -10 + i * 4,
        cz = -10 + j * 4
      for (let k = 1; k <= 256; k++) {
        const r = haltonSpan(k, 2, 0, 1) * 0.3,
          time = haltonSpan(k, 3, 0, 4),
          tall = haltonSpan(k, 5, 0.8, 11)
        const old = Math.hypot(cx, cz) * 0.06 + r,
          now = ground.set(cx, cz).length() * 0.06 + r
        assertSameFloat32(old, now, `${cx}, ${cz} delay`)
        assertSameFloat32(rise(old, time, tall), rise(now, time, tall), `${cx}, ${cz} at ${time}`)
      }
    }
})

test('a camera of the wall sees the car from the same lengths', () => {
  const reach = math.vector3()
  let seen = 0
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const yaw = haltonSpan(i, 2, -Math.PI, Math.PI),
      pitch = haltonSpan(i, 3, -1.2, 1.2),
      fov = haltonSpan(i, 5, 14, 58)
    const look = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)]
    const [cx, cy, cz] = [7, 11, 13].map((base) => haltonSpan(i, base, -60, 60))
    const dot = look[0] * cx + look[1] * cy + look[2] * cz,
      cone = Math.cos(math.degToRad(fov / 2))
    const old = dot / Math.hypot(cx, cy, cz) > cone,
      now = dot / reach.set(cx, cy, cz).length() > cone
    assert.equal(now, old, `camera ${i}`)
    if (now) seen++
  }
  assert.ok(seen > 0 && seen < HALTON_SWEEP, `${seen} seen`)
})

test('the stats header becomes a drag past 6 pixels at the same moves', () => {
  // Every move by 1/64 of a pixel up to 8 on each axis — the squares and their sum exact —, then
  // fractional moves of any size.
  const decide = (dx: number, dy: number) =>
    assert.equal(dx * dx + dy * dy < 36, Math.hypot(dx, dy) < 6, `${dx}, ${dy}`)
  for (let x = -512; x <= 512; x++) for (let y = -512; y <= 512; y++) decide(x / 64, y / 64)
  for (let i = 1; i <= HALTON_SWEEP; i++) decide(haltonSpan(i, 2, -9, 9), haltonSpan(i, 3, -9, 9))
})
