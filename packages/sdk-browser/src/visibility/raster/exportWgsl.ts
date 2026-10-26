import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { DEPTH_CLEAR } from '../../camera/depthConvention.ts'
import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'
import { PAGE_INFO_STRUCT_WGSL, VIS_UNIFORMS_WGSL } from '../shader/pageWgsl.ts'
import { SHADING_MASK_WGSL, shadeBinsWgsl } from '../shader/shadeBinsWgsl.ts'
import { visPageIndex, visRowIn } from '../visWords.ts'
import { WIDE_ATOMIC_WGSL } from '../../gpu/core/wideAtomics.ts'
import { pixelCount, pixelOffset } from './pixelWgsl.ts'

/** The export's bindings in its group 0, binding after binding: the visibility buffer, the view's
 *  uniform, the pyramid's level zero and the identifiers it writes, then — on a device without the
 *  64-bit word — the hardware raster's depth and identifiers it merges with the buffer's, and last
 *  the page table, the shading bins' head and the shading masks the identifiers are classed into. */
export const EXPORT_BINDINGS = {
  work: 0,
  uniform: 1,
  level0: 2,
  ids: 3,
  hwDepth: 4,
  hwIds: 5,
  pages: 6,
  bins: 7,
  mask: 8,
}

/** The entry points of the export: the depth alone, into the pyramid's level zero (`exportDepth`),
 *  and the identifiers (`exportIds`). */
export const EXPORT_DEPTH = 'exportDepth',
  EXPORT_IDS = 'exportIds'
/** The entry point of the fragment stage that writes the scene's depth (`DEPTH_EXPORT_SHADER`). */
export const EXPORT_SCENE_DEPTH = 'exportSceneDepth'

/**
 * THE EXPORT of the visibility buffer, one compute pass over the image reading each pixel once
 * and writing what the consumers read: the pyramid's level zero (the depth the Hi-Z is built from)
 * and the identifiers texture (which cluster and triangle each pixel shows, zero for none), with
 * the pixel's shading mask beside it (`packShadingMask`: its material class's bin, which the
 * bins' kernels sort the pixels by, zero for none). It replaces the full-screen render passes that rewrote the buffer into attachments.
 * Every texel of the textures is written, the ones past the drawn size (`uni.viewport`) with the
 * background — a depth of `DEPTH_CLEAR`, an identifier and a mask of zero. The mask is the class of
 * the pixel's page (`pages`, the table the page decode wrote) looked up once in the bins' head.
 *
 * **With the 64-bit word** (`wide`) a pixel is the pair the visibility write took (`pixelWgsl.ts`):
 * the identifier its first component, the depth key its second, whose bits are the depth.
 *
 * **Without it** the buffer holds the software raster's two planes alone and the hardware raster's
 * fragments were drawn once, with the hardware depth test, into a depth texture and an identifiers
 * texture (`hwDepth`, `hwIds`); a pixel shows the nearer of the two rasters' depth, and between
 * two at exactly the same depth the greater identifier — the maximum the 64-bit word takes.
 *
 * The scene's depth attachment is not written here: WebGPU lets a texture be a storage binding
 * only in a format of its "Plain color formats" table (§ 6.1 createTexture, § 26.1.1), and a
 * `depth32float` texture takes a copy only from another of its format ("copies into such textures are
 * only valid from other textures of the same format", § 26.1.2.2; both at
 * https://www.w3.org/TR/webgpu/) — "can be written in a render pass using a fragment shader that
 * outputs depth values via the frag_depth output" — so the attachment is the one output of a
 * render pass of its own, `DEPTH_EXPORT_SHADER`, reading the level zero this pass wrote.
 */
