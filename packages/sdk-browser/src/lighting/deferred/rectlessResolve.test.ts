// A scene that holds no rectangle light is resolved by a program with no rectangle code in its
// light loop — the largest code of the loop, whose registers every punctual light paid for —, and a
// scene that holds one never is. `isRect` answers false for every light of such a scene, so the
// branch left out never ran: the program runs the full one's code less that branch, character for
// character, and declares none of the rectangle's. That both give the same sums, bit for bit, runs
// on the GPU: `tests/gpu/lighting/narrow-resolve.gpu.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeferredLighting } from './deferred.ts'
import { recorder } from './recorder.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { contractLightingShader } from '../../gpu/core/shaderTexts.fixture.ts'
import { functionsOf, reachedFunctions } from '../../texture/shaderRule.fixture.ts'

/** The rectangle branch of the light loop: its term, the one the loop reads (every pixel sums its
 *  whole list, so no sampling weight is drawn). */
const RECT_TERM = /\n if\(isRect\(light\)\)\{\n[\s\S]*?\n \}/

test('the rectless program runs the full one less its rectangle branch', () => {
  for (const [bounce, narrow, shadowed] of [
    [false, false, true],
    [true, true, true],
    [false, false, false],
  ] as const) {
    const full = contractLightingShader(bounce, { narrow, unshadowed: !shadowed, lobeless: true })
    const rectless = contractLightingShader(bounce, {
      narrow,
      unshadowed: !shadowed,
      rectless: true,
      lobeless: true,
    })
    assert.match(full, RECT_TERM)
    const ran = (code: string) => reachedFunctions(code, ['lightSurface'], {})
    assert.equal(ran(full.replace(RECT_TERM, '')), ran(rectless))
    // No other call reaches the rectangle's shading from the loop, nor is it declared.
    assert.doesNotMatch(functionsOf(rectless, ['declaredLight']), /rectLight\(|rectIrradiance\(/)
    // The bounce program keeps the fitted table's read (`ltcLookup`): its probes' reflection is
    // weighed through it (`reflectionWeight`, `../../reflections/weight.ts`), no rectangle's.
    assert.doesNotMatch(rectless, /fn (?:rectLight|rectLtc|rectFrameOf)\(/)
    if (!bounce) assert.doesNotMatch(rectless, /fn ltcLookup\(/)
  }
})

test('a scene with no rectangle is lit by the rectless program, one with a rectangle never is', async () => {
  const gpu = fakeDevice(),
    { device } = gpu
  const lighting = await createDeferredLighting(device)
  const { labels, draw } = recorder(gpu, lighting)
  const frame = (rectless: boolean) => draw({ rectless })
  frame(true)
  await lighting.settle()
  // The twin with rectangle code compiled beside it: a rectangle added is lit at once.
  frame(true)
  frame(false)
  frame(true)
  assert.deepEqual(labels(), [
    'DIRECT_RECTLESS_LIGHTING',
    'DIRECT_LIGHTING',
    'DIRECT_RECTLESS_LIGHTING',
  ])
  lighting.dispose()
})
