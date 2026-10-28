// The sheen table on the GPU (`sheenLtcWgsl.ts`): the shipped read, run in f32, against a twin of a bilinear sampler held to the
// edge at the texel-centre transform, over the table the light buffer holds; and the buffer written with it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { F32_SCOPE } from './shaderRunF32.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { fromHalf } from '../../../math/src/float/half.ts'
import { lerp } from '../../../math/src/scalar/reals.ts'
import { sheenLtcHalves, SHEEN_LTC_SIZE } from '../../../sdk-core/src/lighting/sheenLtc.ts'
import { createSceneLightStore } from '../../../sdk-core/src/scene/light/store.ts'
import { BACKEND } from '../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createSceneLightContractBuffer } from '../frame/backend/state/lightBuffer.ts'
import { LIGHT_BUFFER_AT } from '../frame/backend/state/lightBufferLayout.ts'
import { sheenLtcAlbedo } from './sheenLtcWgsl.fixture.ts'

const SIZE = SHEEN_LTC_SIZE
const halves = sheenLtcHalves()
/** The table as the light buffer holds it: two words a texel, four half floats. */
const words = new Uint32Array(halves.buffer, halves.byteOffset, halves.length / 2)
const sheen = Array.from({ length: SIZE * SIZE }, (_, i) => [words[2 * i], words[2 * i + 1]])

const shader = shaderRun<{
  sheenLtcCoefficients: (NoV: number, roughness: number) => number[]
  sheenLtcAlbedo: (NoV: number, roughness: number) => number
}>(wgslModule(sheenLtcAlbedo), ['sheenLtcCoefficients', 'sheenLtcAlbedo'], {
  ...F32_SCOPE,
  directLights: { sheen },
})

/** Texel (`row` the cosine, `column` the square root of the roughness) of the table, held to the edge. */
const texel = (row: number, column: number) => {
  const clamped = (k: number) => Math.min(Math.max(k, 0), SIZE - 1)
  const at = (clamped(row) * SIZE + clamped(column)) * 4
  return [0, 1, 2, 3].map((k) => fromHalf(halves[at + k]))
}
/** The table read as a bilinear sampler clamped to the edge reads a texture of it at `(√roughness, |NoV| + 1e-5)` times 31/32
 *  plus half a texel. */
function twin(NoV: number, roughness: number) {
  const x = ((Math.sqrt(roughness) * (SIZE - 1)) / SIZE + 0.5 / SIZE) * SIZE - 0.5
  const y =
    ((Math.min(Math.max(Math.abs(NoV) + 1e-5, 0), 1) * (SIZE - 1)) / SIZE + 0.5 / SIZE) * SIZE - 0.5
  const [x0, y0] = [Math.floor(x), Math.floor(y)]
  const [fx, fy] = [x - x0, y - y0]
  return [0, 1, 2, 3].map((k) =>
    lerp(
      lerp(texel(y0, x0)[k], texel(y0, x0 + 1)[k], fx),
      lerp(texel(y0 + 1, x0)[k], texel(y0 + 1, x0 + 1)[k], fx),
      fy,
    ),
  )
}

test('the coefficients are the table read bilinear at the texel-centre transform, held to the edge', () => {
  for (const NoV of [-0.6, 0, 0.013, 0.37, 0.5, 0.91, 1])
    for (const roughness of [0, 0.02, 0.1, 0.45, 0.8, 1]) {
      const got = shader.sheenLtcCoefficients(NoV, roughness)
      const expected = twin(NoV, roughness)
      for (let k = 0; k < 4; k++)
        assert.ok(
          Math.abs(got[k] - expected[k]) <= 1e-5 * Math.max(Math.abs(expected[k]), 1),
          `NoV ${NoV}, roughness ${roughness}, channel ${k}: ${got[k]} against ${expected[k]}`,
        )
    }
})

test('the albedo is the third channel of the coefficients', () => {
  for (const [NoV, roughness] of [
    [0.2, 0.3],
    [0.8, 0.9],
    [1, 0.02],
  ])
    assert.equal(
      shader.sheenLtcAlbedo(NoV, roughness),
      shader.sheenLtcCoefficients(NoV, roughness)[2],
    )
})

test('the light buffer is written with the table once, where the lighting reads it', () => {
  const gpu = fakeDevice(BACKEND)
  const buffer = createSceneLightContractBuffer(gpu.device, createSceneLightStore())
  const written = gpu.writes.filter(
    (w) => w.buffer === buffer && w.offset === LIGHT_BUFFER_AT.sheen,
  )
  assert.equal(written.length, 1)
  assert.deepEqual(
    new Uint16Array(written[0].data.buffer, written[0].data.byteOffset, halves.length),
    halves,
  )
})
