import { smokeDraw } from './draw.ts';
import type { SmokeFrame, SmokeSpec } from './plan.ts';
import { smokeResources } from './resources.ts';
import { smokeSimulation } from './simulation.ts';
export type { SmokeFrame, SmokeSpec } from './plan.ts';

/** One encode per submitted frame; uniforms are shared within this bounded workload. */
export async function createSmoke(device: GPUDevice, spec: SmokeSpec) {
  const resources = smokeResources(device, spec);
  try {
    const simulate = await smokeSimulation(device, spec, resources);
    const draw = await smokeDraw(device, spec, resources);
    let disposed = false;
    return {
      info: resources.plan,
      encode(encoder: GPUCommandEncoder, frame: SmokeFrame) {
        if (disposed) throw new Error('FLUID_SMOKE_DISPOSED: cannot encode disposed resources');
        if (!Number.isFinite(frame.dt) || frame.dt < 0 || frame.dt > 1 / 30 + 1e-8)
          throw new Error('FLUID_SMOKE_STEP: one step of at most 1/30 second required');
        let validCamera = frame.inverseViewProjection.length === 16;
        for (let i = 0; i < 16; i++)
          validCamera &&= Number.isFinite(frame.inverseViewProjection[i]);
        if (!validCamera)
          throw new Error('FLUID_SMOKE_CAMERA: finite inverse view projection required');
        if (frame.dt > 0) simulate(encoder, frame.dt);
        draw(encoder, frame);
      },
      dispose() {
        disposed = true;
        resources.dispose();
      },
    };
  } catch (error) {
    resources.dispose();
    throw error;
  }
}
