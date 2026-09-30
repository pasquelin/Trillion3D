import { KEPT_LISTS_WGSL } from './cullShader.ts';
import { MAX_SHADOW_REGIONS, SHADOW_FACE_READ_BYTES } from './recordPack.ts';
import {
  GROUP_CAPACITY_WORD,
  GROUP_TABLE_WORDS,
  GROUP_WORDS,
  SHADOW_FACE_STRIDE,
} from './batchBudget.ts';

/** A group draw's first vertex carries its group this many bits up; its corner is below. */
const GROUP_SHIFT = 16;
/** A group's block word: bit 0, the block at the layer's right; bit 1, at its bottom; bit 2, its
 *  lists are the occlusion test's. */
export const GROUP_TESTED = 4;

/**
 * THE MOVING CASTERS OF A PASS'S SUN PAGES, DRAWN BY GROUP (#1345), entries of the shadow depth
 * shader (`shader.ts`). A group is every restored sun page of one pass in one block of its layer —
 * a square of `B` texels, `B` the layer's largest power of two, at its left or right, top or bottom
 * edge: every page lies in one — whose lists are the cull's, or all the occlusion test's. Instance
 * `i` of the group's draw is its `i`-th pair: a place in the kept lists (`KEPT_LISTS_WGSL`), which
 * names the region (`place / capacity`) and, in `groupInstances`, the caster row. The group table
 * (`groupTable`) says where each group's pairs lie (`groupPairs`).
 *
 * `groupPlace` carries a snapped sun corner from its page's viewport to the block's: the page's
 * `(p·half) + (first + half)` and the block's `(q·side) + (origin + side)`, which the rasterizer
 * computes, are the same f32 value, since `q·side` is exactly `p·half + (first − origin + half −
 * side)` — a power-of-two scale, and a sum exact on the snap's grid (`sunSnap`); at the
 * transmittance layer's half resolution, both halve exactly. The fragment keeps the page's texels
 * alone (`pageHolds`): the page draws what its own viewport drew, to the bit. A lamp's perspective
 * page cannot be carried so — the rasterizer divides the carried corner by `w` in f32, which moves
 * a texel's edge by an ulp (`groupPlace.test.ts`) — and draws in its own viewport.
 */
export const SHADOW_GROUP_DRAWS_WGSL = `
struct GroupView{view:ShadowView,@size(${SHADOW_FACE_STRIDE - SHADOW_FACE_READ_BYTES}) rect:vec4f,}
@group(2) @binding(4) var<storage,read> groupViews:array<GroupView,${MAX_SHADOW_REGIONS}>;
@group(2) @binding(5) var<storage,read> groupTable:array<u32,${GROUP_TABLE_WORDS}>;
@group(2) @binding(6) var<storage,read> groupPairs:array<u32>;
@group(2) @binding(7) var<storage,read> groupInstances:array<u32>;
/** Clip \`p\` of a sun page whose first texel is \`first\`, \`half\` texels a half side, carried onto
 *  the block at \`origin\`, \`side\` texels a half side: the same window position. */
fn groupPlace(p:vec4f,first:vec2f,half:f32,origin:vec2f,side:f32)->vec4f{
 let x=(p.x*half+(first.x-origin.x+half-side))/side;
 let y=(p.y*half+(origin.y-first.y+side-half))/side;
 return vec4f(x,y,p.z,p.w);
}
/** The first texel of the block of \`view\`'s layer its \`bits\` name, and its half side. */
fn groupBlock(view:ShadowView,bits:u32)->vec3f{
 let layer=u32(round(view.params.w/view.params.z));let side=f32(1u<<firstLeadingBit(layer));
 let far=f32(layer)-side;
 return vec3f(select(0.0,far,(bits&1u)!=0u),select(0.0,far,(bits&2u)!=0u),side*0.5);
}
/** The \`instance\`-th pair of the group the first vertex names, cutout or not, \`blended\` casters
 *  alone or the others, at its corner. */
fn groupCaster(vertexIndex:u32,instance:u32,cutout:bool,blended:bool)->ShadowOut{
 let head=${MAX_SHADOW_REGIONS}u+(vertexIndex>>${GROUP_SHIFT}u)*${GROUP_WORDS}u;
 let at=select(groupTable[head]+instance,groupTable[head+1u]-1u-instance,cutout);
 let place=groupPairs[at];let region=place/groupTable[${GROUP_CAPACITY_WORD}u];
 let view=groupViews[region].view;
 var out=shadowVertexIn(view,vertexIndex&${2 ** GROUP_SHIFT - 1}u,groupInstances[place],blended);
 let square=groupBlock(view,groupTable[head+2u]);
 out.position=groupPlace(out.position,pageFirst(view),view.params.w*0.5,square.xy,square.z);
 out.region=region;
 return out;
}
@vertex fn shadow_group_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->ShadowOut{
 return groupCaster(vertexIndex,instanceIndex,false,false);
}
@vertex fn shadow_group_cutout_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->ShadowOut{
 return groupCaster(vertexIndex,instanceIndex,true,false);
}
@vertex fn shadow_group_blend_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->ShadowOut{
 return groupCaster(vertexIndex,instanceIndex,false,true);
}
/** A texel of the region's page, no fragment test of its own. */
@fragment fn shadow_group_fs(in:ShadowOut){
 if(!pageHolds(groupViews[in.region].view,in.position.xy)){discard;}
}
/** A cutout caster's texel of the region's page, as \`shadow_fs\` keeps it. */
@fragment fn shadow_group_cutout_fs(in:ShadowOut){
 let gx=dpdx(in.uv);let gy=dpdy(in.uv);let view=groupViews[in.region].view;
 if(!pageHolds(view,in.position.xy)){discard;}
 cutoutRequest(in,gx,gy);
 if(!shadowKeepAt(view.emitter,in,gx,gy)){discard;}
}
/** A blended caster's texel of the region's page, at the transmittance layer's half resolution,
 *  as \`shadow_blend_fs\` keeps and tints it. */
@fragment fn shadow_group_blend_fs(in:ShadowOut,@builtin(front_facing) front:bool)->@location(0) vec4f{
 let gx=dpdx(in.uv);let gy=dpdy(in.uv);let view=groupViews[in.region].view;
 if(!pageHolds(view,in.position.xy*2.0)||!shadowKeepAt(view.emitter,in,gx,gy)||shadowHiddenByOpaque(in.position)){discard;}
 let caster=pages[in.instance];
 if(!volumeBoundary(caster,front)){discard;}
 return blendTransmittance(caster,in.uv,gx,gy,shadowBlendRay(view,in));
}`;

