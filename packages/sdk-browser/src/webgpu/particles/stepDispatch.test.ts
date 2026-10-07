// The particle step of several pools switches pipeline three times a frame, not three times a
// pool: every pool's live window, its workgroups the GPU's, then every pool's records, then every
// pool's bound, each pool's record workgroups in its step words for `bound` to fold their partial
// windows. A device with subgroups folds a workgroup's lanes by subgroup.
import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as tick } from 'node:timers/promises'
import { fakeDevice, written } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { ParticlePool } from '../../../../sdk-core/src/fluids/particles.ts'
import { createWebgpuParticles } from './webgpuParticles.ts'
import { PARTICLE_WORKGROUP } from './particlesWgsl.ts'

/** An encoder whose compute passes log each pipeline set and each dispatch. */
function recorder() {
  const log: string[] = []
  const encoder = {
    beginComputePass: () => ({
      setPipeline: (pipeline: { entryPoint: string }) => void log.push(pipeline.entryPoint),
      setBindGroup() {},
      dispatchWorkgroups: (x: number) => void log.push(`${x}`),
      dispatchWorkgroupsIndirect: () => void log.push('window'),
      end: () => void log.push('end'),
    }),
  } as unknown as GPUCommandEncoder
  return { encoder, log }
}

test('pools step their windows, then their records, then bound; each knows its workgroups', async () => {
  const gpu = fakeDevice()
  const particles = createWebgpuParticles(gpu.device, (error) => assert.fail(String(error)))
  const pools = [3, 200].map((emitted) => {
    const pool = new ParticlePool({ capacity: 1000, emitPerFrame: 1000 })
    for (let i = 0; i < emitted; i++) pool.emit(i, 1, 2, 3, 4, 5, 6)
    pool.advance(0.01)
    return pool
  })
  await tick()
  const { encoder, log } = recorder()
  assert.equal(particles.run(pools, encoder), 6)
  const groups = [1, Math.ceil(200 / PARTICLE_WORKGROUP)]
  assert.deepEqual(log, [
    ...['main', 'window', 'window'],
    ...['emit', ...groups.map(String)],
    ...['bound', '1', '1', 'end'],
  ])
  const steps = gpu.writes.filter(({ buffer }) => buffer.label.endsWith(' step'))
  const counts = steps.map((write) => new Uint32Array(new Uint8Array(written(write)).buffer)[7])
  assert.deepEqual(counts, groups, "the step words' last word: the record workgroups bound folds")
})

test('a device with subgroups compiles the step that folds by subgroup; others, by array', () => {
  for (const features of [['subgroups'], []]) {
    const { device } = fakeDevice({ features: features as GPUFeatureName[] })
    const codes: string[] = []
    const make = device.createShaderModule.bind(device)
    device.createShaderModule = (descriptor) => (codes.push(descriptor.code), make(descriptor))
    createWebgpuParticles(device, (error) => assert.fail(String(error)))
    const step = codes.find((code) => code.includes('fn bound'))!
    assert.equal(step.includes('subgroupMax'), features.length > 0)
    assert.equal(step.startsWith('enable subgroups;'), features.length > 0)
  }
})
