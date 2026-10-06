// What reads the temporal resolve's flicker measure (`shadingHistoryWgsl.ts`), run from its shipped
// text: the still mask that lets it count, the confidence its error widens, and the measurement
// curve its lumas live in. The measure itself is `shadingHistory.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { Mat } from '../texture/shaderRunBuiltins.fixture.ts'
import { SHADING_HISTORY_WGSL } from './shadingHistoryWgsl.ts'
import { stillViewFields, taaBuiltins } from './taaBuiltins.fixture.ts'
import { IDENTITY_MATRIX4 } from '../../../sdk-core/src/index.ts'

type Reads = {
  shadingConfidence: (error: number, range: number, flicker: number, count: number) => number
  shadingStill: (here: number[], before: number[], animated: boolean) => number
  shadingLuma: (y: number) => number
  shadingLinear: (s: number) => number
}
const view = {
  tsr: [1, 0, 0, 0],
  viewport: [1920, 1080, 1 / 1920, 1 / 1080],
  prevViewProj: new Mat([...IDENTITY_MATRIX4]),
  ...stillViewFields(1920),
}
const reads = (fields: typeof view) =>
  shaderRun<Reads>(
    SHADING_HISTORY_WGSL,
    ['shadingConfidence', 'shadingStill', 'shadingLuma', 'shadingLinear'],
    { ...taaBuiltins, view: fields },
  )
const { shadingConfidence, shadingStill, shadingLuma, shadingLinear } = reads(view)

test('the still mask: a point displaced past a render pixel, or a camera parallax past its limit', () => {
  const here = [0.3, -0.2, -5, 0.2]
  // A render pixel at clip w five is five world units wide here (`moire.z` 1): within, still.
  assert.equal(shadingStill(here, [0.3 + 4 * 0.2, -0.2, -5, 0.2], false), 1)
  const at = (shift: number) => shadingStill(here, [0.3 + shift * 0.2, -0.2, -5, 0.2], false)
  assert.ok(Math.abs(at(7.5) - 0.5) < 1e-9, 'half moving at one and a half pixels')
  assert.equal(at(12), 0)
  assert.equal(shadingStill(here, here, true), 0, 'an animated geometry moves')
  // Background: a direction neither moves nor shows parallax.
  assert.equal(shadingStill([0, 0, -1, 0], [0, 0, -1, 0], false), 1)
})

test('the parallax of a camera that moved, graded from half its limit to one and a half', () => {
  const limit = 1 / view.moire[1]
  // A point the last view saw at the centre, at clip w one; the turned view shifted by `pixels`.
  const parallax = (pixels: number) => {
    const turned = { ...view, parallax: [(2 * pixels) / view.viewport[0], 0, 0, 0] }
    return reads(turned).shadingStill([0, 0, 0, 1], [0, 0, 0, 1], false)
  }
  assert.equal(parallax(0.4 * limit), 1)
  assert.ok(Math.abs(parallax(limit) - 0.5) < 1e-6)
  assert.equal(parallax(2 * limit), 0)
})

test('a coherent lighting change keeps two samples of a full history', () => {
  assert.equal(shadingConfidence(0.3, 0, 0, 16), 2)
  assert.equal(shadingConfidence(0.3, 0.01, 0, 16), 2)
})

test('variation within the 3×3’s luma range, or three times the flicker error, keeps the history', () => {
  assert.equal(shadingConfidence(0.1, 0.3, 0, 16), 16, 'noise as wide as the 3×3')
  assert.ok(shadingConfidence(0.3, 0, 0, 16) < 3, 'a flat 3×3 rejects a change')
  assert.equal(shadingConfidence(0.3, 0, 0.1, 16), 16, 'a flickering pixel keeps it')
  assert.equal(shadingConfidence(0, 0, 0, 5), 6)
  // Past the bound, the trust falls with the square of how far.
  assert.ok(
    Math.abs(shadingConfidence(0.2, 0.1, 0, 15) - 16 * ((0.1 + 0.0009765625) / 0.2) ** 2) < 1e-9,
  )
})

test('the measurement curve: exposed, x / (x + 0.17) squared, and back', () => {
  assert.equal(shadingLuma(0), 0)
  assert.equal(shadingLuma(-1), 0)
  for (const y of [0.01, 0.17, 0.5, 4]) {
    const g = y / (y + 0.17)
    assert.ok(Math.abs(shadingLuma(y) - g * g) < 1e-12)
    assert.ok(Math.abs(shadingLinear(shadingLuma(y)) - y) < 1e-9 * Math.max(1, y))
  }
})
