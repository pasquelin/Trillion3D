import assert from 'node:assert/strict'
import test from 'node:test'
import type { SceneLight } from './contracts.ts'
import { validateSceneLight } from './validate.ts'
import { halton } from '../../../../math/src/sequence/halton.ts'

const panel = (direction: number[], right: number[]): SceneLight =>
  ({
    id: 'panel',
    kind: 'rect',
    position: [0, 3, 0],
    range: 20,
    color: [1, 1, 1],
    intensity: 4,
    castsShadow: false,
    direction,
    right,
    size: [2, 1],
  }) as SceneLight

/** A point of the cube [−1, 1]³ from three Halton bases. */
const swept = (index: number, bases: number[]) => bases.map((base) => 2 * halton(index, base) - 1)

test('a rect width axis is the right minus its part along the normal, then unit, bit for bit', () => {
  // The former expression, word for word: the dot summed left to right, then each component
  // minus `along` times the normal's, then divided by `Math.hypot`.
  for (let i = 1; i <= 4096; i++) {
    const light = panel(swept(i, [2, 3, 5]), swept(i, [7, 3, 2]))
    const length = Math.hypot(...(light.direction as number[]))
    const normal = (light.direction as number[]).map((n) => n / length)
    const right = light.right as number[]
    const along = right[0] * normal[0] + right[1] * normal[1] + right[2] * normal[2]
    const residual = [0, 1, 2].map((k) => right[k] - along * normal[k])
    const rest = Math.hypot(...residual)
    let validated: SceneLight
    try {
      validated = validateSceneLight(light)
    } catch {
      assert.ok(!(length > 1e-6 && rest > 1e-6), `light ${i} refused`)
      continue
    }
    assert.ok(length > 1e-6 && rest > 1e-6, `light ${i} accepted`)
    assert.deepEqual(validated.direction, normal)
    assert.deepEqual(
      validated.right,
      residual.map((r) => r / rest),
    )
  }
})

test('a direction keeps its unit length however long it is given', () => {
  // `Math.hypot` holds the length where the plain sum of squares overflows to infinity.
  assert.deepEqual(validateSceneLight(panel([0, 0, -1e200], [3e180, 0, 0])).direction, [0, 0, -1])
  assert.deepEqual(validateSceneLight(panel([0, 0, -1e200], [3e180, 0, 0])).right, [1, 0, 0])
  assert.throws(() => validateSceneLight(panel([0, 1e-7, 0], [1, 0, 0])), /zero-length/)
  assert.throws(() => validateSceneLight(panel([0, 1, 0], [0, 2, 0])), /zero-length/)
})
