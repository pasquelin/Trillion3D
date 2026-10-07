// The CPU half of the WebGPU particle step (#420): the words it hands the GPU for a pool, and a
// frame with a pool never held. What the GPU does with them is the recette's.
import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as tick } from 'node:timers/promises'
import { fakeDevice, written } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { holdWebgpuFrame, keepWebgpuFrame } from '../webgpu/frame/hold.ts'
import { settledRt } from '../webgpu/frame/hold.fixture.ts'
import { ParticlePool, type ParticlePoolSpec } from '../../../sdk-core/src/fluids/particles.ts'
import { createWebgpuParticles } from '../webgpu/particles/webgpuParticles.ts'
import { webgpuModel } from './stepModels.fixture.ts'
import { PARTICLES_PASS } from '../stage/passLabels.ts'

/** An encoder that records its compute passes and their dispatches, `window` for one the GPU
 *  sizes. */
function computeRecorder() {
  const passes: { label?: string; dispatches: (number | 'window')[] }[] = []
  const encoder = {
    beginComputePass: ({ label }: GPUComputePassDescriptor) => {
      const pass = { label, dispatches: [] as (number | 'window')[] }
      passes.push(pass)
      return {
        setPipeline() {},
        setBindGroup() {},
        dispatchWorkgroups: (x: number) => void pass.dispatches.push(x),
        dispatchWorkgroupsIndirect: () => void pass.dispatches.push('window'),
        end() {},
      }
    },
  } as unknown as GPUCommandEncoder
  return { encoder, passes }
}

test('WebGPU: one timed pass writes the step words and the staged records, once', async () => {
  const gpu = fakeDevice()
  const particles = createWebgpuParticles(gpu.device, (error) => assert.fail(String(error)))
  const pool = new ParticlePool({ capacity: 1000, emitPerFrame: 1000 })
  for (let i = 0; i < 3; i++) pool.emit(i, 1, 2, 3, 4, 5, 6)
  pool.advance(0.01)
  const { encoder, passes } = computeRecorder()
  assert.equal(particles.run([pool], encoder), 0, 'compiling: the pool waits, its records kept')
  await tick()
  assert.equal(particles.run([pool], encoder), 3)
  // The live window, sized by the GPU; the emitted slots; then the one workgroup that writes the
  // draw's window.
  assert.deepEqual(passes, [{ label: PARTICLES_PASS, dispatches: ['window', 1, 1] }])
  const [step, records] = gpu.writes
  const words = new Uint8Array(written(step)).buffer
  assert.deepEqual(
    [...new Float32Array(words, 0, 4)],
    [0, Math.fround(-9.81), 0, 0.01].map(Math.fround),
  )
  assert.deepEqual([...new Uint32Array(words, 16, 3)], [0, 3, 1000], 'first slot, count, capacity')
  assert.deepEqual([...written(records)], [...pool.staging.subarray(0, 24)])
  assert.equal(particles.run([pool], encoder), 0, 'nothing staged, no time: no pass')
  const made = 'state, staging, step, draw words, partials and window dispatch made once'
  assert.equal(gpu.buffers.length, 6, made)
  particles.run([], encoder)
  assert.equal(gpu.destroyed.length, 6, 'a pool the world let go of gives its buffers back')
})

test('WebGPU: a pool whose time runs before its first particle dispatches no empty workgroup grid', async () => {
  const particles = createWebgpuParticles(fakeDevice().device, (error) =>
    assert.fail(String(error)),
  )
  const pool = new ParticlePool({ capacity: 1000, emitPerFrame: 1000 })
  const { encoder, passes } = computeRecorder()
  particles.run([pool], encoder)
  await tick()
  pool.advance(0.01)
  // Time, and no slot: a dispatch would ask zero workgroups, which the device warns about.
  assert.equal(particles.run([pool], encoder), 0)
  assert.equal(passes.length, 0, 'no pass, no dispatch')
  pool.emit(0, 1, 2, 3, 4, 5, 6)
  pool.advance(0.01)
  assert.equal(particles.run([pool], encoder), 3)
  assert.deepEqual(passes[0].dispatches, ['window', 1, 1])
})

test('WebGPU: a step that cannot compile is heard, and its pools stop asking frames', async () => {
  const heard: unknown[] = [],
    { device } = fakeDevice({ compute: false })
  const particles = createWebgpuParticles(device, (error) => heard.push(error))
  const pool = new ParticlePool({ capacity: 8 })
  pool.emit(0, 0, 0, 0, 1, 0, 2)
  await tick()
  assert.equal(particles.run([pool], computeRecorder().encoder), 0)
  assert.deepEqual([heard.length, pool.moving, pool.emit(0, 0, 0, 0, 1, 0, 2)], [1, false, false])
})

