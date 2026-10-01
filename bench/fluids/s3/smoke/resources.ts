import { smokePlan, type SmokeSpec } from './plan.ts';

export function smokeResources(device: GPUDevice, spec: SmokeSpec) {
  const plan = smokePlan(spec);
  if (
    spec.grid > device.limits.maxTextureDimension3D ||
    Math.max(spec.width, spec.height) > device.limits.maxTextureDimension2D
  )
    throw new Error('FLUID_SMOKE_LIMIT: texture dimensions exceed device limits');
  const owned: (GPUTexture | GPUBuffer)[] = [];
  const dispose = () => {
    for (const resource of owned.splice(0)) resource.destroy();
  };
  const texture = (format: GPUTextureFormat, volume: boolean) => {
    const result = device.createTexture({
      format,
      dimension: volume ? '3d' : '2d',
      size: volume ? [spec.grid, spec.grid, spec.grid] : [plan.halfWidth, plan.halfHeight],
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        (volume ? GPUTextureUsage.STORAGE_BINDING : GPUTextureUsage.RENDER_ATTACHMENT),
    });
    owned.push(result);
    return result.createView();
  };
  const buffer = (size: number) => {
    const result = device.createBuffer({
      size,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    owned.push(result);
    return result;
  };
  try {
    return {
      plan,
      dispose,
      state: [texture('rgba16float', true), texture('rgba16float', true)],
      pressure: [texture('r32float', true), texture('r32float', true)],
      divergence: texture('r32float', true),
      color: texture('rgba16float', false),
      depth: texture('r32float', false),
      step: buffer(16),
      view: buffer(128),
      sampler: device.createSampler({
        minFilter: 'linear',
        magFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        addressModeW: 'clamp-to-edge',
      }),
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
export type SmokeResources = ReturnType<typeof smokeResources>;
