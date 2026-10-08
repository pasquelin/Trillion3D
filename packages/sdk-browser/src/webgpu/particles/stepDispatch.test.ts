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
import { DEFAULT_GROUP_WIDTH } from '../../gpu/dispatch/grid.ts'

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
  // The host's split of the record workgroups only reads the step's count: a small pool told to
  // have emitted that many records, nothing of its 4.19M slots allocated.
  const emitted = 65_535 * 64 + 1,
    pool = new ParticlePool({ capacity: 64, emitPerFrame: 1 })
  pool.emit(0, 1, 2, 3, 4, 5, 6)
  pool.advance(0.01)
  const step = pool.flush()
  pool.flush = () => ({ ...step, count: emitted })
  // The staged records' copy is out of this test: it would copy 4.19M records' words.
  gpu.device.queue.writeBuffer = () => {}
  await tick()
  const { encoder, log } = recorder()
  particles.run([pool], encoder)
  // 65,536 groups: two rows of 65,535, the last row's groups past the records writing nothing.
  assert.deepEqual(log.slice(log.indexOf('emit'), log.indexOf('bound')), ['emit', '65535×2'])
})

test("past one dimension's groups, bound writes the window's dispatch in rows; main ranks its slots once", () => {
  type Run = { groupGrid: (g: number) => number[]; flatIndex: (...v: unknown[]) => number }
  const { groupGrid, flatIndex } = shaderRun<Run>(
    particlesWgsl(false),
    ['groupGrid', 'ceilDiv', 'flatIndex'],
    { GROUP_WIDTH: DEFAULT_GROUP_WIDTH },
  )
  // A window of 65,535 · 64 + 1 slots: its 65,536 groups in two rows of 65,535.
  const instances = 65_535 * 64 + 1,
    groups = particleGroups(instances),
    [x, y] = groupGrid(groups),
    n = [x, y, 1],
    seen = new Uint8Array(groups)
  assert.deepEqual([x, y], [65_535, 2])
  let past = 0
  for (let row = 0; row < y; row++)
    for (let at = 0; at < x; at++) {
      // The first and last lanes of group (at, row), and the group's rank: its partial's slot.
      const [k, last] = [0, 63].map((lane) => flatIndex([at * 64 + lane, row, 0], n, 64))
      const rank = flatIndex([at, row, 0], n, 1)
      assert.equal(last, k + 63)
      assert.equal(rank * 64, k)
      if (k >= instances) past++
      else assert.equal(seen[rank]++, 0, `partial ${rank} written twice`)
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
