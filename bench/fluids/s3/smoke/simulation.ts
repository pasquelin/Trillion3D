import {
  SMOKE_ADVECTION,
  SMOKE_DIVERGENCE,
  SMOKE_PRESSURE,
  SMOKE_PROJECTION,
} from './computeWgsl.ts';
import { smokeCompute, smokeGroup } from './gpu.ts';
import { SMOKE_PASSES, type SmokeSpec } from './plan.ts';
import type { SmokeResources } from './resources.ts';

export async function smokeSimulation(device: GPUDevice, spec: SmokeSpec, r: SmokeResources) {
  const advection = await smokeCompute(
    device,
    SMOKE_ADVECTION,
    ['uniform', 'state', 'linear', 'stateOut'],
    SMOKE_PASSES[0],
  );
  const divergence = await smokeCompute(
    device,
    SMOKE_DIVERGENCE,
    ['uniform', 'state', 'scalarOut', 'scalarOut'],
    SMOKE_PASSES[1],
  );
  const pressure = await smokeCompute(
    device,
    SMOKE_PRESSURE,
    ['uniform', 'scalar', 'scalar', 'scalarOut'],
    SMOKE_PASSES[2],
  );
  const projection = await smokeCompute(
    device,
    SMOKE_PROJECTION,
    ['uniform', 'state', 'scalar', 'stateOut'],
    SMOKE_PASSES[3],
  );
  const uniform = { buffer: r.step };
  const groups = [
    smokeGroup(device, advection.layout, [uniform, r.state[0], r.sampler, r.state[1]]),
    smokeGroup(device, divergence.layout, [uniform, r.state[1], r.divergence, r.pressure[0]]),
    ...[0, 1].map((i) =>
      smokeGroup(device, pressure.layout, [
        uniform,
        r.pressure[i],
        r.divergence,
        r.pressure[1 - i],
      ]),
    ),
    smokeGroup(device, projection.layout, [
      uniform,
      r.state[1],
      r.pressure[spec.iterations % 2],
      r.state[0],
    ]),
  ];
  let time = 0;
  const values = new Float32Array([spec.grid, 0, 0, 0]);
  const pipelines = [advection, divergence, pressure, projection];
  const descriptors = SMOKE_PASSES.slice(0, 4).map((label) => ({ label }));
  const dispatch = (pass: GPUComputePassEncoder, group: GPUBindGroup) => {
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(spec.grid / 4, spec.grid / 4, spec.grid / 4);
  };
  return (encoder: GPUCommandEncoder, dt: number) => {
    time += dt;
    values[1] = dt;
    values[2] = time;
    device.queue.writeBuffer(r.step, 0, values);
    for (let i = 0; i < pipelines.length; i++) {
      const pass = encoder.beginComputePass(descriptors[i]);
      pass.setPipeline(pipelines[i].pipeline);
      if (i === 2) for (let j = 0; j < spec.iterations; j++) dispatch(pass, groups[2 + (j % 2)]);
      else dispatch(pass, groups[i === 3 ? 4 : i]);
      pass.end();
    }
  };
}
