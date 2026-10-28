// The fixed-step screen trace of the probes: the tolerance of a sample, in a perspective and an orthographic projection, against the reference's formula.

import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { screenSlabInto } from '../../visibility/hiz/gpu/screenSlab.ts'
import { SP_FIXED_TOLERANCE } from './screen/traceFeatureWgsl.ts'

/** A column-major 4 x 4 matrix times a column vector. */
const apply = (m: readonly number[], v: readonly number[]) =>
  [0, 1, 2, 3].map((row) => v.reduce((sum, x, column) => sum + m[column * 4 + row] * x, 0))

/** The reference's tolerance of a ray from clip point `start` (`InitScreenSpaceRayFromWorldSpace`, SSRTRayCast.ush:93-119): the clip depth moved a view
 *  distance `span` along the view's depth axis by the projection (`ViewToClip * (0, 0, span, 0)`), the screen depth it gives, then the perspective's or the
 *  orthographic projection's rule. */
function reference(
  projection: readonly number[],
  perspective: boolean,
  startClip: number[],
  stepZ: number,
  span: number,
  slope: number,
) {
  const moved = apply(projection, [0, 0, span, 0])
  const depthClip = startClip.map((x, i) => x + moved[i])
  const startZ = startClip[2] / startClip[3]
  const depthZ = depthClip[2] / depthClip[3]
  return perspective
    ? Math.max(Math.abs(stepZ), (startZ - depthZ) * slope)
    : Math.max(0, (startZ - depthZ) * slope)
}

test('the fixed-step tolerance is the reference’s, under a perspective and under an orthographic projection', () => {
  const height = 720
  const near = 0.1
  const f = 1.7
  // Reversed-depth projections of a view looking along +z: the infinite perspective's clip depth is the near plane, its clip w the view depth; the
  // orthographic one's falls linearly with the view depth from 1 at the eye to 0 at `range`.
  const range = 200
  const projections = {
    perspective: [f / 1.78, 0, 0, 0, 0, f, 0, 0, 0, 0, 0, 1, 0, 0, near, 0],
    orthographic: [0.05, 0, 0, 0, 0, 0.09, 0, 0, 0, 0, -1 / range, 0, 0, 0, 1, 1],
  }
  for (const [name, projection] of Object.entries(projections)) {
    const perspective = name === 'perspective'
    const slab = [0, 0, 0, 0]
    screenSlabInto(slab, 0, projection, height, [0, 0, 0])
    const run = shaderRun<{
      spFixedTolerance: (z: number, step: number, span: number, slope: number) => number
    }>(wgslModule(SP_FIXED_TOLERANCE), ['spFixedTolerance'], { reflectionView: { slab } })
    for (const depth of [0.5, 3, 40]) {
      const startClip = apply(projection, [0.3 * depth, -0.2 * depth, depth, 1])
      const startZ = startClip[2] / startClip[3]
      for (const span of [0.25, 2, 30]) {
        for (const [stepZ, slope] of [
          [0, 2],
          [0.0001, 4],
          [-0.002, 2],
        ]) {
          const expected = reference(projection, perspective, startClip, stepZ, span, slope)
          const got = run.spFixedTolerance(startZ, stepZ, span, slope)
          assert.ok(
            Math.abs(got - expected) <= 1e-5 * Math.max(Math.abs(expected), 1e-3),
            `${name}, depth ${depth}, span ${span}: ${got} against ${expected}`,
          )
        }
      }
    }
  }
})
