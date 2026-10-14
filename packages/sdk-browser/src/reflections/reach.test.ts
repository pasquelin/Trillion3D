// The reach of a reflection's proxy ray (`reach.ts`): the lobe the probes' order-2 field stands for is
// the one whose band-3 response is under one 8-bit step, a property of the GGX lobe alone.
import test from 'node:test'
import assert from 'node:assert/strict'
import { REFLECTION_FIELD_ALPHA, bandThree, fieldAlpha } from './reach.ts'

test('the band-3 response falls from a mirror’s one to the clamped cosine’s zero', () => {
  assert.ok(bandThree(0.05) > 0.95, 'a near mirror keeps its band 3')
  assert.ok(Math.abs(bandThree(1)) < 1e-6, 'α = 1 is the clamped cosine, odd bands past 1 vanish')
  let last = Infinity
  for (let alpha = 0.05; alpha <= 1; alpha += 0.05) {
    const a3 = bandThree(alpha)
    assert.ok(a3 < last, `decreasing at ${alpha}`)
    last = a3
  }
})

test('the field stands for a lobe only under one 8-bit step of band 3', () => {
  assert.ok(bandThree(REFLECTION_FIELD_ALPHA) <= 1 / 255)
  assert.ok(bandThree(REFLECTION_FIELD_ALPHA - 2 ** -18) > 1 / 255)
  assert.ok(fieldAlpha(1 / 1023) > REFLECTION_FIELD_ALPHA, 'a finer step asks a wider lobe')
})
