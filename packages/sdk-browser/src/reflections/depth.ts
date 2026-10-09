import { COMPUTE } from '../gpu/core/computeBindings.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { mipLevelCountFor } from '../texture/tiles.ts'
import { SURFACE_SLOPE_WGSL } from '../lighting/deferred/footprintWgsl.ts'

/** Threads per side of a depth workgroup: one destination texel each. */
const SIDE = 8
/** The depth field's format: a pixel's depth (its `f32` bits) and its plane's two slopes over that
 *  depth (two halves). */
export const REFLECTION_FIELD_FORMAT: GPUTextureFormat = 'rg32uint'

/**
 * THE DEPTH A REFLECTION MARCHES (`wgsl.ts`): a field of slabs, built once the visibility drew the
 * whole depth, from the Hi-Z's level 0 — the image's depth, which the occlusion's pyramid reads
 * where it is.
 *
 * Level 0, the field, holds each pixel's centre depth and the slopes of the surface's plane through
 * it (`reflectionFieldTexel`: the slope rule of every depth reader, `surfaceSlopeOf`), relative to
 * that depth so that half floats keep them at every distance; the surface covers the pixel on that
 * plane, its nearest at a corner, half the slopes' sum in front of its centre. Levels 1 and down —
 * the mips of one texture at half the size — hold each the NEAREST of the slabs their texels cover
 * (reversed Z, the MAXIMUM): a ray in front of a cell's nearest passes every plane the cell holds.
 * The occlusion's packed levels keep the farthest (`../gpu/hiz/shader.ts`), the bound a test needs
 * and the opposite one a march needs.
 *
 * A level is `floor` of the one before it, as mips are: its last texel of an odd size also covers
 * the source's last column or row, so every pixel lies under one texel of each level — the clamped
 * cell a march reads holds every plane below it. One dispatch makes the field and level 1 (each
 * thread its texel's pixels), one each further level, in one compute pass.
 */
export const REFLECTION_FIELD_TEXEL_WGSL = wgslBlock(
  'REFLECTION_FIELD_TEXEL_WGSL',
  [SURFACE_SLOPE_WGSL],
  `fn fieldDepth(p:vec2i)->f32{
 return textureLoad(fieldSource,clamp(p,vec2i(0),vec2i(textureDimensions(fieldSource))-vec2i(1)),0).r;
}
fn reflectionFieldTexel(p:vec2i)->vec3f{
 let z=fieldDepth(p);
 let x=vec2i(1,0);let y=vec2i(0,1);
 return vec3f(z,
  surfaceSlopeOf(z,fieldDepth(p-x),fieldDepth(p+x),fieldDepth(p-x*2),fieldDepth(p+x*2)),
  surfaceSlopeOf(z,fieldDepth(p-y),fieldDepth(p+y),fieldDepth(p-y*2),fieldDepth(p+y*2)));
}`,
)

export const REFLECTION_DEPTH_SHADER = wgslProgram(
  `@group(0) @binding(0) var fieldSource:texture_2d<f32>;
@group(0) @binding(1) var field:texture_storage_2d<${REFLECTION_FIELD_FORMAT},write>;
@group(0) @binding(2) var nearestOut:texture_storage_2d<r32float,write>;
@group(0) @binding(3) var finer:texture_2d<f32>;
fn span(id:vec2u,size:vec2u,source:vec2u)->vec4u{
 let low=id*2u;
 return vec4u(low,select(low+1u,source-1u,id==size-1u));
}
@compute @workgroup_size(${SIDE},${SIDE})
fn reflectionField(@builtin(global_invocation_id) id:vec3u){
 let size=textureDimensions(nearestOut);
 if(any(id.xy>=size)){return;}
 let cover=span(id.xy,size,textureDimensions(fieldSource));
 var near=0.0;
 for(var y=cover.y;y<=cover.w;y++){
  for(var x=cover.x;x<=cover.z;x++){
   let p=vec2i(vec2u(x,y));
   let texel=reflectionFieldTexel(p);
   let relative=select(vec2f(0.0),texel.yz/texel.x,texel.x>0.0);
   textureStore(field,p,vec4u(bitcast<u32>(texel.x),pack2x16float(relative),0u,0u));
   near=max(near,texel.x+0.5*(abs(texel.y)+abs(texel.z)));
  }
 }
 textureStore(nearestOut,id.xy,vec4f(near,0.0,0.0,0.0));
}
@compute @workgroup_size(${SIDE},${SIDE})
fn reflectionNearest(@builtin(global_invocation_id) id:vec3u){
 let size=textureDimensions(nearestOut);
 if(any(id.xy>=size)){return;}
 let cover=span(id.xy,size,textureDimensions(finer));
 var near=0.0;
 for(var y=cover.y;y<=cover.w;y++){
  for(var x=cover.x;x<=cover.z;x++){near=max(near,textureLoad(finer,vec2u(x,y),0).r);}
 }
 textureStore(nearestOut,id.xy,vec4f(near,0.0,0.0,0.0));
}`,
  [REFLECTION_FIELD_TEXEL_WGSL],
)

