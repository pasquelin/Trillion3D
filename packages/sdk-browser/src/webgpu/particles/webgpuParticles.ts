import { PARTICLE_FLOATS, type ParticlePool } from '../../../../sdk-core/src/fluids/particles.ts';
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts';
import { buildComputePipeline } from '../../lighting/deferred/fullscreen.ts';
import { bounceGroup, bounceLayout } from '../../bounce/bindings.ts';
import { createPoolStates, usedSlots } from '../../particles/poolStates.ts';
import { createWebgpuParticleDraw, type DrawState } from './webgpuParticleDraw.ts';
import { DRAW_FLOATS } from '../../particles/drawWords.ts';
import { PARTICLES_WGSL, PARTICLE_WORKGROUP } from './particlesWgsl.ts';
import { createStepWords } from '../../particles/stepWords.ts';
import { PARTICLES_PASS } from '../../stage/passLabels.ts';
import { LazyComputePass } from '../../gpu/core/lazyComputePass.ts';

type PoolState = DrawState & { step: GPUBuffer; staged: GPUBuffer; group: GPUBindGroup };

/**
 * The WebGPU particle step: one compute pass, timed under `PARTICLES_PASS`, one dispatch per pool
 * that has records or time to take. A pool's state is one storage buffer made the first time it
 * is stepped; its records ride in a staging buffer of the pool's size, written up to the image's
 * count. The pipeline compiles in the background; until it arrives no pool is taken, so what they
 * stage waits. `fail` hears a pipeline that could not be made, and every pool is then `refused`.
 */
export function createWebgpuParticles(device: GPUDevice, fail: (error: unknown) => void) {
  const layout = bounceLayout(device, ['uniform', 'read-only-storage', 'storage']);
  let pipeline: GPUComputePipeline | null | undefined;
  createCheckedShaderModule(device, PARTICLES_WGSL, 'PARTICLES')
    .then((module) =>
      buildComputePipeline(device, {
        label: PARTICLES_PASS,
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        compute: { module, entryPoint: 'main' },
      }),
    )
    .then((made) => (pipeline = made))
    .catch((error) => ((pipeline = null), fail(error)));
  const words = createStepWords();
  const pass = new LazyComputePass(PARTICLES_PASS);
  const buffer = (name: string, size: number, usage: number) =>
    device.createBuffer({ label: `${PARTICLES_PASS} ${name}`, size, usage });
  const made = createPoolStates<PoolState>(
    (pool) => {
      const { STORAGE, UNIFORM, COPY_DST } = GPUBufferUsage;
      const step = buffer('step', words.buffer.byteLength, UNIFORM | COPY_DST),
        staged = buffer('staging', pool.staging.byteLength, STORAGE | COPY_DST),
        state = buffer('state', pool.capacity * PARTICLE_FLOATS * 4, STORAGE),
        draw = buffer('draw', DRAW_FLOATS * 4, UNIFORM | COPY_DST),
        group = bounceGroup(device, layout, [step, staged, state]);
      return { step, staged, state, draw, group };
    },
    (kept) => [kept.step, kept.staged, kept.state, kept.draw].forEach((gone) => gone.destroy()),
  );
  const drawn = createWebgpuParticleDraw(device, made.peek, fail);
  return {
    /** Steps `pools` in `encoder`; returns the dispatches encoded. */
    run(pools: readonly ParticlePool[], encoder: GPUCommandEncoder) {
      if (pipeline === undefined) return 0;
      let dispatches = 0;
      pass.begin(encoder);
      for (const pool of pools) {
        pool.refused = !pipeline || drawn.refused();
        const step = pool.flush(),
          { count } = step,
          slots = usedSlots(pool);
        // A pool that never emitted holds no slot to move: its dispatch would have no workgroup.
        if (!pipeline || pool.refused || (!count && !step.dt) || !slots) continue;
        const kept = made.of(pool);
        words.write(pool, step);
        device.queue.writeBuffer(kept.step, 0, words.buffer);
        if (count)
          device.queue.writeBuffer(kept.staged, 0, pool.staging, 0, count * PARTICLE_FLOATS);
        const computing = pass.pass;
        if (!dispatches) computing.setPipeline(pipeline);
        computing.setBindGroup(0, kept.group);
        computing.dispatchWorkgroups(Math.ceil(slots / PARTICLE_WORKGROUP));
        dispatches++;
      }
      pass.end();
      made.keep(pools);
      return dispatches;
    },
    draw: drawn.draw,
    askRouted: drawn.askRouted,
    dispose: made.dispose,
  };
}

export type WebgpuParticles = ReturnType<typeof createWebgpuParticles>;
