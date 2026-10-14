// The fog law (#345): a CPU oracle — the linear ramp, and the transmittance of a medium whose
// density falls off with height, integrated numerically along the view ray — against the shipped
// shader text, `FOG_WGSL` run as shipped (`shaderRun`), so a shader edit is what the test sees.
// With no fog the shader hands the lit colour back untouched.
import test from 'node:test'
import assert from 'node:assert/strict'
import { FOG_WGSL } from './fogShader.ts'
import {
  packEnvironment,
  SCENE_ENVIRONMENT_FLOATS,
} from '../../../sdk-core/src/scene/core/environment.ts'
import { packFog, type SceneFog } from '../../../sdk-core/src/scene/core/fog.ts'
import { lerp, saturate } from '../../../math/src/scalar/reals.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { near } from '../../../math/src/float/near.fixture.ts'
import { distanceVector3 } from '../../../math/src/vector/vector.ts'

type V3 = [number, number, number]

/** The oracle: the fog law at `P` seen from `eye`, the optical depth summed over 20 000 steps. */
function oracle(fog: SceneFog, eye: V3, P: V3) {
  const d = distanceVector3(P, eye)
  if ('near' in fog) return saturate((fog.far - d) / (fog.far - fog.near))
  const { density, heightFalloff = 0, baseHeight = 0 } = fog
  let tau = 0
  for (let i = 0, n = 20000; i < n; i++) {
    const y = eye[1] + ((i + 0.5) / n) * (P[1] - eye[1])
    tau += density * Math.exp(-heightFalloff * (y - baseHeight)) * (d / n)
  }
  return Math.exp(-tau)
}

/** The WGSL `fogged` on the contract buffer's fog block, as `packEnvironment` writes it: the
 *  shipped text run by the shared WGSL run. */
function wgslFogged(fog: SceneFog | undefined, rgb: V3, P: V3, eye: V3) {
  const packed = packEnvironment({ exposure: 1, fog }, new Float32Array(SCENE_ENVIRONMENT_FLOATS))
  const block = [Array.from(packed.subarray(36, 40)), Array.from(packed.subarray(40, 44))]
  const { fogged } = shaderRun<{ fogged: (rgb: V3, P: V3, eye: V3) => number[] }>(
    FOG_WGSL,
    ['fogTransmittance', 'fogged'],
    { directLights: { fog: block } },
  )
  return fogged(rgb, P, eye)
}

const RGB: V3 = [0.8, 0.3, 0.1]
const COLOR: V3 = [0.5, 0.6, 0.7]
const expected = (fog: SceneFog, P: V3, eye: V3) => {
  const t = oracle(fog, eye, P)
  return RGB.map((value, i) => lerp(COLOR[i], value, t))
}
/** The shader at every point against the oracle. */
function lawHolds(fog: SceneFog, eye: V3, points: V3[]) {
  for (const P of points) {
    const want = expected(fog, P, eye)
    near(wgslFogged(fog, RGB, P, eye), want, `WGSL ${JSON.stringify({ fog, P })}`, 2e-5)
  }
}

test('linear fog: untouched before near, half-way between, the fog colour alone past far', () => {
  const fog = { color: COLOR, near: 10, far: 110 }
  const eye: V3 = [3, 2, -4]
  lawHolds(fog, eye, [
    [3, 2, 1],
    [3, 2, 6],
    [3, 2, 56],
    [3, 2, 106],
    [3, 2, 300],
  ])
  const half = RGB.map((v, i) => (v + COLOR[i]) / 2)
  near(wgslFogged(fog, RGB, [3, 2, 56], eye), half, 'half', 2e-5)
  near(wgslFogged(fog, RGB, [3, 2, 300], eye), COLOR, 'far', 2e-5)
})

test('exponential fog: exp(−density·d) at every height when nothing falls off', () => {
  const fog = { color: COLOR, density: 0.02 }
  lawHolds(
    fog,
    [0, 5, 0],
    [
      [0, 5, 50],
      [30, -20, 10],
      [0, 80, -40],
    ],
  )
  near(
    wgslFogged(fog, RGB, [0, 5, 50], [0, 5, 0]),
    expected(fog, [0, 5, 50], [0, 5, 0]),
    'e⁻¹',
    2e-5,
  )
})

test('height fog: the integrated density, looking level, up and down, from above and below', () => {
  const fog = { color: COLOR, density: 0.08, heightFalloff: 0.35, baseHeight: 1 }
  const points: V3[] = [
    [40, 2, 0],
    [40, 2.0001, 0],
    [10, -3, 30],
    [5, 25, -5],
    [0, 1, 200],
  ]
  lawHolds(fog, [0, 2, 0], points)
  lawHolds(fog, [0, -4, 0], points)
  // A long ray that barely rises: the two densities' mean, where the closed form would round.
  lawHolds({ ...fog, density: 0.005 }, [0, 2, 0], [[400, 2.0028, 0]])
  // High above a steep falloff, the densities underflow and stay finite.
  lawHolds(
    { ...fog, heightFalloff: 1 },
    [0, 400, 0],
    [
      [0, 0, 10],
      [300, 1, 0],
    ],
  )
  // Deep inside a steep fog, far below its base: the densities pass the cap, the fog stays total.
  const deep = [-99, -100, -101].map((y): V3 => [5, y, 3])
  lawHolds({ ...fog, heightFalloff: 1 }, [0, -100, 0], deep)
})

test('no fog: the shader hands the lit colour back as it is, the block all zero', () => {
  const block = packFog(undefined, new Float32Array(8).fill(9), 0)
  assert.deepEqual(Array.from(block), [0, 0, 0, 0, 0, 0, 0, 0])
  for (const P of [
    [0, 0, 5],
    [1e4, -300, 2],
  ] as V3[]) {
    assert.deepEqual(wgslFogged(undefined, RGB, P, [0, 1, 0]), RGB)
  }
})
