// The engine's particle step (#420) on a real GPU: the committed WGSL compiles, and one step of a
// pool ten kilometres from the world origin moves a newborn particle by its 0.4 mm drift, leaves
// one born dead and a slot nobody emitted into as they are; a 60 s life dies after 60 s of 144 Hz
// steps and ages no more (#759). After each image the window the draw reads its indirect arguments
// from holds the live slots' span: four vertices, as many instances as from the first live slot to
// the last, none once all are dead (#755) — across workgroups too, their partial windows folded by
// `bound`; each step covers that window, its workgroups the dispatch `bound` wrote, and the
// image's records. Both folds of a workgroup's lanes, by subgroup where the device has them and through
// workgroup memory, give the same window. The words are the engine's: the pool stages the
// records, `createStepWords` writes the uniform; only this proof reads the state back.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ParticlePool } from '../../../packages/sdk-core/src/fluids/particles.ts'
import {
  particlesWgsl,
  DISC_VERTICES,
  particleGroups,
  PARTICLE_ARGS_BYTES,
  PARTICLE_PARTIAL_BYTES,
  PARTICLE_STATE_HEAD,
} from '../../../packages/sdk-browser/src/webgpu/particles/particlesWgsl.ts'
import { createStepWords } from '../../../packages/sdk-browser/src/particles/stepWords.ts'
import { runOnDawn } from '../kit/onDawn.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'

type Steps = { words: number[][]; staged: number[]; capacity: number; runs: number[][] }

/** Images of `runs` (`[words, steps]`) under each fold the device has: after each, the window's
 *  eight words and the first eight particle slots read back. */
async function step({ words, staged, capacity, runs }: Steps) {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('no WebGPU adapter')
  const { device } = gpu
  const folds = [false, ...(device.features.has('subgroups') ? [true] : [])]
  const { COMPUTE } = GPUShaderStage
  const slots = ['uniform', 'read-only-storage', 'storage', 'storage', 'storage'] as const
  const [layout, boundLayout] = [4, 5].map((count) =>
    device.createBindGroupLayout({
      entries: slots
        .slice(0, count)
        .map((type, binding) => ({ binding, visibility: COMPUTE, buffer: { type } })),
    }),
  )
  const { UNIFORM, STORAGE, INDIRECT, COPY_DST, COPY_SRC, MAP_READ } = GPUBufferUsage
  const buffer = (size: number, usage: number) => device.createBuffer({ size, usage })
  const groups = particleGroups(capacity) + particleGroups(staged.length / 8),
    read = PARTICLE_STATE_HEAD + 8 * 32
  const byFold: { subgroups: boolean; window: number[]; particles: number[] }[][] = []
  for (const subgroups of folds) {
    const { module, compilation } = await gpu.compile(particlesWgsl(subgroups))
    if (compilation.length) throw new Error(compilation.join('\n'))
    const [main, emit, bound] = (['main', 'emit', 'bound'] as const).map((entryPoint) =>
      device.createComputePipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [entryPoint === 'bound' ? boundLayout : layout],
        }),
        compute: { module, entryPoint },
      }),
    )
    const [uniform, records, state, partials, args, out] = [
      buffer(32, UNIFORM | COPY_DST),
      buffer(staged.length * 4, STORAGE | COPY_DST),
      buffer(PARTICLE_STATE_HEAD + capacity * 32, STORAGE | INDIRECT | COPY_DST | COPY_SRC),
      buffer(groups * PARTICLE_PARTIAL_BYTES, STORAGE),
      buffer(PARTICLE_ARGS_BYTES, STORAGE | INDIRECT | COPY_DST),
      buffer(read, MAP_READ | COPY_DST),
    ]
    device.queue.writeBuffer(records, 0, new Float32Array(staged))
    device.queue.writeBuffer(state, 0, new Uint32Array([DISC_VERTICES]))
    device.queue.writeBuffer(args, 0, new Uint32Array([0, 1, 1]))
    const entries = [uniform, records, state, partials, args].map((made, binding) => ({
      binding,
      resource: { buffer: made },
    }))
    const group = device.createBindGroup({ layout, entries: entries.slice(0, 4) }),
      bounds = device.createBindGroup({ layout: boundLayout, entries })
    const images: (typeof byFold)[number] = []
    for (const [n, steps] of runs) {
      device.queue.writeBuffer(uniform, 0, new Uint32Array(words[n]))
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginComputePass()
      for (let d = 0; d < steps; d++) {
        pass.setBindGroup(0, group)
        pass.setPipeline(main)
        pass.dispatchWorkgroupsIndirect(args, 0)
        if (words[n][7]) {
          pass.setPipeline(emit)
          pass.dispatchWorkgroups(words[n][7])
        }
        pass.setBindGroup(0, bounds)
        pass.setPipeline(bound)
        pass.dispatchWorkgroups(1)
      }
      pass.end()
      encoder.copyBufferToBuffer(state, 0, out, 0, read)
      device.queue.submit([encoder.finish()])
      await out.mapAsync(GPUMapMode.READ)
      const range = out.getMappedRange()
      images.push({
        subgroups,
        window: Array.from(new Uint32Array(range, 0, 8)),
        particles: Array.from(new Float32Array(range, PARTICLE_STATE_HEAD, 64)),
      })
      out.unmap()
    }
    byFold.push(images)
  }
  const adapter = (await gpu.fermer()).court
  return { adapter, byFold, errors: gpu.errors }
}

