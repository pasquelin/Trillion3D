import {
  MASK_KEEP_WGSL,
  PAGE_BINDING,
  PAGE_INFO_WGSL,
  PAGE_LOOKUP_WGSL,
} from '../../visibility/shader/pageWgsl.ts';
import { PAGE_GEOMETRY_WGSL } from '../../visibility/shader/pageGeometryWgsl.ts';
import {
  COLOR_SAMPLE_WGSL,
  tilePoolWgsl,
  maskAlphaWgsl,
  tileDeclarations,
} from '../../webgpu/tile/wgsl.ts';
import { VIS_BINDINGS } from '../../webgpu/core/bindLayout.ts';
import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { FEEDBACK_RULE_WGSL, tileRequestIndexWgsl } from '../../webgpu/tile/requestWgsl.ts';
import {
  FLAG_BLEND_CASTER,
  FLAG_HAS_MAP,
  FLAG_MASK,
  FLAG_SAMPLED,
} from '../../visibility/types.ts';
import { BLEND_TRANSMITTANCE_WGSL } from './transmittance.ts';

/**
 * Shadow depth passes. Group 0 is that of the visibility-buffer raster, but for one binding:
 * same page table, same cluster selection, same indirect buffer. Only the matrix changes, and
 * it comes from group 1 with a dynamic offset — one face per offset.
 *
 * The depth's fragment stage writes nothing: it exists only to discard, and only where something can
 * be discarded (#965). The cull files each region's casters in two lists (`KEPT_LISTS_WGSL`): the
 * opaque ones are drawn by `shadow_depth_vs` with no fragment stage — early depth, no fragment
 * invocation —, unless the face carries an emitter envelope, then by `shadow_vs` with it; the
 * cutout ones by `shadow_cutout_vs` with it. All three place a corner through `shadowVertex`, whose
 * position is `@invariant`: the depth is the same whichever draws it. An opacity-mask material —
 * foliage, grille, lattice — casts the shadow of its cutout and not the full silhouette of its
 * cluster, because the mask test is the raster's (`MASK_KEEP_WGSL`), read at the map level the
 * shadow texel asks for — its derivatives, not the camera's.
 *
 * A blended cluster casts from a row only this pass reads (`FLAG_BLEND_CASTER`,
 * `../../webgpu/row/blendCasters.ts`), and never into the depth: `shadow_vs` skips its row, and
 * `shadow_blend_vs` draws it alone, into the transmittance layer (`transmittance.ts`), at half the
 * pool's resolution, where `shadow_blend_fs` writes the share of the light it lets through — and,
 * in the depth-only draw of the same list, its depth. What the pool's opaque depth hides from the
 * light, at all four of its texels, it discards.
 *
 * It also discards the emitter envelope: a light that declares a radius accepts no depth from a
 * surface closer to its centre than that radius. The rule is Euclidean distance to the centre,
 * so the exclusion is exactly the announced sphere — a raised near plane would have cut a cube.
 * A light without a radius carries a zero radius and nothing is discarded.
 */
/** Clip units per 1/256 of a page texel: the rasterizer's subtexel step (#26 step C, #1016). */
export const SHADOW_SNAP = (SHADOW_PAGE / 2) * 256;
/** A row whose cutout reads a base map: masked, and with a map. */
const CUTOUT_MAP = FLAG_MASK | FLAG_HAS_MAP;

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
@group(1) @binding(1) var<uniform> cutoutWord:vec4u;
@group(1) @binding(2) var<storage,read_write> tileFeedback:array<atomic<u32>>;
@group(2) @binding(0) var shadowOpaque:texture_depth_2d;
struct ShadowOut{@invariant @builtin(position) position:vec4f,@location(0) @interpolate(flat) instance:u32,@location(1) uv:vec2f,@location(2) fromEmitter:vec3f,}
const SHADOW_SNAP:f32=${SHADOW_SNAP}.0;
${PAGE_LOOKUP_WGSL}
${PAGE_GEOMETRY_WGSL}
${tilePoolWgsl('0.0')}
${COLOR_SAMPLE_WGSL}
${maskAlphaWgsl(true)}
${MASK_KEEP_WGSL}
${tileRequestIndexWgsl('color')}
${FEEDBACK_RULE_WGSL}
${BLEND_TRANSMITTANCE_WGSL}
/** A sun corner (w 1) snapped to the rasterizer's own 1/256 of a texel: the viewport adds the
 *  physical page's origin to it exactly, so a page rasterizes alike wherever the pool puts it. */
fn sunSnap(p:vec4f)->vec4f{
 if(p.w!=1.0){return p;}
 return vec4f(round(p.x*SHADOW_SNAP)/SHADOW_SNAP,round(p.y*SHADOW_SNAP)/SHADOW_SNAP,p.z,p.w);
}
/** Corner \`vertexIndex\` of page-table row \`pageIndex\`, or none when its row is not of the kind
 *  drawn: \`blended\` casters alone into the transmittance layer, the others alone into the depth. */
