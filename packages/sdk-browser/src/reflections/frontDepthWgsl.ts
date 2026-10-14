import {
  COMPUTE,
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../gpu/core/computeBindings.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { clipToFramebuffer, pixelToNdc, unprojectPoint } from '../../../math/src/wgsl/projection.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { REFLECTION_VIEW_BYTES, REFLECTION_VIEW_WGSL } from './viewLayout.ts'

/**
 * The front depth's kernels (`frontDepth.ts`): the scatter and the fold (`FRONT_SHADER`), the
 * boxes' thread (`FRONT_BOX_SHADER`), and their layouts.
 */

/** The format of the depth the readers fold in, the Hi-Z level 0's (`allocPyramid`): the scatter's
 *  words, as they are. */
const FOLDED_FORMAT: GPUTextureFormat = 'r32float'
/** Bytes of the scatter's rectangle uniform: its origin, then its end. */
export const RECT_BYTES = 16
/** The boxes' words (`frontBox`): this image's destination box (`[x0, y0, x1, y1]`, empty as
 *  `[~0, ~0, 0, 0]`), the last image's, and their union the fold walks. */
export const BOX = { now: 0, last: 4, union: 8, words: 12 } as const

/** The scatter (`frontScatter`) and the fold (`frontFold`) of the front depth (`frontDepth.ts`). */
export const FRONT_SHADER = wgslProgram(
  `struct FrontRect{origin:vec2u,end:vec2u,}
@group(0) @binding(0) var<uniform> reflectionView:ReflectionView;
@group(0) @binding(1) var written:texture_2d<f32>;
@group(0) @binding(2) var<storage,read_write> carried:array<atomic<u32>>;
@group(0) @binding(3) var<uniform> frontRect:FrontRect;
@group(0) @binding(4) var<storage,read_write> box:array<atomic<u32>>;
@group(0) @binding(5) var folded:texture_storage_2d<r32float,write>;
var<workgroup> reached:array<atomic<u32>,4>;
/** The pixel of this image the last image's front texel \`texel\` lands on, its depth folded in
 *  there; \`z\` zero where it lands on none. */
fn frontCarry(texel:vec2u)->vec3u{
 let last=vec2u(reflectionView.radiance.xy);
 if(any(texel>=min(last,frontRect.end))){return vec3u(0u);}
 let z=textureLoad(written,texel,0).r;
 if(!(z>0.0)){return vec3u(0u);}
 let size=vec2f(reflectionView.traced.yz);
 let world=unprojectPoint(reflectionView.radianceInverse,vec3f(pixelToNdc(vec2f(texel)+vec2f(0.5),vec2f(last)),z));
 let clip=reflectionView.viewProj*vec4f(world,1.0);
 if(clip.w<=0.0){return vec3u(0u);}
 let at=clipToFramebuffer(clip,size);
 if(any(at.xy<vec2f(0.0))||any(at.xy>=size)||!(at.z>0.0)){return vec3u(0u);}
 let pixel=vec2u(at.xy);
 atomicMax(&carried[pixel.y*reflectionView.traced.w+pixel.x],bitcast<u32>(at.z));
 return vec3u(pixel,1u);
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn frontScatter(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32){
 if(lane==0u){
  atomicStore(&reached[0],0xffffffffu);atomicStore(&reached[1],0xffffffffu);
  atomicStore(&reached[2],0u);atomicStore(&reached[3],0u);
 }
 workgroupBarrier();
 let pixel=frontCarry(frontRect.origin+id.xy);
 if(pixel.z!=0u){
  atomicMin(&reached[0],pixel.x);atomicMin(&reached[1],pixel.y);
  atomicMax(&reached[2],pixel.x+1u);atomicMax(&reached[3],pixel.y+1u);
 }
 workgroupBarrier();
 // The group's box joins the image's, one atomic a side: none for a group that reached nothing.
 if(lane==0u&&atomicLoad(&reached[2])!=0u){
  atomicMin(&box[${BOX.now}u],atomicLoad(&reached[0]));atomicMin(&box[${BOX.now + 1}u],atomicLoad(&reached[1]));
  atomicMax(&box[${BOX.now + 2}u],atomicLoad(&reached[2]));atomicMax(&box[${BOX.now + 3}u],atomicLoad(&reached[3]));
 }
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn frontFold(@builtin(global_invocation_id) id:vec3u){
 let texel=vec2u(atomicLoad(&box[${BOX.union}u]),atomicLoad(&box[${BOX.union + 1}u]))+id.xy;
 if(texel.x>=atomicLoad(&box[${BOX.union + 2}u])||texel.y>=atomicLoad(&box[${BOX.union + 3}u])){return;}
 // A texel of the last image's box past this image's size (a smaller drawn size since) holds no
 // word of this image's rows: it is cleared alone.
 if(any(texel>=reflectionView.traced.yz)){textureStore(folded,texel,vec4f(0.0));return;}
 let at=texel.y*reflectionView.traced.w+texel.x;
 textureStore(folded,texel,vec4f(bitcast<f32>(atomicLoad(&carried[at])),0.0,0.0,0.0));
 atomicStore(&carried[at],0u);
}`,
  [REFLECTION_VIEW_WGSL, pixelToNdc, unprojectPoint, clipToFramebuffer],
)

/** The boxes' one thread (`frontBox`): the union of this image's destination box and the last
 *  image's, which the fold walks, its workgroups the fold's indirect arguments; then this image's box
 *  is the next one's last, and the next image's starts empty. */
export const FRONT_BOX_SHADER = wgslProgram(
  `@group(0) @binding(0) var<storage,read_write> box:array<u32>;
@group(0) @binding(1) var<storage,read_write> args:array<u32>;
@compute @workgroup_size(1)
fn frontBox(){
 let now=vec4u(box[${BOX.now}u],box[${BOX.now + 1}u],box[${BOX.now + 2}u],box[${BOX.now + 3}u]);
 let last=vec4u(box[${BOX.last}u],box[${BOX.last + 1}u],box[${BOX.last + 2}u],box[${BOX.last + 3}u]);
 let low=min(now.xy,last.xy);let high=max(now.zw,last.zw);
 let span=select(vec2u(0u),high-low,all(high>low));
 box[${BOX.union}u]=low.x;box[${BOX.union + 1}u]=low.y;box[${BOX.union + 2}u]=high.x;box[${BOX.union + 3}u]=high.y;
 args[0]=(span.x+${REFLECTION_SIDE - 1}u)/${REFLECTION_SIDE}u;args[1]=(span.y+${REFLECTION_SIDE - 1}u)/${REFLECTION_SIDE}u;args[2]=1u;
 box[${BOX.last}u]=now.x;box[${BOX.last + 1}u]=now.y;box[${BOX.last + 2}u]=now.z;box[${BOX.last + 3}u]=now.w;
 box[${BOX.now}u]=0xffffffffu;box[${BOX.now + 1}u]=0xffffffffu;box[${BOX.now + 2}u]=0u;box[${BOX.now + 3}u]=0u;
}`,
  [],
)

/** The scatter's and the fold's layout: the reflection's view, the last image's front depth, the
 *  buffer it folds into, the rectangle the last image's transparents wrote, the boxes and the texture
 *  the readers bind. */
export function frontLayout(device: GPUDevice) {
  return device.createBindGroupLayout({
    entries: [
      computeUniformEntry(0, { minBindingSize: REFLECTION_VIEW_BYTES }),
      computeTextureEntry(1, 'unfilterable-float'),
      computeBufferEntry(2, 'storage'),
      computeUniformEntry(3, { minBindingSize: RECT_BYTES }),
      computeBufferEntry(4, 'storage'),
      {
        binding: 5,
        visibility: COMPUTE,
        storageTexture: { access: 'write-only', format: FOLDED_FORMAT },
      },
    ],
  })
}

/** The boxes' layout (`FRONT_BOX_SHADER`): the boxes and the fold's indirect arguments. */
export function frontBoxLayout(device: GPUDevice) {
  return device.createBindGroupLayout({
    entries: [computeBufferEntry(0, 'storage'), computeBufferEntry(1, 'storage')],
  })
}