/** The step words of `pool`'s next `images` images of `dt`, its workgroups its records'. */
function stepWords(pool: ParticlePool, dt: number, images: number) {
  const stepWords = createStepWords()
  return Array.from({ length: images }, () => {
    pool.advance(dt)
    const step = pool.flush()
    stepWords.write(pool, step, particleGroups(step.count))
    return [...new Uint32Array(stepWords.buffer)]
  })
}

/** Runs `steps` on Dawn; every fold's images, the same windows under each. */
async function onDawn(steps: Steps) {
  const pageErrors: string[] = []
  const { adapter, byFold, errors } = await runOnDawn(step, steps, pageErrors)
  assert.deepEqual([...errors, ...pageErrors], [], `WebGPU errors on ${adapter}`)
  console.log(`${adapter}: folds ${byFold.map((images) => images[0].subgroups).join(', ')}`)
  for (const images of byFold.slice(1))
    assert.deepEqual(
      images.map(({ window, particles }) => [window, particles]),
      byFold[0].map(({ window, particles }) => [window, particles]),
      'the subgroup fold steps and bounds as the array fold',
    )
  return byFold[0]
}

test('the particle step drifts, keeps what it must not move, stops a dead life, bounds the draw', async () => {
  const far = 10_000,
    dt = 1 / 144,
    pool = new ParticlePool({ capacity: 100, emitPerFrame: 4, origin: [far, 0, far] })
  pool.emit(far + 0.5, 2, far, 0.0576, 1, 0, 4) // drifts 0.4 mm along x in one step
  pool.emit(far, 3, far, 5, 5, 5, 0) // born dead: kept as staged, never moved
  pool.emit(far, 0, far, 0, 1, 0, 60) // a 60 s life
  const [first, middle, last] = await onDawn({
    words: stepWords(pool, dt, 2),
    staged: Array.from(pool.staging),
    capacity: pool.capacity,
    runs: [
      [0, 1],
      [1, 10 * 144 - 1],
      [1, 52 * 144],
    ],
  })
  const { particles } = first,
    [x, y, , age] = particles
  assert.ok(Math.abs(x - (0.5 + 0.0576 * dt)) < 1e-6 && x > 0.5, `drifted 0.4 mm: x = ${x}`)
  assert.ok(y > 2 && age === Math.fround(dt), 'rose, and aged by the step')
  assert.deepEqual(particles.slice(8, 16), [0, 3, 0, 0, 5, 5, 5, 0], 'born dead: as staged')
  assert.deepEqual(particles.slice(24, 32), [0, 0, 0, 0, 0, 0, 0, 0], 'never emitted: untouched')
  const [, , , died, , , , lifetime] = last.particles.slice(16, 24)
  assert.ok(died >= lifetime && died < lifetime + 0.02, `died at 60 s, aged no more: ${died}`)
  // Four vertices, instances, first vertex and instance, the first slot, three pad words.
  assert.deepEqual(first.window, [4, 3, 0, 0, 0, 0, 0, 0], 'slots 0 to 2, the dead one between')
  assert.deepEqual(middle.window, [4, 1, 0, 0, 2, 0, 0, 0], 'at 10 s, slot 2 alone')
  assert.deepEqual(last.window, [4, 0, 0, 0, 0, 0, 0, 0], 'all dead: no instance')
})

test('the window spans the live slots of several workgroups, the dead between kept', async () => {
  const pool = new ParticlePool({ capacity: 300, emitPerFrame: 300 })
  // Slots 70 and 250 live, in the second and fourth workgroups; every other one born dead.
  for (let slot = 0; slot <= 260; slot++)
    pool.emit(0, 0, 0, 0, 1, 0, slot === 70 || slot === 250 ? 9 : 0)
  const [image] = await onDawn({
    words: stepWords(pool, 1 / 60, 1),
    staged: Array.from(pool.staging),
    capacity: pool.capacity,
    runs: [[0, 1]],
  })
  assert.deepEqual(image.window, [4, 250 + 1 - 70, 0, 0, 70, 0, 0, 0], 'slots 70 to 250')
})
