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
import { particleGroups, particlesWgsl } from './particlesWgsl.ts'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { dispatchGrid } from '../../gpu/dag/shader/gridWgsl.ts'

/** An encoder whose compute passes log each pipeline set and each dispatch. */
function recorder() {
  const log: string[] = []
  const encoder = {
    beginComputePass: () => ({
      setPipeline: (pipeline: { entryPoint: string }) => void log.push(pipeline.entryPoint),
      setBindGroup() {},
      dispatchWorkgroups: (x: number, y = 1) => void log.push(y > 1 ? `${x}×${y}` : `${x}`),
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
  const groups = [1, particleGroups(200)]
  assert.deepEqual(log, [
    ...['main', 'window', 'window'],
    ...['emit', ...groups.map(String)],
    ...['bound', '1', '1', 'end'],
  ])
  const steps = gpu.writes.filter(({ buffer }) => buffer.label.endsWith(' step'))
  const counts = steps.map((write) => new Uint32Array(new Uint8Array(written(write)).buffer)[7])
  assert.deepEqual(counts, groups, "the step words' last word: the record workgroups bound folds")
})

test('records past one dimension of a dispatch step in rows of 65,535 groups', async () => {
  const gpu = fakeDevice()
  const particles = createWebgpuParticles(gpu.device, (error) => assert.fail(String(error)))
  const emitted = 65_535 * 64 + 1,
    pool = new ParticlePool({ capacity: emitted, emitPerFrame: emitted })
  for (let i = 0; i < emitted; i++) pool.emit(i, 1, 2, 3, 4, 5, 6)
  pool.advance(0.01)
  await tick()
  const { encoder, log } = recorder()
  particles.run([pool], encoder)
  // 65,536 groups: two rows of 65,535, the last row's groups past the records writing nothing.
  assert.deepEqual(log.slice(log.indexOf('emit'), log.indexOf('bound')), ['emit', '65535×2'])
})

test("past one dimension's groups, bound writes the window's dispatch in rows; main ranks its slots once", () => {
  type Run = { windowGrid: (g: number) => number[]; flatIndex: (...xyw: number[]) => number }
  const { windowGrid, flatIndex } = shaderRun<Run>(
    particlesWgsl(false),
    ['windowGrid', 'flatIndex'],
    {},
  )
  for (const groups of [0, 1, 4000, 65_535, 65_536, 200_000])
    assert.deepEqual(windowGrid(groups), dispatchGrid(groups), `${groups} groups`)
  // A window of 65,535 · 64 + 1 slots: its 65,536 groups in two rows of 65,535.
  const instances = 65_535 * 64 + 1,
    groups = particleGroups(instances),
    [x, y] = windowGrid(groups),
    seen = new Uint8Array(groups)
  let past = 0
  for (let row = 0; row < y; row++)
    for (let at = 0; at < x; at++) {
      // The first and last lanes of group (at, row): its partial's slot and its last slot.
      const [k, last] = [0, 63].map((lane) => flatIndex(at * 64 + lane, row, x))
      assert.equal(last, k + 63)
      if (k >= instances) past++
      else assert.equal(seen[k / 64]++, 0, `partial ${k / 64} written twice`)
    }
  assert.ok(
    seen.every((hit) => hit === 1),
    "every stepped group's partial, the ones bound folds",
  )
  assert.equal(past, x * y - groups)
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