/**
 * The pairs of every group of a batch (#1345), one workgroup per region: a region of a group
 * reserves its count of each list in the group's command — its corners the largest of its regions',
 * its first vertex the group —, then copies its places, the opaque list from the group's first pair
 * up, the cutout list from its end down: a group holds each region's `capacity` rows, so the two
 * never meet. The counts come from the cull's commands or the occlusion test's (`GROUP_TESTED`).
 */
export const SHADOW_GROUP_PAIRS_WGSL = `${KEPT_LISTS_WGSL}
@group(0) @binding(0) var<storage,read> table:array<u32,${GROUP_TABLE_WORDS}>;
@group(0) @binding(1) var<storage,read> culled:array<u32>;
@group(0) @binding(2) var<storage,read> visible:array<u32>;
@group(0) @binding(3) var<storage,read_write> args:array<atomic<u32>>;
@group(0) @binding(4) var<storage,read_write> pairs:array<u32>;
var<workgroup> claimed:u32;
@compute @workgroup_size(64) fn shadowGroupPairs(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_index) lane:u32){
 let region=wg.x;let word=table[region];
 if(word==0u){return;}
 let owner=word-1u;let head=${MAX_SHADOW_REGIONS}u+owner*${GROUP_WORDS}u;
 let first=table[head];let last=table[head+1u];let tested=(table[head+2u]&${GROUP_TESTED}u)!=0u;
 let capacity=table[${GROUP_CAPACITY_WORD}u];
 for(var list=0u;list<2u;list++){
  let cutout=list==1u;let command=owner*8u+list*4u;
  let count=select(culled[keptCount(region,cutout)],visible[keptCount(region,cutout)],tested);
  if(lane==0u){
   claimed=atomicAdd(&args[command+1u],count);
   atomicMax(&args[command],select(culled[keptCorners(region,cutout)],visible[keptCorners(region,cutout)],tested));
   atomicStore(&args[command+2u],owner<<${GROUP_SHIFT}u);
  }
  let base=workgroupUniformLoad(&claimed);
  for(var i=lane;i<count;i+=64u){
   let at=base+i;
   pairs[select(first+at,last-1u-at,cutout)]=keptAt(region,i,capacity,cutout);
  }
  workgroupBarrier();
 }
}`;
