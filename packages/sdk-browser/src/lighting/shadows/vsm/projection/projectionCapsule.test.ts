// The local lights' one-pass projection reads the capsule shadows only in the program that asks: without them its text is the one it always was.
import test from 'node:test'
import assert from 'node:assert/strict'
import { vsmLayout } from '../layout.ts'
import { vsmLocalsProjectionWgsl, VSM_PROJECTION_BINDING } from './projectionWgsl.ts'

const layout = vsmLayout({ coverMode: 'suns', fullMapCapacity: 127, sunMapCapacity: 35 })

test('the capsule cut adds one binding and one min where a light’s share is packed, and only there', () => {
  const plain = vsmLocalsProjectionWgsl(layout, 'r32uint')
  assert.equal(plain, vsmLocalsProjectionWgsl(layout, 'r32uint', false, 'gbuffer', false))
  assert.ok(!plain.includes('vsmCapsule'))
  const capsule = vsmLocalsProjectionWgsl(layout, 'r32uint', false, 'gbuffer', true)
  assert.ok(
    capsule.includes(
      `@group(1) @binding(${VSM_PROJECTION_BINDING.capsule}) var vsmCapsule:texture_2d_array<f32>;`,
    ),
  )
  assert.ok(capsule.includes('share=min(share,held*held)'))
  assert.equal((capsule.match(/vsmCapsule/g) ?? []).length, 3)
})
