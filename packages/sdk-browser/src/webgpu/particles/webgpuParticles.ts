import { PARTICLE_FLOATS, type ParticlePool } from '../../../../sdk-core/src/fluids/particles.ts'
import { hasSubgroups } from '../../gpu/core/subgroups.ts'
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { buildComputePipeline } from '../../lighting/deferred/fullscreen.ts'
import { bounceGroup, bounceLayout } from '../../bounce/bindings.ts'
import { createPoolStates, usedSlots } from '../../particles/poolStates.ts'
import { createWebgpuParticleDraw, type DrawState } from './webgpuParticleDraw.ts'
import { DRAW_FLOATS } from '../../particles/drawWords.ts'
import { dispatchGrid } from '../../gpu/dag/shader/gridWgsl.ts'
import {
  DISC_VERTICES,
  particleGroups,
  particlesWgsl,
  PARTICLE_ARGS_BYTES,
  PARTICLE_PARTIAL_BYTES,
  PARTICLE_STATE_HEAD,
} from './particlesWgsl.ts'
import { createStepWords } from '../../particles/stepWords.ts'
import { PARTICLES_PASS } from '../../stage/passLabels.ts'
import { LazyComputePass } from '../../gpu/core/lazyComputePass.ts'
import { storageBufferCap } from '../../residency/pools.ts'

type PoolState = DrawState & {
  step: GPUBuffer
  staged: GPUBuffer
  partials: GPUBuffer
  args: GPUBuffer
  group: GPUBindGroup
  bounds: GPUBindGroup
}

/** The pipelines of the step's three entries (`particlesWgsl`). */
type StepPipelines = {
  main: GPUComputePipeline
  emit: GPUComputePipeline
  bound: GPUComputePipeline
}

/** Bytes of `pool`'s state: the window the draw reads its arguments from, then its slots. */
const stateBytes = (pool: ParticlePool) => PARTICLE_STATE_HEAD + pool.capacity * PARTICLE_FLOATS * 4

/**
 * The WebGPU particle step: one compute pass, timed under `PARTICLES_PASS`, per pool that has
 * records or time to take the step of its live window — its workgroups the dispatch its last
 * `bound` wrote, read by the GPU (`dispatchWorkgroupsIndirect`), never by the CPU —, the step of
 * this image's records when it has some, then its `bound`, which folds both into the window the
 * draw reads its indirect arguments from (`particlesWgsl`, folded by subgroup where the device has
 * them): every pool's window under one pipeline, every pool's records under the next, every
 * pool's bound under the last. A pool's partial windows, one a workgroup, sit in a buffer of their
 * own; its window dispatch in another, bound writable by `bound` alone, so no dispatch reads its
 * arguments from a buffer it writes. A pool's state is one storage buffer made the first time it
 * is stepped, as large as the device binds: a pool past it is refused by name
 * (`PARTICLE_CAPACITY`), told once. Its records ride in a staging buffer of the pool's per-image
 * emission (`ParticlePool.emitPerFrame`), written up to the image's count. The pipelines compile in
 * the background; until they arrive no pool is taken, so what they stage waits. `fail` hears a
 * pipeline that could not be made, and every pool is then `refused`.
 */
export function createWebgpuParticles(device: GPUDevice, fail: (error: unknown) => void) {
  const STEP_SLOTS = ['uniform', 'read-only-storage', 'storage', 'storage'] as const
  const layout = bounceLayout(device, [...STEP_SLOTS]),
    boundLayout = bounceLayout(device, [...STEP_SLOTS, 'storage'])
  let pipeline: StepPipelines | null | undefined
  compileStep(device, layout, boundLayout)
    .then((made) => (pipeline = made))
    .catch((error) => ((pipeline = null), fail(error)))
  const most = storageBufferCap(device.limits),
    told = new WeakSet<ParticlePool>()
  /** Whether the device binds `pool`'s state; a pool it does not is told once, by name. */
  const holds = (pool: ParticlePool) => {
    if (stateBytes(pool) <= most) return true
    if (!told.has(pool))
      fail(new Error(`PARTICLE_CAPACITY: ${pool.capacity} particles, past the device's binding`))
    told.add(pool)
    return false
  }
  const words = createStepWords()
  const pass = new LazyComputePass(PARTICLES_PASS)
  const made = createPoolStates<PoolState>(
    (pool) => makeState(device, pool, words.buffer.byteLength, { layout, boundLayout }),
    (kept) =>
      [kept.step, kept.staged, kept.state, kept.draw, kept.partials, kept.args].forEach((gone) =>
        gone.destroy(),
      ),
  )
  // The pools stepped this image: their states and record workgroups, kept from image to image.
  const stepped: PoolState[] = [],
    records: number[] = []
  const drawn = createWebgpuParticleDraw(device, made.peek, fail)
  return {
    /** Steps `pools` in `encoder`; returns the dispatches encoded. */
    run(pools: readonly ParticlePool[], encoder: GPUCommandEncoder) {
      if (pipeline === undefined) return 0
      stepped.length = records.length = 0
      for (const pool of pools) {
        pool.refused = !pipeline || drawn.refused() || !holds(pool)
        const step = pool.flush(),
          { count } = step
        // A pool that never emitted holds no slot to move.
        if (!pipeline || pool.refused || (!count && !step.dt) || !usedSlots(pool)) continue
        const kept = made.of(pool),
          groups = particleGroups(count)
        words.write(pool, step, groups)
        device.queue.writeBuffer(kept.step, 0, words.buffer)
        if (count)
          device.queue.writeBuffer(kept.staged, 0, pool.staging, 0, count * PARTICLE_FLOATS)
        stepped.push(kept)
        records.push(groups)
      }
      made.keep(pools)
      if (!pipeline || !stepped.length) return 0
      return encodeSteps(pass.begin(encoder).pass, pipeline, stepped, records, () => pass.end())
    },
    draw: drawn.draw,
    askRouted: drawn.askRouted,
    dispose: made.dispose,
  }
}