test("WebGPU: a still frame is held until one of the world's pools moves", () => {
  const rt = settledRt(),
    { device } = fakeDevice()
  for (let i = 0; i < 2; i++) {
    rt.run.frame++
    keepWebgpuFrame(rt)
  }
  assert.equal(holdWebgpuFrame(rt, device), true, 'still, and no pool: held')
  const idle = new ParticlePool({ capacity: 8 })
  Object.assign(rt.context, { particles: [idle] })
  assert.equal(holdWebgpuFrame(rt, device), true, 'an idle pool changes nothing')
  idle.emit(0, 0, 0, 0, 1, 0, 2)
  assert.equal(holdWebgpuFrame(rt, device), false, 'a moving one does')
  assert.equal(rt.run.frameHeld, false)
})

/** Emits the same particles into every pool: speeds up to 5 m/s, lives of 1/4 to 2 s. */
function emitReference(pools: ParticlePool[], frame: number) {
  for (let n = 0; n < 5; n++) {
    const s = Math.sin(frame * 7 + n * 13)
    for (const pool of pools)
      pool.emit(n, 1, -n, 5 * s, 4 - n, 3 * s * s, 0.25 * (1 + n + (frame % 4)))
  }
}

test('the step words carry a reference emission along each ballistic path', async () => {
  const spec: ParticlePoolSpec = { capacity: 300, emitPerFrame: 8 },
    frames = 64
  const gpu = fakeDevice(),
    stepGpu = createWebgpuParticles(gpu.device, (error) => assert.fail(String(error)))
  await tick()
  const pool = new ParticlePool(spec),
    model = webgpuModel(spec.capacity)
  const { encoder } = computeRecorder()
  for (let frame = 0; frame < frames; frame++) {
    emitReference([pool], frame)
    pool.advance(1 / 64)
    const from = gpu.writes.length
    stepGpu.run([pool], encoder)
    model.step(gpu.writes[from], gpu.writes[from + 1])
  }
  // Each emission `n` starts at (n, 1, −n) with an upward speed 4 − n: under the pool's constant
  // acceleration its place at its age is the parabola's, whatever frame emitted it.
  const [ax, ay, az] = pool.acceleration
  let moved = 0
  for (let i = 0; i < spec.capacity; i++) {
    const [x, y, z, age, vx, vy, vz, lifetime] = model.particle(i)
    if (age === 0) continue
    moved++
    assert.ok(age <= lifetime + 1 / 64, `slot ${i}: aged past its life`)
    const start = [x - vx * age + 0.5 * ax * age * age, y - vy * age + 0.5 * ay * age * age]
    const n = Math.round(start[0])
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-3
    assert.ok(n >= 0 && n < 5 && near(start[0], n), `slot ${i}: x ${start[0]}`)
    assert.ok(near(start[1], 1) && near(vy - ay * age, 4 - n), `slot ${i}: y`)
    assert.ok(near(z - vz * age + 0.5 * az * age * age, -n), `slot ${i}: z`)
  }
  assert.ok(moved > 200, `${moved} particles stepped`)
})

// The device bounds a pool, no texture size: past its storage binding a pool is refused by name,
// once, and stops asking frames; one it binds is stepped.
test('WebGPU: a pool past the device storage binding is refused by name, told once', async () => {
  const heard: unknown[] = [],
    limits = { maxStorageBufferBindingSize: 1024, maxBufferSize: 1 << 20 }
  const particles = createWebgpuParticles(fakeDevice({ limits }).device, (e) => heard.push(e))
  const [wide, held] = [100, 8].map((capacity) => new ParticlePool({ capacity }))
  await tick()
  for (let frame = 0; frame < 2; frame++) {
    for (const pool of [wide, held]) {
      pool.emit(0, 0, 0, 0, 1, 0, 2)
      pool.advance(0.01)
    }
    particles.run([wide, held], computeRecorder().encoder)
  }
  const told = "Error: PARTICLE_CAPACITY: 100 particles, past the device's binding"
  assert.deepEqual(heard.map(String), [told])
  assert.deepEqual(
    [wide.refused, wide.moving, held.refused, held.moving],
    [true, false, false, true],
  )
})
