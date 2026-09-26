import { PARTICLE_FLOATS, type ParticlePool } from '../../../sdk-core/src/fluids/particles.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { createCheckedShaderModule } from '../gpu/core/shaderModule.ts';
import { PARTICLES_PASS, type ParticleBackend } from './backend.ts';

const WORKGROUP = 64;
/** The step uniform: acceleration and `dt`, then the ring's first slot, count and capacity. */
const STEP_BYTES = 32;

/** One invocation per slot: the record the ring gives it this image replaces it, then a live
 *  particle moves, its position counted from the pool's origin; a dead one nobody emitted into
 *  is left as it is. */
export const PARTICLES_WGSL = /* wgsl */ `
struct Particle { position: vec4f, velocity: vec4f }
struct Step { acceleration: vec3f, dt: f32, first: u32, count: u32, capacity: u32, pad: u32 }
@group(0) @binding(0) var<uniform> step: Step;
@group(0) @binding(1) var<storage, read> staged: array<Particle>;
@group(0) @binding(2) var<storage, read_write> particles: array<Particle>;
@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= step.capacity) { return; }
  let k = (i + step.capacity - step.first) % step.capacity;
  var p = particles[i];
  if (k < step.count) { p = staged[k]; } else if (p.position.w >= p.velocity.w) { return; }
  if (p.position.w < p.velocity.w) {
    let velocity = p.velocity.xyz + step.acceleration * step.dt;
    p.velocity = vec4f(velocity, p.velocity.w);
    p.position = vec4f(p.position.xyz + velocity * step.dt, p.position.w + step.dt);
  }
  particles[i] = p;
}`;

type PoolState = { step: GPUBuffer; staged: GPUBuffer; state: GPUBuffer; group: GPUBindGroup };

/**
 * The WebGPU particle step: one compute pass, timed under `PARTICLES_PASS`, one dispatch per pool
 * that has records or time to take. A pool's state is one storage buffer made the first time it
 * is stepped; its records ride in a staging buffer of the pool's size, written up to the image's
 * count. The pipeline compiles in the background; until it arrives no pool is taken, so what they
 * stage waits. `fail` hears a pipeline that could not be made.
 */
export function createWebgpuParticles(
  device: GPUDevice,
  fail: (error: unknown) => void,
): ParticleBackend<GPUCommandEncoder> {
  const layout = device.createBindGroupLayout({
    label: PARTICLES_PASS,
    entries: (['uniform', 'read-only-storage', 'storage'] as const).map((type, binding) => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type },
    })),
  });
  let pipeline: GPUComputePipeline | undefined;
  createCheckedShaderModule(device, PARTICLES_WGSL, 'PARTICLES')
    .then((module) =>
      device.createComputePipelineAsync({
        label: PARTICLES_PASS,
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        compute: { module, entryPoint: 'main' },
      }),
    )
    .then((made) => (pipeline = made), fail);
  const words = new ArrayBuffer(STEP_BYTES),
    floats = new Float32Array(words),
    uints = new Uint32Array(words);
  const pass: GPUComputePassDescriptor = { label: PARTICLES_PASS },
    made = new Map<ParticlePool, PoolState>();
  const buffer = (name: string, size: number, usage: number) =>
    device.createBuffer({ label: `${PARTICLES_PASS} ${name}`, size, usage });
  const make = (pool: ParticlePool) => {
    const { STORAGE, UNIFORM, COPY_DST } = GPUBufferUsage;
    const step = buffer('step', STEP_BYTES, UNIFORM | COPY_DST),
      staged = buffer('staging', pool.staging.byteLength, STORAGE | COPY_DST),
      state = buffer('state', pool.capacity * PARTICLE_FLOATS * 4, STORAGE);
    const group = device.createBindGroup({
      layout,
      entries: [step, staged, state].map((b, binding) => ({ binding, resource: { buffer: b } })),
    });
    const kept = { step, staged, state, group };
    made.set(pool, kept);
    return kept;
  };
  return {
    run(pools, encoder) {
      if (!pipeline) return 0;
      let computing: GPUComputePassEncoder | undefined,
        dispatches = 0;
      for (const pool of pools) {
        const { first, count, dt } = pool.flush();
        if (!count && !dt) continue;
        const kept = made.get(pool) ?? make(pool);
        floats.set(pool.acceleration);
        floats[3] = dt;
        uints[4] = first;
        uints[5] = count;
        uints[6] = pool.capacity;
        device.queue.writeBuffer(kept.step, 0, words);
        if (count)
          device.queue.writeBuffer(kept.staged, 0, pool.staging, 0, count * PARTICLE_FLOATS);
        computing ??= encoder.beginComputePass(pass);
        computing.setPipeline(pipeline);
        computing.setBindGroup(0, kept.group);
        computing.dispatchWorkgroups(Math.ceil(pool.capacity / WORKGROUP));
        dispatches++;
      }
      computing?.end();
      return dispatches;
    },
    dispose() {
      for (const { step, staged, state } of made.values())
        for (const gone of [step, staged, state]) gone.destroy();
      made.clear();
    },
  };
}

/** The world's pools on this image, stepped in the image's command buffer ahead of its
 *  transparent stage, which draws them (#755). */
export function encodeParticles(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const pools = rt.context.particles;
  if (!pools?.length) return;
  rt.gpu.particles ??= createWebgpuParticles(device, (error) =>
    rt.diag.diagnosticFailure('particles-unavailable', error),
  );
  rt.run.gpuComputeDispatches += rt.gpu.particles.run(pools, encoder);
}
