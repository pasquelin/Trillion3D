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
import { FEEDBACK_RULE_WGSL, tileRequestIndexWgsl } from '../../webgpu/tile/requestWgsl.ts';
import { PICK_BLENDS } from '../../webgpu/tile/feedback.ts';
import {
  FLAG_BLEND_CASTER,
  FLAG_HAS_MAP,
  FLAG_MASK,
  FLAG_SAMPLED,
} from '../../visibility/types.ts';
import { BLEND_TRANSMITTANCE_WGSL } from './transmittance.ts';
import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';

/** Subtexel steps the rasterizer snaps a corner to, per texel: WebGPU's (D3D's) 8-bit fixed-point
 *  window grid (#26 step C, #1016). */
const SHADOW_SUBTEXELS = 256;
/** Steps across a page of the rasterizer's grid. */
export const PAGE_STEPS = SHADOW_PAGE * SHADOW_SUBTEXELS;

/** The clip position `p` of a caster's corner through `m`. A sun's projection is orthographic
 *  (last row 0,0,0,1): its x and y are put on the rasterizer's grid of the page, so their window
 *  position — the page's integer place in the pool plus that — is exact in f32 and the rasterizer
 *  covers the same texels with the same depths in every slot of the pool (#26). A lamp's is divided
 *  by the hardware, as it is. Halves round up (`floor(x+0.5)`), as the shadow reads do. */
export const SHADOW_CORNER_WGSL = `fn shadowPageCorner(c:f32)->f32{
 return floor((c*0.5+0.5)*${PAGE_STEPS}.0+0.5)*${2 / PAGE_STEPS}-1.0;
}
fn shadowSunCorner(m:mat4x4f,p:vec4f)->vec4f{
 if(m[0].w!=0.0||m[1].w!=0.0||m[2].w!=0.0||m[3].w!=1.0){return p;}
 return vec4f(shadowPageCorner(p.x),shadowPageCorner(p.y),p.z,p.w);
}`;
/** A row whose cutout reads a base map: masked, and with a map. */
const CUTOUT_MAP = FLAG_MASK | FLAG_HAS_MAP;

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
${PAGE_LOOKUP_WGSL}
${PAGE_GEOMETRY_WGSL}
${tilePoolWgsl('0.0')}
${COLOR_SAMPLE_WGSL}
${maskAlphaWgsl(true)}
${MASK_KEEP_WGSL}
${tileRequestIndexWgsl('color')}
${FEEDBACK_RULE_WGSL}
${BLEND_TRANSMITTANCE_WGSL}
/** The texels a sun corner \`reach\` texels from any page origin of the pool snaps to: the
 *  rasterizer's own subtexel, or, past what f32 holds at that subtexel, the f32 step there — the
 *  same at every origin, as the reach counts the whole pool, not the page's origin (#1016). */
fn snapGrid(reach:f32)->f32{
 var grid=1.0/${SHADOW_SUBTEXELS}.0;var edge=${2 ** 24 / SHADOW_SUBTEXELS}.0;
 for(var i=0u;i<32u&&reach>=edge;i++){grid*=2.0;edge*=2.0;}
 return grid;
}
/** A corner of an affine face — the sun's orthographic pages, whose matrix has no projective
 *  row, w 1 — snapped on its page viewport (\`params.w\` texels over two clip units, a pool
 *  \`params.w / params.z\` texels wide) to \`snapGrid\`: the viewport adds the physical page's
 *  origin to it exactly, however far the caster reaches past the page, so a page rasterizes alike
 *  wherever the pool puts it. A perspective face (a lamp's) is left as it is. */
fn sunSnap(p:vec4f)->vec4f{
 let m=shadow.viewProjection;
 if(m[0].w!=0.0||m[1].w!=0.0||m[2].w!=0.0){return p;}
 let half=shadow.params.w*0.5;let pool=shadow.params.w/shadow.params.z+half;
 let sx=half/snapGrid(abs(p.x)*half+pool);let sy=half/snapGrid(abs(p.y)*half+pool);
 return vec4f(round(p.x*sx)/sx,round(p.y*sy)/sy,p.z,p.w);
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
 *  of the two the read mixes, picked as the camera's pixels pick; both during a convergence
 *  (\`everyPick\`) —, in its phase, into the texture feedback's counters (\`faceBindings.ts\`): what
 *  it reads is then what the pose asked. */
fn cutoutPost(page:PageInfo,in:ShadowOut,gx:vec2f,gy:vec2f,p:RequestPick){
 let rank=colorRequestIndex(page.mapIndex,in.uv,gx,gy,p.next,1u,false,(page.flags&${FLAG_SAMPLED}u)!=0u,false);
 if(rank!=0u){atomicAdd(&tileFeedback[rank-1u],1u);}
}
fn cutoutRequest(in:ShadowOut,gx:vec2f,gy:vec2f){
 let page=pages[in.instance];
 if(cutoutWord.y==0u||(page.flags&${CUTOUT_MAP}u)!=${CUTOUT_MAP}u||!feedbackPhase(in.position.xy,cutoutWord.x)){return;}
 if(!feedbackEvery(cutoutWord.x)){cutoutPost(page,in,gx,gy,requestPick(in.position.xy,1u,cutoutWord.x));return;}
 for(var turn=0u;turn<${PICK_BLENDS}u;turn++){cutoutPost(page,in,gx,gy,everyPick(in.position.xy,1u,turn));}
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