fn shadowVertex(vertexIndex:u32,pageIndex:u32,blended:bool)->ShadowOut{
 var out:ShadowOut;
 let page=pages[pageIndex];
 out.instance=pageIndex;out.uv=vec2f(0.0);out.fromEmitter=vec3f(0.0);
 let kind=(page.flags&${FLAG_BLEND_CASTER}u)!=0u;
 if(vertexIndex>=page.indexCount||kind!=blended){out.position=vec4f(0.0,0.0,2.0,1.0);return out;}
 let h=pageHeader(page);
 let id=pageCorner(page,h,vertexIndex);
 let vertex=pagePosition(page,h,id);
 // The out.position product is not reassociated: world position is composed apart, otherwise
 // the written depth would no longer be that from before this batch, to the bit.
 out.position=sunSnap(shadow.viewProjection*page.world*vec4f(vertex,1.0));
 out.fromEmitter=(page.world*vec4f(vertex,1.0)).xyz-shadow.emitter.xyz;
 if((page.flags&4u)!=0u){out.uv=pageUv(page,h,id);}
 return out;
}
/** Row of a region's \`i\`-th cutout caster: its list runs from the slot's end down, and the slot
 *  table holds one offset more than regions, the end of the last. */
fn cutoutPage(i:u32)->u32{return instances[slotOffsets[uni.drawSlot+1u]-1u-i];}
@vertex fn shadow_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->ShadowOut{
 return shadowVertex(vertexIndex,drawPage(instanceIndex),false);
}
@vertex fn shadow_depth_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->@invariant @builtin(position) vec4f{
 return shadowVertex(vertexIndex,drawPage(instanceIndex),false).position;
}
@vertex fn shadow_cutout_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->ShadowOut{
 return shadowVertex(vertexIndex,cutoutPage(instanceIndex),false);
}
@vertex fn shadow_blend_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->ShadowOut{
 return shadowVertex(vertexIndex,drawPage(instanceIndex),true);
}
/** False on the emitter envelope and on a cutout's hole: what no caster keeps. */
fn shadowKeep(in:ShadowOut,gx:vec2f,gy:vec2f)->bool{
 let radius=shadow.emitter.w;
 if(radius>0.0&&dot(in.fromEmitter,in.fromEmitter)<radius*radius){return false;}
 return maskKeep(pages[in.instance],in.uv,1.0,gx,gy);
}
/** A masked caster's texel asks for the base-map tile its cutout reads — the isotropic level, one
 *  of the two the read mixes, picked as the camera's pixels pick —, in its phase, into the texture
 *  feedback's counters (\`faceBindings.ts\`): what it reads is then what the pose asked. */
fn cutoutRequest(in:ShadowOut,gx:vec2f,gy:vec2f){
 let page=pages[in.instance];
 if(cutoutWord.y==0u||(page.flags&${CUTOUT_MAP}u)!=${CUTOUT_MAP}u||!feedbackPhase(in.position.xy,cutoutWord.x)){return;}
 let p=requestPick(in.position.xy,1u,cutoutWord.x);
 let rank=colorRequestIndex(page.mapIndex,in.uv,gx,gy,p.next,1u,false,(page.flags&${FLAG_SAMPLED}u)!=0u);
 if(rank!=0u){atomicAdd(&tileFeedback[rank-1u],1u);}
}
/** Writes no colour: it only discards the envelope and the cutout, and asks the cutout's tile. */
@fragment fn shadow_fs(in:ShadowOut){
 let gx=dpdx(in.uv);let gy=dpdy(in.uv);
 cutoutRequest(in,gx,gy);
 if(!shadowKeep(in,gx,gy)){discard;}
}
/** True when the pool's opaque depth is nearer the light than \`p\` at the four texels of its
 *  half-resolution texel: reversed depth, so the farthest of them is the least. */
fn shadowHiddenByOpaque(p:vec4f)->bool{
 let q=vec2i(p.xy)*2;
 let far=min(min(textureLoad(shadowOpaque,q,0),textureLoad(shadowOpaque,q+vec2i(1,0),0)),min(textureLoad(shadowOpaque,q+vec2i(0,1),0),textureLoad(shadowOpaque,q+vec2i(1,1),0)));
 return p.z<far;
}
/** A blended caster's texel of the transmittance layer, blended multiplicatively; the depth-only
 *  draw masks its colour and keeps its depth. */
@fragment fn shadow_blend_fs(in:ShadowOut)->@location(0) vec4f{
 let gx=dpdx(in.uv);let gy=dpdy(in.uv);
 if(!shadowKeep(in,gx,gy)||shadowHiddenByOpaque(in.position)){discard;}
 return blendTransmittance(pages[in.instance],in.uv,gx,gy);
}`;
