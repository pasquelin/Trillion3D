import test from 'node:test'
import assert from 'node:assert/strict'
import { detectCapabilities, webgpuUnavailable } from './capabilities.ts'
import { WEBGPU_REQUIRED_WGSL_FEATURES } from '../../engine/common.ts'

/** The WGSL language features of a browser that compiles every engine program. */
const WGSL = new Set<string>(WEBGPU_REQUIRED_WGSL_FEATURES)

test('a browser without WebGPU, or without an adapter, is unavailable and says why', async () => {
  const none = await detectCapabilities({ gpu: undefined })
  assert.equal(none.tier, 'unavailable')
  assert.equal(none.adapter, null)
  const refused = await detectCapabilities({
    gpu: { wgslLanguageFeatures: WGSL, requestAdapter: async () => null } as unknown as GPU,
  })
  assert.deepEqual([refused.tier, refused.reason], ['unavailable', 'no WebGPU adapter'])
  const error = webgpuUnavailable(refused.reason)
  assert.equal(error.code, 'WEBGPU_UNAVAILABLE')
  assert.match(error.message, /WebGPU only.*no WebGPU adapter.*WebGPU enabled/)
})

test('an adapter with GPU timestamps is the full tier, one without is degraded', async () => {
  const adapter = (features: string[]) =>
    ({
      wgslLanguageFeatures: WGSL,
      requestAdapter: async () => ({ features: new Set(features) }),
    }) as unknown as GPU
  const full = await detectCapabilities({ gpu: adapter(['timestamp-query', 'subgroups']) })
  assert.deepEqual([full.tier, full.extensions], ['full', ['timestamp-query', 'subgroups']])
  assert.equal((await detectCapabilities({ gpu: adapter([]) })).tier, 'degraded')
})

test('a browser whose WGSL lacks read-only storage textures is refused by name, no adapter asked', async () => {
  for (const wgslLanguageFeatures of [undefined, new Set<string>()]) {
    const gpu = {
      wgslLanguageFeatures,
      requestAdapter: () => assert.fail('no adapter is asked'),
    } as unknown as GPU
    const refused = await detectCapabilities({ gpu })
    assert.deepEqual(
      [refused.tier, refused.adapter, refused.reason],
      ['unavailable', null, 'its WGSL lacks readonly_and_readwrite_storage_textures'],
    )
  }
})
