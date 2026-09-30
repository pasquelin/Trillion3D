import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts';
import { createWebgpuBindIdentity } from '../core/bindIdentity.ts';
import { buildComputePipeline } from '../../lighting/deferred/fullscreen.ts';

/** A binding of a compute pass: a buffer of that type, or a texture of that sample type. */
export type ComputeBinding = GPUBufferBindingType | { texture: GPUTextureSampleType };
/** Workgroups a pass dispatches: a count, a count on x and y, or the words at a byte of a buffer. */
type ComputeGroups = number | readonly [number, number] | readonly [GPUBuffer, number];

/**
 * A compute pass of one bind group — the shadow page passes' (#1275): its pipeline, compiled at
 * prepare, and its bind group made again only when what it binds moved. Returns what encodes it
 * over `resources`, in binding order — a buffer, or the view of a texture binding.
 */
export async function computePass(
  device: GPUDevice,
  wgsl: string,
  label: string,
  entryPoint: string,
  bindings: readonly ComputeBinding[],
) {
  const module = await createCheckedShaderModule(device, wgsl, label);
  const layout = device.createBindGroupLayout({
    label,
    entries: bindings.map((type, binding) => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      ...(typeof type === 'string'
        ? { buffer: { type } }
        : { texture: { sampleType: type.texture } }),
    })),
  });
  const pipeline = await buildComputePipeline(device, {
    label,
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint },
  });
  const bound = createWebgpuBindIdentity();
  let group: GPUBindGroup | undefined;
  return (
    encoder: GPUCommandEncoder,
    resources: readonly (GPUBuffer | GPUTextureView)[],
    groups: ComputeGroups,
  ) => {
    bound.next.length = 0;
    bound.next.push(...resources);
    if (bound.moved() || !group)
      group = device.createBindGroup({
        label,
        layout,
        entries: resources.map((resource, binding) => ({
          binding,
          resource:
            typeof bindings[binding] === 'string'
              ? { buffer: resource as GPUBuffer }
              : (resource as GPUTextureView),
        })),
      });
    const pass = encoder.beginComputePass({ label });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    if (typeof groups === 'number') pass.dispatchWorkgroups(groups);
    else if (typeof groups[0] === 'number') pass.dispatchWorkgroups(groups[0], groups[1] as number);
    else pass.dispatchWorkgroupsIndirect(groups[0], groups[1] as number);
    pass.end();
  };
}
