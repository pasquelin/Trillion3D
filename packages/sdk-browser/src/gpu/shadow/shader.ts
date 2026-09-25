import {
  MASK_KEEP_WGSL,
  PAGE_BINDING,
  PAGE_INFO_WGSL,
  PAGE_LOOKUP_WGSL,
} from '../../visibility/shader/pageWgsl.ts';
import { PAGE_GEOMETRY_WGSL } from '../../visibility/shader/pageGeometryWgsl.ts';
import {
  COLOR_SAMPLE_WGSL,
  TILE_POOL_WGSL,
  maskAlphaWgsl,
  tileDeclarations,
} from '../../webgpu/tile/wgsl.ts';
import { VIS_BINDINGS } from '../../webgpu/core/bindLayout.ts';
import { FLAG_BLEND_CASTER } from '../../visibility/types.ts';
import { BLEND_TRANSMITTANCE_WGSL, TRANSMITTANCE_CLEAR_WGSL } from './transmittance.ts';

/**
 * Shadow depth passes. Group 0 is that of the visibility-buffer raster, but for one binding:
 * same page table, same cluster selection, same indirect buffer. Only the matrix changes, and
 * it comes from group 1 with a dynamic offset — one face per offset.
 *
 * The depth's fragment stage writes nothing: it exists only to discard. An opacity-mask material —
 * foliage, grille, lattice — casts the shadow of its cutout and not the full silhouette of its
 * cluster, because the mask test is the raster's (`MASK_KEEP_WGSL`), read at the map level the
 * shadow texel asks for — its derivatives, not the camera's.
 *
 * A blended cluster casts from a row only this pass reads (`FLAG_BLEND_CASTER`,
 * `../../webgpu/row/blendCasters.ts`), and never into the depth: `shadow_vs` skips its row, and
 * `shadow_blend_vs` draws it alone, into the transmittance layer (`transmittance.ts`), where
 * `shadow_blend_fs` writes the share of the light it lets through and its depth.
 *
 * It also discards the emitter envelope: a light that declares a radius accepts no depth from a
 * surface closer to its centre than that radius. The rule is Euclidean distance to the centre,
 * so the exclusion is exactly the announced sphere — a raised near plane would have cut a cube.
 * A light without a radius carries a zero radius and nothing is discarded.
 */
export const SHADOW_DEPTH_SHADER = `${PAGE_INFO_WGSL}
${PAGE_BINDING.indices}
${PAGE_BINDING.positions}
${PAGE_BINDING.pages}
${PAGE_BINDING.uniforms}
@group(0) @binding(${VIS_BINDINGS.uv}) var<storage, read> uvs:array<f32>;
${tileDeclarations(VIS_BINDINGS.color, 'color')}
@group(0) @binding(${VIS_BINDINGS.sampler}) var mapsSampler:sampler;
${PAGE_BINDING.instances}
${PAGE_BINDING.slotOffsets}
struct ShadowView{viewProjection:mat4x4f,params:vec4f,emitter:vec4f,}
@group(1) @binding(0) var<uniform> shadow:ShadowView;
struct ShadowOut{@builtin(position) position:vec4f,@location(0) @interpolate(flat) instance:u32,@location(1) uv:vec2f,@location(2) fromEmitter:vec3f,}
${PAGE_LOOKUP_WGSL}
${PAGE_GEOMETRY_WGSL}
${TILE_POOL_WGSL}
${COLOR_SAMPLE_WGSL}
${maskAlphaWgsl(true)}
${MASK_KEEP_WGSL}
${BLEND_TRANSMITTANCE_WGSL}
/** A caster's corner, or none when its row is not of the kind drawn: \`blended\` casters alone
 *  into the transmittance layer, the others alone into the depth. */
fn shadowVertex(vertexIndex:u32,instanceIndex:u32,blended:bool)->ShadowOut{
 var out:ShadowOut;
 let pageIndex=drawPage(instanceIndex);
 let page=pages[pageIndex];
 out.instance=pageIndex;out.uv=vec2f(0.0);out.fromEmitter=vec3f(0.0);
 let kind=(page.flags&${FLAG_BLEND_CASTER}u)!=0u;
 if(vertexIndex>=page.indexCount||kind!=blended){out.position=vec4f(0.0,0.0,2.0,1.0);return out;}
 let h=pageHeader(page);
 let id=pageCorner(page,h,vertexIndex);
 let vertex=pagePosition(page,h,id);
 // The out.position product is not reassociated: world position is composed apart, otherwise
 // the written depth would no longer be that from before this batch, to the bit.
 out.position=shadow.viewProjection*page.world*vec4f(vertex,1.0);
 out.fromEmitter=(page.world*vec4f(vertex,1.0)).xyz-shadow.emitter.xyz;
 if((page.flags&4u)!=0u){out.uv=pageUv(page,h,id);}
 return out;
}
@vertex fn shadow_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->ShadowOut{
 return shadowVertex(vertexIndex,instanceIndex,false);
}
@vertex fn shadow_blend_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->ShadowOut{
 return shadowVertex(vertexIndex,instanceIndex,true);
}
/** False on the emitter envelope and on a cutout's hole: what no caster keeps. */
fn shadowKeep(in:ShadowOut,gx:vec2f,gy:vec2f)->bool{
 let radius=shadow.emitter.w;
 if(radius>0.0&&dot(in.fromEmitter,in.fromEmitter)<radius*radius){return false;}
 return maskKeep(pages[in.instance],in.uv,1.0,gx,gy,0.0);
}
/** Writes no colour: it only discards the envelope and the cutout. */
@fragment fn shadow_fs(in:ShadowOut){
 let gx=dpdx(in.uv);let gy=dpdy(in.uv);
 if(!shadowKeep(in,gx,gy)){discard;}
}
/** A blended caster's texel of the transmittance layer, blended multiplicatively. */
@fragment fn shadow_blend_fs(in:ShadowOut)->@location(0) vec4f{
 let gx=dpdx(in.uv);let gy=dpdy(in.uv);
 if(!shadowKeep(in,gx,gy)){discard;}
 return blendTransmittance(pages[in.instance],in.uv,gx,gy,in.position.z);
}
/** The transmittance of a page cleared: all the light, no translucent caster. */
@fragment fn shadow_clear_fs()->@location(0) vec4f{
 return ${TRANSMITTANCE_CLEAR_WGSL};
}
/** Resets the slice to FAR without clearing the rest of the atlas. Face depth is reverse-Z
 *  like the camera's (\`../../camera/depthConvention.ts\`): far is zero. */
@vertex fn shadow_clear_vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
 return vec4f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1),0.0,1.0);
}`;
