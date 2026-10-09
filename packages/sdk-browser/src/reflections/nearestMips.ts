import { COMPUTE } from '../gpu/core/computeBindings.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { mipLevelCountFor } from '../texture/tiles.ts'

/** Threads per side of a nearest-mip workgroup: one destination texel each. */
const SIDE = 8

/**
 * The depth pyramid a reflection marches (`wgsl.ts`): the Hi-Z's level 0 — the image's depth, the
 * one level the occlusion's pyramid and this one share, read where it is — and, below it, each
 * level the NEAREST depth of the texels it covers (reversed Z, the MAXIMUM): a ray in front of a
 * cell's nearest depth passes the whole cell. The occlusion's packed levels keep the farthest
 * (`../gpu/hiz/shader.ts`), the bound a test needs and the opposite one a march needs.
 *
 * Levels 1 and down are the mips of one texture at half the depth's size, built once the visibility
 * drew the whole depth, one level per dispatch in one compute pass. A level is `floor` of the one
 * before it, as the mips of the depth would be: its last texel of an odd size also covers the
 * source's last column or row, so every depth lies under one texel of each level — the clamped cell
 * a march reads (`reflectionNearest`) holds every depth below it.
 */
export const NEAREST_MIPS_SHADER = wgslProgram(
  `@group(0) @binding(0) var finer:texture_2d<f32>;
@group(0) @binding(1) var coarser:texture_storage_2d<r32float,write>;
@compute @workgroup_size(${SIDE},${SIDE})
fn nearestMip(@builtin(global_invocation_id) id:vec3u){
 let size=textureDimensions(coarser);
 if(id.x>=size.x||id.y>=size.y){return;}
 let source=textureDimensions(finer);
 let low=id.xy*2u;
 let high=select(low+1u,source-1u,id.xy==size-1u);
 var near=0.0;
 for(var y=low.y;y<=high.y;y++){
  for(var x=low.x;x<=high.x;x++){near=max(near,textureLoad(finer,vec2u(x,y),0).r);}
 }
 textureStore(coarser,id.xy,vec4f(near,0.0,0.0,0.0));
}`,
  [],
)

/** The nearest mips' bind group layout: a level read, the next one written. */
export const NEAREST_MIPS_ENTRIES: GPUBindGroupLayoutEntry[] = [
  { binding: 0, visibility: COMPUTE, texture: { sampleType: 'unfilterable-float' } },
  {
    binding: 1,
    visibility: COMPUTE,
    storageTexture: { access: 'write-only', format: 'r32float' },
  },
]

/** The texture holding levels 1 and down of a `width × height` depth: half its size, its chain. */
export function createNearestMips(device: GPUDevice, width: number, height: number) {
  const w = Math.max(1, width >> 1),
    h = Math.max(1, height >> 1)
  return device.createTexture({
    label: 'Trillion3D reflection nearest depth',
    size: [w, h],
    format: 'r32float',
    mipLevelCount: mipLevelCountFor(w, h),
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
}

/** Texels of `createNearestMips` for a `width × height` depth, four bytes each. */
export const nearestMipsTexels = (width: number, height: number) => {
  let texels = 0
  for (let w = Math.max(1, width >> 1), h = Math.max(1, height >> 1); ; w >>= 1, h >>= 1) {
    texels += Math.max(1, w) * Math.max(1, h)
    if (w <= 1 && h <= 1) break
  }
  return texels
}

/** The groups of the build from `depth` (the Hi-Z's level 0, one level) into `mips`: level 0 read
 *  then mip 0 written, then each mip from the one before it. */
export function nearestMipGroups(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  depth: GPUTextureView,
  mips: GPUTexture,
) {
  const view = (level: number) => mips.createView({ baseMipLevel: level, mipLevelCount: 1 })
  return Array.from({ length: mips.mipLevelCount }, (_, at) =>
    device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: at ? view(at - 1) : depth },
        { binding: 1, resource: view(at) },
      ],
    }),
  )
}

/** Dispatches the build into the open compute `pass`, `groups` from `nearestMipGroups`: each
 *  dispatch sees the level the one before it wrote. */
export function encodeNearestMips(
  pass: GPUComputePassEncoder,
  pipeline: GPUComputePipeline,
  groups: GPUBindGroup[],
  mips: GPUTexture,
) {
  pass.setPipeline(pipeline)
  groups.forEach((group, at) => {
    pass.setBindGroup(0, group)
    pass.dispatchWorkgroups(
      ceilDiv(Math.max(1, mips.width >> at), SIDE),
      ceilDiv(Math.max(1, mips.height >> at), SIDE),
    )
  })
}
