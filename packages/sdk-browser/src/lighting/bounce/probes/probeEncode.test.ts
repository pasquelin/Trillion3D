import test from 'node:test'
import assert from 'node:assert/strict'
import { createProbeEncoder, type ProbeParts } from './probeEncode.ts'
import { screenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'

/** Parts of an encoder that record what an image asked of the pool and of the cache; `wanted` is the cache's last decision. */
function rig(options: Parameters<typeof screenProbeSettings>[0]) {
  const calls: string[] = []
  const settings: ScreenProbeSettings = screenProbeSettings(options)
  const state = { wanted: true }
  const pass = { setBindGroup() {}, end: () => calls.push('end') }
  const parts = {
    cascades: { probes: 8, follow() {} },
    uniform: { write: () => calls.push('uniform') },
    pool: {
      full: false,
      args: {},
      clear: () => calls.push('pool.clear'),
      markTranslucent: () => calls.push('pool.mark'),
      dispatch: () => calls.push('pool.dispatch'),
      copy: () => calls.push('pool.copy'),
      discard: () => calls.push('pool.discard'),
      restart() {},
      working: false,
    },
    cache: {
      undecided: (_now: unknown, hit: unknown) => hit === undefined && state.wanted,
      follow: () => calls.push('cache.follow'),
      clear: () => calls.push('cache.clear'),
      queued: () => calls.push('cache.queued'),
    },
  } as unknown as ProbeParts
  const encoder = { beginComputePass: () => pass } as unknown as GPUCommandEncoder
  const probes = createProbeEncoder(
    parts,
    () => ({}) as GPUBuffer,
    () => settings,
  )
  const image = (hit: unknown) => {
    calls.length = 0
    probes.encode(
      encoder,
      [0, 0, 0],
      {} as never,
      {} as never,
      1,
      undefined,
      undefined,
      undefined,
      hit as never,
    )
    return [...calls]
  }
  return { image }
}

test('an undecided image leaves the whole update: no pool pass, no stamps, no clear, no discard, nothing queued; the next image traces normally', () => {
  const { image } = rig({})
  const left = image(undefined)
  for (const name of ['pool.dispatch', 'pool.clear', 'pool.discard', 'cache.clear', 'cache.queued'])
    assert.ok(!left.includes(name), `${name} not called`)
  const next = image(null)
  assert.ok(next.includes('pool.dispatch'), 'the next image runs the pool')
  assert.ok(next.includes('cache.queued'), 'and queues its update')
})

test('a forced full update is not applied by an undecided image, and is by the next one', () => {
  const { image } = rig({ screenProbeRadianceCacheForceFullUpdate: true })
  const left = image(undefined)
  assert.ok(!left.includes('cache.clear') && !left.includes('pool.discard'))
  const next = image(null)
  assert.ok(next.includes('cache.clear') && next.includes('pool.discard'))
  assert.ok(next.indexOf('pool.discard') < next.indexOf('pool.dispatch'))
})
