// The fog's read of its cubemap (`./fog/readWgsl.ts`), run as shipped (`shaderRun`): a cube texture
// asked by direction — its sharpest level far away, its last level near, both between —, turned about
// the vertical, and seamless at the smallest level. Split from `fogRead.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../math/src/float/near.fixture.ts'
import { cubemapMipCount } from '../../../sdk-core/src/scene/core/fogCubemap.ts'
import { fogBlockOf } from './fog/readWgsl.ts'
import type { V3 } from './fogVolumeRun.fixture.ts'
import { fogRun } from './fogShaderRun.fixture.ts'

/** The colour the fog's cubemap gives a ray of `span` metres in direction `ray` (`fogInscattering`):
 *  a scene whose cubemap is turned by `turn` degrees, the cube a fake texture asked through
 *  `answer` — which receives the direction and the level, and answers one value for all channels —,
 *  every ask kept. */
function cubeLook(
  turn: number,
  ray: V3,
  span: number,
  answer: (d: number[], level: number) => number,
) {
  const asked: { direction: number[]; level: number }[] = []
  const cube = { size: 4, texels: new Float32Array(6 * 16 * 3), turn }
  const run = fogRun<{ fogInscattering: (r: V3, d: number, sky: boolean) => number[] }>(
    { cubemap: cube },
    ['fogInscattering'],
    {
      resources: {
        block: fogBlockOf({ group: 0, cubemap: 1, sampler: 2 }),
        scope: {
          fogCubemap: {},
          fogSampler: {},
          textureSampleLevel: (_t: unknown, _s: unknown, direction: number[], level: number) => {
            asked.push({ direction: [...direction], level })
            const v = answer(direction, level)
            return [v, v, v, 1]
          },
        },
      },
    },
  )
  return { colour: run.fogInscattering(ray, span, false), asked }
}

test('the cubemap is a cube texture asked by direction: its sharpest level far away, its last level near, both between', () => {
  const levels = cubemapMipCount(4)
  const far = cubeLook(0, [1, 0.5, -2], 5000, (_d, level) => (level === 0 ? 0.8 : 0.2))
  assert.deepEqual(far.asked, [{ direction: [1, 0.5, -2], level: 0 }])
  near(far.colour, [0.8, 0.8, 0.8], 'sharp', 1e-6)
  const close = cubeLook(0, [1, 0.5, -2], 1, (_d, level) => (level === 0 ? 0.8 : 0.2))
  assert.deepEqual(close.asked, [{ direction: [1, 0.5, -2], level: levels }])
  near(close.colour, [0.2, 0.2, 0.2], 'average', 1e-6)
  // Between the two distances both are read and blended by the distance.
  const between = cubeLook(0, [1, 0, 0], 505, (_d, level) => (level === 0 ? 1 : 0))
  assert.deepEqual(between.asked.map((a) => a.level).sort(), [0, levels])
  near([between.colour[0]], [(505 - 10) / (1000 - 10)], 'blend', 1e-6)
})

test('the cubemap’s turn: a positive angle carries what lies ahead round to the right', () => {
  // The scene looks down −z with +x on its right. Turned a quarter, the cube's +x lies ahead — a ray
  // ahead reads it — and the cube's +z lies to the right.
  const ahead = cubeLook(90, [0, 0, -1], 5000, () => 1)
  near(ahead.asked[0].direction, [1, 0, 0], 'ahead reads +x', 1e-9)
  const right = cubeLook(90, [1, 0, 0], 5000, () => 1)
  near(right.asked[0].direction, [0, 0, 1], 'right reads +z', 1e-9)
  // Not turned, a ray reads its own direction.
  near(cubeLook(0, [0.3, 0.4, -0.5], 5000, () => 1).asked[0].direction, [0.3, 0.4, -0.5], 'none', 0)
})

/** What a seamless sampler gives at a cube's smallest level, one texel a face (`means`, the faces'
 *  `+x, −x, +y, −y, +z, −z`): the texel of the face the direction falls on, blended toward the face
 *  across each edge the direction nears by the share it has gone to it — the sampler reads the edge
 *  texel of the next face where the tap leaves its own. Valid where one other axis is off the face's. */
function seamless(means: number[], d: number[]) {
  const abs = d.map(Math.abs)
  const major = abs.indexOf(Math.max(...abs))
  const face = (axis: number) => axis * 2 + (d[axis] < 0 ? 1 : 0)
  let own = 1
  let across = 0
  for (let axis = 0; axis < 3; axis++) {
    if (axis === major) continue
    const share = abs[axis] / abs[major] / 2
    own -= share
    across += share * means[face(axis)]
  }
  return own * means[face(major)] + across
}

test('the cubemap’s average at 45° between two faces is the blend of their means, continuous across the seam', () => {
  const means = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]
  const at = (angle: number) =>
    cubeLook(0, [Math.cos(angle), 0, Math.sin(angle)], 1, (d, level) =>
      level === 0 ? 0 : seamless(means, d),
    ).colour[0]
  const seam = Math.PI / 4
  // Face +x holds 0.1, face +z 0.5: on the seam, their mean — not either face's own.
  near([at(seam)], [0.3], 'the seam', 1e-6)
  near([at(0)], [0.1], 'mid-face', 1e-6)
  // A degree either side of the seam the colour moves a little — it does not jump to a face's constant.
  const step = Math.PI / 180
  assert.ok(Math.abs(at(seam + step) - at(seam - step)) < 0.02)
  assert.ok(at(seam - step) < at(seam) && at(seam) < at(seam + step))
})
