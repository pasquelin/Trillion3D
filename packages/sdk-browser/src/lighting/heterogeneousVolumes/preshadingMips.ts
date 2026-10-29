import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import {
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
} from '../../gpu/core/computeBindings.ts'
import { layoutStagesOf } from '../../gpu/core/computeStages.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'

/**
 * THE COARSER LEVELS OF A BAKED TEXTURE (`GenerateMips3D`, `HeterogeneousVolumesPreshadingPipeline.usf:78-102`): each voxel of a level is the level
 * above sampled, trilinear and clamped, at the voxel's centre. The reference writes the kernel and its pass but never runs it (its baked textures hold
 * one level, so the level the setting asks for is read from the first): here the levels are made, the setting is read.
 * Bindings: 0 the level above, 1 the sampler, 2 the level written.
 */
export const HV_PRESHADING_MIPS_WGSL = wgslProgram(
  `@group(0) @binding(0) var upper:texture_3d<f32>;
@group(0) @binding(1) var mipSampler:sampler;
@group(0) @binding(2) var lower:texture_storage_3d<rgba16float,write>;

@compute @workgroup_size(4,4,4)
fn hvGenerateMips3D(@builtin(global_invocation_id) id:vec3u){
 let size=textureDimensions(lower);
 if(any(id>=size)){return;}
 let uvw=(vec3f(id)+vec3f(0.5))/vec3f(size);
 textureStore(lower,vec3i(id),vec4f(textureSampleLevel(upper,mipSampler,uvw,0.0).rgb,1.0));
}`,
  [],
)

/** The pipeline and the sampler of the pass, prepared once a device. */
const passOf = oncePerDevice((device: GPUDevice) => ({
  stage: layoutStagesOf(device, 'Trillion3D heterogeneous volume preshading mips')(
    'mips',
    device.createShaderModule({ code: HV_PRESHADING_MIPS_WGSL }),
    'hvGenerateMips3D',
    [
      computeTextureEntry(0, 'float', '3d'),
      computeSamplerEntry(1),
      computeStorageTextureEntry(2, 'rgba16float', 'write-only', '3d'),
    ],
  ),
  sampler: device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    addressModeW: 'clamp-to-edge',
  }),
}))

/** The size of a level of a texture of `size` voxels (`GenerateMips3D`, `PreshadingPipeline.cpp:1267`), and the workgroups that cover it. */
export function mipDispatchOf(size: readonly [number, number, number], level: number) {
  const resolution = size.map((side) => Math.max(side >> level, 1)) as [number, number, number]
  return {
    resolution,
    groups: resolution.map((side) => Math.ceil(side / 4)) as [number, number, number],
  }
}

/** Fills the levels 1 and up of `texture` (`levels` in all) from the first, each from the one above it. */
export function encodePreshadingMips(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  texture: GPUTexture,
  levels: number,
) {
  const { stage, sampler } = passOf(device)
  const pipeline = stage.pipeline.get()
  if (!pipeline) return
  const size = [texture.width, texture.height, texture.depthOrArrayLayers] as const
  for (let level = 1; level < levels; level++) {
    const view = (mip: number) =>
      texture.createView({ dimension: '3d', baseMipLevel: mip, mipLevelCount: 1 })
    const pass = encoder.beginComputePass({
      label: 'Trillion3D heterogeneous volume preshading mips',
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: stage.layout,
        entries: [
          { binding: 0, resource: view(level - 1) },
          { binding: 1, resource: sampler },
          { binding: 2, resource: view(level) },
        ],
      }),
    )
    pass.dispatchWorkgroups(...mipDispatchOf(size, level).groups)
    pass.end()
  }
}
