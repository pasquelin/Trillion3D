// The probe update's group is one probe, one thread a ray (`probeGroupWgsl.ts`): its width is the
// probe's rays, never the dispatch width other kernels tune, so a retuned `WORKGROUP_THREADS`
// cannot push its partial sums past the 16 KiB of workgroup memory every device holds.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslConstants } from '../texture/shaderRule.fixture.ts'
import { BOUNCE_PROBE_SHADER } from './probeWgsl.ts'
import { BOUNCE_SETTINGS } from '../../../sdk-core/src/bounce/contracts.ts'
import { GUARANTEED_WORKGROUP_BYTES } from '../gpu/core/textureLimits.ts'

test('the probe update is as wide as a probe’s rays, its sums within the guaranteed memory', () => {
  const body = BOUNCE_PROBE_SHADER.split('fn updateProbes(')[0]
  assert.match(body, /@compute @workgroup_size\(PROBE_THREADS\)\n$/)
  assert.match(BOUNCE_PROBE_SHADER, /var<workgroup> partial:array<array<vec3f,PROBE_THREADS>,13>;/)
  assert.match(BOUNCE_PROBE_SHADER, /var<workgroup> partialTravelled:array<vec2f,PROBE_THREADS>;/)
  const threads = (wgslConstants(BOUNCE_PROBE_SHADER) as Record<string, number>).PROBE_THREADS
  assert.equal(threads, BOUNCE_SETTINGS.raysPerProbe)
  assert.equal(threads & (threads - 1), 0, 'the sums gather by halves')
  assert.ok(threads * (13 * 16 + 8) <= GUARANTEED_WORKGROUP_BYTES)
})

test('a probe’s rays are its threads: one constant, each lane its one ray', () => {
  const constants = wgslConstants(BOUNCE_PROBE_SHADER) as Record<string, number>
  assert.equal(constants.RAYS_PER_PROBE, undefined, 'no second name for the group’s width')
  assert.match(BOUNCE_PROBE_SHADER, /let d=rayDirection\(lane,jitter,rotation\);/)
  assert.doesNotMatch(BOUNCE_PROBE_SHADER, /for\(var ray=/)
})
