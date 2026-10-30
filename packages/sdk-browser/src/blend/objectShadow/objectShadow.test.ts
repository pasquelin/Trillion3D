// The translucent object shadows' depth pass (`objectShadow/`): the stage's text, and the matrix a subject draws with.
import test from 'node:test'
import assert from 'node:assert/strict'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { checkStageLimits } from '../../../../../tests/kit/fakeDevice/limitRules.ts'
import { blendObjectShadowShader } from './objectShadowWgsl.ts'
import { objectShadowClipMatrix } from './objectShadowDraw.ts'
import { objectShadowDrawLayout } from './objectShadowStage.ts'
import { radianceMarkBlendLayout } from '../radianceMarkStage.ts'
import type { ObjectShadowProjection } from '../../lighting/shadows/perObject/objectShadowSetup.ts'

installGpuGlobals()

test('the stage writes two targets of the Fourier series, the vertex stage lays the subject range out by its frame', () => {
  const code = blendObjectShadowShader()
  assert.match(code, /@location\(0\) cosines/)
  assert.match(code, /@location\(1\) sines/)
  assert.match(code, /-2\.0\*log\(max\(1\.0-density,0\.00001\)\)/)
  assert.match(code, /out\.position=vec4f\(osClip\.xy,0\.5\*osClip\.w,osClip\.w\)/)
  assert.ok(!/osObjects/.test(code))
  assert.ok(!/unreal|epic/i.test(code))
})

test('a subject draws under the pre-translation and the centimetre scale of its frame', () => {
  const inner = new Float64Array(16).map((_, i) => i + 1)
  const p = {
    translatedWorldToClipInner: inner,
    preShadowTranslation: [10, 20, 30],
  } as unknown as ObjectShadowProjection
  const out = new Float32Array(16)
  objectShadowClipMatrix(p, out)
  assert.equal(out[0], 100)
  assert.equal(out[4], 500)
  // The translation column: the frame's last row plus the pre-translation through its first three.
  assert.equal(out[12], 13 + 10 * 1 + 20 * 5 + 30 * 9)
  assert.equal(out[15], 16 + 10 * 4 + 20 * 8 + 30 * 12)
})

test("the stage fits the limits with the mark stage's items layout", () => {
  const recording = { createBindGroupLayout: (d: object) => d } as unknown as GPUDevice
  checkStageLimits('the object shadow depth stage', [
    radianceMarkBlendLayout(recording),
    objectShadowDrawLayout(recording),
  ])
})
