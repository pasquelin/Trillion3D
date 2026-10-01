import { createCheckedShaderModule } from '../../../../packages/sdk-browser/src/gpu/core/shaderModule.ts';

type Slot =
  'uniform' | 'state' | 'scalar' | 'linear' | 'stateOut' | 'scalarOut' | 'color2d' | 'depth2d';
function smokeLayout(device: GPUDevice, slots: Slot[], visibility: GPUShaderStageFlags) {
  return device.createBindGroupLayout({
    entries: slots.map((slot, binding) => {
      const common = { binding, visibility };
      if (slot === 'uniform') return { ...common, buffer: { type: 'uniform' as const } };
      if (slot === 'linear') return { ...common, sampler: { type: 'filtering' as const } };
      if (slot === 'stateOut' || slot === 'scalarOut')
        return {
          ...common,
          storageTexture: {
            access: 'write-only' as const,
            viewDimension: '3d' as const,
            format: slot === 'stateOut' ? ('rgba16float' as const) : ('r32float' as const),
          },
        };
      return {
        ...common,
        texture: {
          sampleType:
            slot === 'scalar' || slot === 'depth2d'
              ? ('unfilterable-float' as const)
              : ('float' as const),
          viewDimension:
            slot === 'color2d' || slot === 'depth2d' ? ('2d' as const) : ('3d' as const),
        },
      };
    }),
  });
}
export const smokeGroup = (
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  resources: GPUBindingResource[],
) =>
  device.createBindGroup({
    layout,
    entries: resources.map((resource, binding) => ({ binding, resource })),
  });

export async function smokeCompute(device: GPUDevice, code: string, slots: Slot[], label: string) {
  const layout = smokeLayout(device, slots, GPUShaderStage.COMPUTE);
  const module = await createCheckedShaderModule(device, code, label);
  const pipeline = await device.createComputePipelineAsync({
    label,
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'main' },
  });
  return { layout, pipeline };
}
export async function smokeRender(
  device: GPUDevice,
  code: string,
  slots: Slot[],
  targets: GPUColorTargetState[],
  label: string,
) {
  const layout = smokeLayout(device, slots, GPUShaderStage.FRAGMENT);
  const module = await createCheckedShaderModule(device, code, label);
  const pipeline = await device.createRenderPipelineAsync({
    label,
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'vertex' },
    fragment: { module, entryPoint: 'fragment', targets },
    primitive: { topology: 'triangle-list' },
  });
  return { layout, pipeline };
}
