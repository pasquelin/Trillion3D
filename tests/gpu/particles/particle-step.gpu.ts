// The engine's particle step (#420) on a real GPU: the committed WGSL compiles, and one step of a
// pool ten kilometres from the world origin moves a newborn particle by its 0.4 mm drift, leaves
// one born dead and a slot nobody emitted into as they are; a 60 s life dies after 60 s of 144 Hz
// steps and ages no more (#759). The words are the engine's: the pool stages the records,
// `createStepWords` writes the uniform; only this proof reads the state back.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ParticlePool } from '../../../packages/sdk-core/src/fluids/particles.ts'
import {
  PARTICLES_WGSL,
  PARTICLE_WORKGROUP,
} from '../../../packages/sdk-browser/src/webgpu/particles/particlesWgsl.ts'
import { createStepWords } from '../../../packages/sdk-browser/src/particles/stepWords.ts'
import { runOnDawn } from '../kit/onDawn.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'

type Steps = { words: number[][]; staged: number[]; bytes: number; groups: number }

/** One dispatch of `words[0]`, then 62 s of `words[1]`; the first eight particle slots read back
 *  after each. */
async function step({ words, staged, bytes, groups }: Steps) {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('no WebGPU adapter')
  const { device } = gpu
  const { module, compilation } = await gpu.compile(PARTICLES_WGSL)
  if (compilation.length) throw new Error(compilation.join('\n'))
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module } })
  const { UNIFORM, STORAGE, COPY_DST, COPY_SRC, MAP_READ } = GPUBufferUsage
  const buffer = (size: number, usage: number) => device.createBuffer({ size, usage })
  const [uniform, records, state, read] = [
    buffer(32, UNIFORM | COPY_DST),
    buffer(staged.length * 4, STORAGE | COPY_DST),
    buffer(bytes, STORAGE | COPY_SRC),
    buffer(bytes, MAP_READ | COPY_DST),
  ]
  device.queue.writeBuffer(records, 0, new Float32Array(staged))
  const entries = [uniform, records, state].map((made, binding) => ({
    binding,
    resource: { buffer: made },
  }))
  const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })
  const images: number[][] = []
  for (const [n, steps] of [1, 62 * 144 - 1].entries()) {
    device.queue.writeBuffer(uniform, 0, new Uint32Array(words[n]))
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, group)
    for (let d = 0; d < steps; d++) pass.dispatchWorkgroups(groups)
    pass.end()
    encoder.copyBufferToBuffer(state, 0, read, 0, bytes)
    device.queue.submit([encoder.finish()])
    await read.mapAsync(GPUMapMode.READ)
    images.push(Array.from(new Float32Array(read.getMappedRange(), 0, 32)))
    read.unmap()
  }
  const adapter = (await gpu.fermer()).court
  return { adapter, images, errors: gpu.errors }
}

test('the particle step drifts, keeps what it must not move, and stops a dead life', async () => {
  const far = 10_000,
    dt = 1 / 144,
    pool = new ParticlePool({ capacity: 100, emitPerFrame: 4, origin: [far, 0, far] })
  pool.emit(far + 0.5, 2, far, 0.0576, 1, 0, 4) // drifts 0.4 mm along x in one step
  pool.emit(far, 3, far, 5, 5, 5, 0) // born dead: kept as staged, never moved
  pool.emit(far, 0, far, 0, 1, 0, 60) // a 60 s life
  const stepWords = createStepWords()
  const words = [0, 1].map(
    () => (
      pool.advance(dt),
      stepWords.write(pool, pool.flush()),
      [...new Uint32Array(stepWords.buffer)]
    ),
  )
  const pageErrors: string[] = []
  const { adapter, images, errors } = await runOnDawn(
    step,
    {
      words,
      staged: Array.from(pool.staging),
      bytes: pool.capacity * 32,
      groups: Math.ceil(pool.capacity / PARTICLE_WORKGROUP),
    },
    pageErrors,
  )
  assert.deepEqual([...errors, ...pageErrors], [], `WebGPU errors on ${adapter}`)
  const [particles, dead] = images,
    [x, y, , age] = particles
  assert.ok(Math.abs(x - (0.5 + 0.0576 * dt)) < 1e-6 && x > 0.5, `drifted 0.4 mm: x = ${x}`)
  assert.ok(y > 2 && age === Math.fround(dt), 'rose, and aged by the step')
  assert.deepEqual(particles.slice(8, 16), [0, 3, 0, 0, 5, 5, 5, 0], 'born dead: as staged')
  assert.deepEqual(particles.slice(24, 32), [0, 0, 0, 0, 0, 0, 0, 0], 'never emitted: untouched')
  const [, , , died, , , , lifetime] = dead.slice(16, 24)
  assert.ok(died >= lifetime && died < lifetime + 0.02, `died at 60 s, aged no more: ${died}`)
})
