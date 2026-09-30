import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { anyMoving, refuseAll } from './poolStates.ts';
import { viewProj } from '../webgpu/pages/helpers.ts';
import { routedFilter } from '../webgpu/blend/displayFilter.ts';
import { particleCodeFor } from './particleFamily.ts';

/** The pass label the GPU timings name the particle step by (`passesGpu`). */
export const PARTICLES_PASS = 'Trillion3D particles';
/** The pass label the GPU timings name the particle draw by (`passesGpu`). */
export const PARTICLE_DRAW_PASS = 'Trillion3D particle draw';

/** True while one of the world's pools moves: the image changes, and is not held. */
export const particlesMoved = (rt: WebgpuPagesRuntime) => anyMoving(rt.context.particles);

/** The world's pools on this image, stepped in the image's command buffer ahead of its
 *  transparent stage, which draws them (#755), once a frame whatever the views drawn. */
export function encodeParticles(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const pools = rt.context.particles;
  // Once made, the step runs with no pool left too: it gives a released pool's buffers back.
  if (!pools || (!pools.length && !rt.gpu.particles)) return;
  if (!rt.vis.visEnabled) {
    // A capability refusal, told once like WebGL2's (`particlesRefused`); the session goes on.
    if (refuseAll(pools))
      rt.context.particlesRefused?.(
        'PARTICLES_UNSUPPORTED: particles draw on the visibility buffer',
      );
    // A visibility buffer dropped mid-session: the step made before it gives its buffers back.
    rt.gpu.particles?.dispose();
    rt.gpu.particles = undefined;
    return;
  }
  // One step a frame, the main view's: a view drawn beside it draws the pools as they stand.
  if (rt.views.active !== rt.views.main) return;
  if (!rt.gpu.particles) {
    // The step's code, which the frame waited for (`../host/families.ts`); a refused import
    // refuses the pools, once.
    const fail = (error: unknown) => rt.diag.diagnosticFailure('particles-unavailable', error);
    const code = particleCodeFor(pools, fail);
    if (!code) return;
    rt.gpu.particles = code.createWebgpuParticles(device, fail);
  }
  rt.run.gpuComputeDispatches += rt.gpu.particles.run(pools, encoder);
}

/** Whether this image draws the world's pools: it has some, and shows beauty. */
export const drawsParticles = (rt: Pick<WebgpuPagesRuntime, 'context' | 'run'>) =>
  !!rt.context.particles && rt.run.diagnostic === 'beauty';

/** What this image draws the pools with, once a camera and the targets are; else `undefined`. */
function particleDrawOf(rt: WebgpuPagesRuntime) {
  const { hdrView, depthView, asIsShare, particles } = rt.gpu;
  const pools = rt.context.particles;
  if (!pools || !particles || !hdrView || !depthView || !asIsShare || !rt.run.lastCamera) return;
  if (drawsParticles(rt)) return { pools, particles, hdrView, depthView, reactive: asIsShare.view };
}

/** The stepped pools over the lit image and its transparents, in beauty, their coverage the reactive
 *  value (`asIsShare.ts`); `tone`, the exposure and curve (`directTiles`), shows a routed disc. */
export function drawParticles(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  tone: ArrayLike<number>,
) {
  const drawn = particleDrawOf(rt),
    { run } = rt;
  if (!drawn) return;
  run.gpuDrawCalls += drawn.particles.draw(
    drawn.pools,
    encoder,
    drawn.hdrView,
    drawn.reactive,
    drawn.depthView,
    rt.gpu.targetSize,
    viewProj,
    run.gate.cam.eye,
    routedFilter(rt.gpu.displayFilter),
    tone,
    rt.lights.store.unlit,
  );
}
