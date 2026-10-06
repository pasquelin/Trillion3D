// Per-side texture compression and render scale: what lets one execution pit RGBA8 pools against
// block pools, or a native frame against a reconstructed one, on the same dist, cache and poses.
import test from 'node:test'
import assert from 'node:assert/strict'
import { equipSide, sideReport } from './sideOptions.ts'

const equip = (name: string, flags: Record<string, string>) => {
  return equipSide({ name } as never, new Map(Object.entries(flags)), { engine: 'webgpu' })
}

test('a side takes its own compression, then the campaign one, otherwise the engine choice', () => {
  assert.equal(equip('before', {}).compression, null)
  assert.equal(equip('before', { compression: 'none' }).compression, 'none')
  const own = equip('after', { compression: 'none', 'compression-after': 'astc' })
  assert.equal(own.compression, 'astc')
  assert.equal(sideReport(own)[1].compression, 'astc')
  assert.throws(
    () => equip('after', { 'compression-after': 'dxt1' }),
    /must be auto, bc7, astc, none/,
  )
  assert.throws(() => equip('before', { 'error-metric': 'other' }), /must be certifiee, reference/)
})

// #816: one run pits the native frame against one drawn below the display and reconstructed.
test('a side takes its own render scale, then the campaign one, otherwise the display', () => {
  assert.equal(equip('before', {}).renderScale, null)
  assert.equal(equip('before', { scale: '0.5' }).renderScale, 0.5)
  const own = equip('after', { scale: '1', 'scale-after': '0.67' })
  assert.equal(own.renderScale, 0.67)
  assert.equal(sideReport(own)[1].scale, 0.67)
  for (const wrong of ['0.4', '1.5', 'half'])
    assert.throws(() => equip('after', { 'scale-after': wrong }), /must be in \[0.5, 1\]/)
  // A scale no image would be drawn at is refused, never reported: WebGL2, or no temporal resolve.
  const flags = (entries: Record<string, string>) => new Map(Object.entries(entries))
  assert.throws(
    () => equipSide({ name: 'after' } as never, flags({ scale: '0.67' }), { engine: 'webgl2' }),
    /needs the WebGPU engine/,
  )
  assert.throws(() => equip('after', { antialiasing: 'off', scale: '0.67' }), /needs the WebGPU/)
})