export const exportSource = (wide: boolean) =>
  wgslProgram(
    `@group(0) @binding(${EXPORT_BINDINGS.work}) var<storage,read> work:array<${wide ? 'vec2<u32>' : 'u32'}>;
@group(0) @binding(${EXPORT_BINDINGS.uniform}) var<uniform> uni:Uniforms;
@group(0) @binding(${EXPORT_BINDINGS.level0}) var level0:texture_storage_2d<r32float,write>;
@group(0) @binding(${EXPORT_BINDINGS.ids}) var ids:texture_storage_2d<r32uint,write>;
@group(0) @binding(${EXPORT_BINDINGS.pages}) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(${EXPORT_BINDINGS.mask}) var mask:texture_storage_2d<r32uint,write>;
${
  wide
    ? `/** The pixel's pair: its depth and its identifier. */
fn depthAt(p:vec2u)->f32{return bitcast<f32>(work[pixelOffset(p)].y);}
fn idAt(p:vec2u)->u32{return work[pixelOffset(p)].x;}`
    : `@group(0) @binding(${EXPORT_BINDINGS.hwDepth}) var hwDepth:texture_depth_2d;
@group(0) @binding(${EXPORT_BINDINGS.hwIds}) var hwIds:texture_2d<u32>;
/** The nearer of the software raster's depth key (the buffer's first plane) and the hardware's. */
fn depthAt(p:vec2u)->f32{
 return max(bitcast<f32>(work[pixelOffset(p)]),textureLoad(hwDepth,vec2i(p),0));
}
/** The identifier of the nearer raster, the greater between two rasters at the same depth. */
fn idAt(p:vec2u)->u32{
 let at=pixelOffset(p);
 let soft=bitcast<f32>(work[at]);
 let hard=textureLoad(hwDepth,vec2i(p),0);
 let softId=work[pixelCount()+at];
 let hardId=textureLoad(hwIds,vec2i(p),0).r;
 if(soft>hard){return softId;}
 if(hard>soft){return hardId;}
 return max(softId,hardId);
}`
}
fn drawn(p:vec2u)->bool{return p.x<u32(uni.viewport.x)&&p.y<u32(uni.viewport.y);}
/** The shading mask of identifier \`id\`: its page's class word, none on the background. */
fn shadingMaskOf(id:u32)->u32{
 if(!visRowIn(id,uni.pageCount)){return 0u;}
 return packShadingMask(binOfClass(pages[visPageIndex(id)].materialClass));
}
@compute @workgroup_size(8,8) fn ${EXPORT_DEPTH}(@builtin(global_invocation_id) g:vec3u){
 let size=textureDimensions(level0);
 if(g.x>=size.x||g.y>=size.y){return;}
 var depth=${wgslF32(DEPTH_CLEAR)};
 if(drawn(g.xy)){depth=depthAt(g.xy);}
 textureStore(level0,g.xy,vec4f(depth,0.0,0.0,0.0));
}
@compute @workgroup_size(8,8) fn ${EXPORT_IDS}(@builtin(global_invocation_id) g:vec3u){
 let size=textureDimensions(ids);
 if(g.x>=size.x||g.y>=size.y){return;}
 var id=0u;
 if(drawn(g.xy)){id=idAt(g.xy);}
 textureStore(ids,g.xy,vec4u(id,0u,0u,0u));
 textureStore(mask,g.xy,vec4u(shadingMaskOf(id),0u,0u,0u));
}`,
    [
      VIS_UNIFORMS_WGSL,
      PAGE_INFO_STRUCT_WGSL,
      SHADING_MASK_WGSL,
      shadeBinsWgsl({ group: 0, binding: EXPORT_BINDINGS.bins, access: 'read' }),
      visRowIn,
      visPageIndex,
      pixelOffset,
      ...(wide ? [WIDE_ATOMIC_WGSL] : [pixelCount]),
    ],
  )

/**
 * The scene's depth attachment, written from the level zero the export wrote: a full-screen
 * triangle whose fragment takes the depth there as its own, the background's `DEPTH_CLEAR` where
 * nothing was drawn. The pass clears the attachment first; it is the only pass of the image that
 * writes the depth for everything after it.
 */
export const DEPTH_EXPORT_SHADER = wgslProgram(
  `@group(0) @binding(0) var level0:texture_2d<f32>;
struct SceneDepth{@builtin(frag_depth) depth:f32,}
@fragment fn ${EXPORT_SCENE_DEPTH}(@builtin(position) pos:vec4f)->SceneDepth{return SceneDepth(textureLoad(level0,vec2i(pos.xy),0).r);}`,
  [FULLSCREEN_VERTEX],
)