const unfilterable = (binding: number): GPUBindGroupLayoutEntry => ({
  binding,
  visibility: COMPUTE,
  texture: { sampleType: 'unfilterable-float' },
})
const nearestOut: GPUBindGroupLayoutEntry = {
  binding: 2,
  visibility: COMPUTE,
  storageTexture: { access: 'write-only', format: 'r32float' },
}
/** The field's layout — the Hi-Z level 0 read, the field and level 1 written — and a further
 *  level's — a level read, the next written. */
export const REFLECTION_FIELD_ENTRIES: GPUBindGroupLayoutEntry[] = [
  unfilterable(0),
  {
    binding: 1,
    visibility: COMPUTE,
    storageTexture: { access: 'write-only', format: REFLECTION_FIELD_FORMAT },
  },
  nearestOut,
]
export const REFLECTION_NEAREST_ENTRIES: GPUBindGroupLayoutEntry[] = [nearestOut, unfilterable(3)]

/** The depth of a `width × height` view: its field, and the texture of its levels 1 and down. */
export function createReflectionDepth(device: GPUDevice, width: number, height: number) {
  const w = Math.max(1, width >> 1),
    h = Math.max(1, height >> 1)
  const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
  const field = device.createTexture({
    label: 'Trillion3D reflection depth field',
    size: [width, height],
    format: REFLECTION_FIELD_FORMAT,
    usage,
  })
  const nearest = device.createTexture({
    label: 'Trillion3D reflection nearest depth',
    size: [w, h],
    format: 'r32float',
    mipLevelCount: mipLevelCountFor(w, h),
    usage,
  })
  return {
    field,
    nearest,
    fieldView: field.createView(),
    nearestView: nearest.createView(),
    destroy() {
      field.destroy()
      nearest.destroy()
    },
  }
}
export type ReflectionDepthField = ReturnType<typeof createReflectionDepth>

/** Bytes of `createReflectionDepth` at `width × height`: eight a pixel, four a coarser texel. */
export function reflectionDepthBytes(width: number, height: number) {
  let texels = 0
  for (let w = Math.max(1, width >> 1), h = Math.max(1, height >> 1); ; w >>= 1, h >>= 1) {
    texels += Math.max(1, w) * Math.max(1, h)
    if (w <= 1 && h <= 1) break
  }
  return width * height * 8 + texels * 4
}

/** The groups of the build from `source` (the Hi-Z's level 0) into `depth`: the field and level 1,
 *  then each level from the one before it. */
export function reflectionDepthGroups(
  device: GPUDevice,
  layouts: { field: GPUBindGroupLayout; nearest: GPUBindGroupLayout },
  source: GPUTextureView,
  depth: ReflectionDepthField,
) {
  const view = (level: number) =>
    depth.nearest.createView({ baseMipLevel: level, mipLevelCount: 1 })
  return Array.from({ length: depth.nearest.mipLevelCount }, (_, at) =>
    at
      ? device.createBindGroup({
          layout: layouts.nearest,
          entries: [
            { binding: 2, resource: view(at) },
            { binding: 3, resource: view(at - 1) },
          ],
        })
      : device.createBindGroup({
          layout: layouts.field,
          entries: [
            { binding: 0, resource: source },
            { binding: 1, resource: depth.fieldView },
            { binding: 2, resource: view(0) },
          ],
        }),
  )
}

/** Dispatches the build into the open compute `pass`, `groups` from `reflectionDepthGroups`: each
 *  dispatch sees the level the one before it wrote. */
export function encodeReflectionDepthField(
  pass: GPUComputePassEncoder,
  pipelines: { field: GPUComputePipeline; nearest: GPUComputePipeline },
  groups: GPUBindGroup[],
  depth: ReflectionDepthField,
) {
  groups.forEach((group, at) => {
    pass.setPipeline(at ? pipelines.nearest : pipelines.field)
    pass.setBindGroup(0, group)
    pass.dispatchWorkgroups(
      ceilDiv(Math.max(1, depth.nearest.width >> at), SIDE),
      ceilDiv(Math.max(1, depth.nearest.height >> at), SIDE),
    )
  })
}