/** The step's three pipelines, compiled off the thread: folded by subgroup where the device has
 *  them, through workgroup memory elsewhere. */
async function compileStep(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  boundLayout: GPUBindGroupLayout,
): Promise<StepPipelines> {
  const module = await createCheckedShaderModule(
    device,
    particlesWgsl(hasSubgroups(device)),
    'PARTICLES',
  )
  const build = (entryPoint: string, bindGroupLayout: GPUBindGroupLayout) =>
    buildComputePipeline(device, {
      label: `${PARTICLES_PASS} ${entryPoint}`,
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: { module, entryPoint },
    })
  const [main, emit, bound] = await Promise.all([
    build('main', layout),
    build('emit', layout),
    build('bound', boundLayout),
  ])
  return { main, emit, bound }
}

/** `pool`'s buffers and groups: its step words, staged records, state — a disc's vertices and no
 *  instance until the first window is written —, draw words, partial windows (the window's
 *  workgroups, then the records') and window dispatch — no workgroup until then. */
function makeState(
  device: GPUDevice,
  pool: ParticlePool,
  stepBytes: number,
  layouts: { layout: GPUBindGroupLayout; boundLayout: GPUBindGroupLayout },
): PoolState {
  const { STORAGE, UNIFORM, COPY_DST, INDIRECT } = GPUBufferUsage
  const buffer = (name: string, size: number, usage: number, words?: number[]) => {
    const made = device.createBuffer({
      label: `${PARTICLES_PASS} ${name}`,
      size,
      usage,
      mappedAtCreation: !!words,
    })
    if (words) {
      new Uint32Array(made.getMappedRange(0, words.length * 4)).set(words)
      made.unmap()
    }
    return made
  }
  const ring = pool.staging.length / PARTICLE_FLOATS
  const step = buffer('step', stepBytes, UNIFORM | COPY_DST),
    staged = buffer('staging', pool.staging.byteLength, STORAGE | COPY_DST),
    state = buffer('state', stateBytes(pool), STORAGE | INDIRECT, [DISC_VERTICES]),
    draw = buffer('draw', DRAW_FLOATS * 4, UNIFORM | COPY_DST),
    partials = buffer(
      'partials',
      (particleGroups(pool.capacity) + particleGroups(ring)) * PARTICLE_PARTIAL_BYTES,
      STORAGE,
    ),
    args = buffer('window dispatch', PARTICLE_ARGS_BYTES, STORAGE | INDIRECT, [0, 1, 1])
  const steps = [step, staged, state, partials]
  const group = bounceGroup(device, layouts.layout, steps),
    bounds = bounceGroup(device, layouts.boundLayout, [...steps, args])
  return { step, staged, state, draw, partials, args, group, bounds }
}

/** Every pool's window under `main`, every pool's records under `emit`, every pool's bound under
 *  `bound`, in `computing`, closed by `end`; returns the dispatches encoded. */
function encodeSteps(
  computing: GPUComputePassEncoder,
  pipeline: StepPipelines,
  stepped: readonly PoolState[],
  records: readonly number[],
  end: () => void,
) {
  let dispatches = 0
  computing.setPipeline(pipeline.main)
  for (const { group, args } of stepped) {
    computing.setBindGroup(0, group)
    computing.dispatchWorkgroupsIndirect(args, 0)
    dispatches++
  }
  if (records.some(Boolean)) {
    computing.setPipeline(pipeline.emit)
    stepped.forEach(({ group }, at) => {
      if (!records[at]) return
      computing.setBindGroup(0, group)
      // In rows past one dimension's groups (`dispatchGrid`): `emit` reads its flat index.
      const [x, y] = dispatchGrid(records[at])
      computing.dispatchWorkgroups(x, y)
      dispatches++
    })
  }
  computing.setPipeline(pipeline.bound)
  for (const { bounds } of stepped) {
    computing.setBindGroup(0, bounds)
    computing.dispatchWorkgroups(1)
    dispatches++
  }
  end()
  return dispatches
}

export type WebgpuParticles = ReturnType<typeof createWebgpuParticles>
