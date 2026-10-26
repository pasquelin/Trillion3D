// `Vector3.addVectors` / `subVectors`: their writes are heard and they return the receiver.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from './vector3.ts'
import { listen } from '../observed.ts'
import { assertBits } from '../../../../../tests/kit/assert/bits.ts'
import { HOSTILE_FLOATS } from '../../../../../tests/kit/assert/hostile.ts'

type V3 = [number, number, number]
/** The kit's hostile floats, with overflow, finite values and inexact sums. */
const SCALARS = [...HOSTILE_FLOATS, 1, -1, 2.5, 1e308, -1e308, 0.1, 1 / 3]
/** Each scalar in turn on every component, beside its next two. */
const HOSTILE = SCALARS.map(
  (_, i): V3 => [0, 1, 2].map((k) => SCALARS[(i + k) % SCALARS.length]) as V3,
)

/** `Vector3`'s two methods as they stood, on its unchanged `set`, `copy` and `addScaledVector`. */
const before = {
  addVectors: (t: Vector3, u: Vector3, v: Vector3) => t.set(u.x + v.x, u.y + v.y, u.z + v.z),
  subVectors: (t: Vector3, u: Vector3, v: Vector3) => t.copy(u).addScaledVector(v, -1),
}

test('Vector3.addVectors and subVectors keep their bits, their writes heard and their return', () => {
  for (const method of ['addVectors', 'subVectors'] as const)
    for (const start of [[0, 0, 0], [7, 7, 7], ...HOSTILE])
      for (const a of HOSTILE)
        for (const b of HOSTILE)
          for (const alias of ['none', 'u', 'v'] as const) {
            const [now, was] = [new Vector3(...start), new Vector3(...start)]
            const heard = [0, 0]
            listen(now, () => heard[0]++)
            listen(was, () => heard[1]++)
            const pick = (t: Vector3, own: V3, as: typeof alias) =>
              alias === as ? t : new Vector3(...own)
            const back = now[method](pick(now, a, 'u'), pick(now, b, 'v'))
            before[method](was, pick(was, a, 'u'), pick(was, b, 'v'))
            assertBits(now.elements, was.elements, `${method} ${start} ${a} ${b} ${alias}`)
            assert.equal(heard[0], heard[1], `${method} writes heard`)
            assert.equal(back, now)
          }
})
