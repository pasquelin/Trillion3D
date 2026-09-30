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
 *  lists are the occlusion test's; bit 3, lamp pages, drawn over the whole layer (`GROUP_LAYER`). */
export const GROUP_TESTED = 4,
  GROUP_LAYER = 8;

/**
 * THE MOVING CASTERS OF A PASS'S RESTORED PAGES, DRAWN BY GROUP (#1345), entries of the shadow
 * depth shader (`shader.ts`). A group is every restored page of one pass whose lists are the cull's,
 * or all the occlusion test's, and, for a sun, in one block of its layer — a square of `B` texels,
 * `B` the layer's largest power of two, at its left or right, top or bottom edge: every page lies in
 * one —; for a lamp, anywhere in its layer (`GROUP_LAYER`). Instance `i` of the group's draw is its
 * `i`-th pair: a place in the kept lists (`KEPT_LISTS_WGSL`), which names the region (`place /
 * capacity`) and, in `groupInstances`, the caster row. The group table (`groupTable`) says where
 * each group's pairs lie (`groupPairs`).
 *
 * `groupPlace` carries a snapped sun corner from its page's viewport to the block's: the page's
 * `(p·half) + (first + half)` and the block's `(q·side) + (origin + side)`, which the rasterizer
 * computes, are the same f32 value, since `q·side` is exactly `p·half + (first − origin + half −
 * side)` — a power-of-two scale, and a sum exact on the snap's grid (`sunSnap`); at the
 * transmittance layer's half resolution, both halve exactly. A lamp's perspective corner is carried
 * onto its page's square of the layer in clip space, `x' = x·s + o·w`, by the GPU's own pages'
 * `freshPlace`: the perspective divide commutes with it. The fragment keeps the page's texels
 * alone (`pageHolds`) and, for a lamp, what lies outside its emitter's envelope.
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
 let view=groupViews[region].view;let bits=groupTable[head+2u];
 var out=shadowVertexIn(view,vertexIndex&${2 ** GROUP_SHIFT - 1}u,groupInstances[place],blended);
 if((bits&${GROUP_LAYER}u)!=0u){
  out.position=freshPlace(FreshView(view,groupViews[region].rect),out.position);
 }else{
  let square=groupBlock(view,bits);
  out.position=groupPlace(out.position,pageFirst(view),view.params.w*0.5,square.xy,square.z);
 }
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
/** A texel of the region's page off its emitter's envelope (a sun has none), as \`shadow_fs\`. */
@fragment fn shadow_group_fs(in:ShadowOut){
 let view=groupViews[in.region].view;let radius=view.emitter.w;
 if(!pageHolds(view,in.position.xy)||(radius>0.0&&dot(in.fromEmitter,in.fromEmitter)<radius*radius)){discard;}
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

/**
 * THE LAMP GROUPS' VERTEX STAGE, on a device that clips by `clip-distances` (#1345): a lamp group
 * draws over its whole layer, so each caster is clipped to its page's square of the layer — the
 * page quad's (`page_quad_vs`), `x/w` within `rect.x ∓ rect.z` — by four clip distances, as its
 * own viewport clipped it: no fragment is rasterized past the page, however far the caster reaches
 * (a caster near a lamp spans many pages). The distances are homogeneous, so a corner behind the
 * lamp (`w < 0`) is clipped too. A device without the feature draws lamp pages one by one.
 */
export const SHADOW_GROUP_LAMP_WGSL = `
struct GroupOut{@invariant @builtin(position) position:vec4f,@location(0) @interpolate(flat) instance:u32,@location(1) uv:vec2f,@location(2) fromEmitter:vec3f,@location(3) @interpolate(flat) region:u32,@builtin(clip_distances) clip:array<f32,4>,}
fn groupLampCaster(vertexIndex:u32,instance:u32,cutout:bool,blended:bool)->GroupOut{
 let c=groupCaster(vertexIndex,instance,cutout,blended);let r=groupViews[c.region].rect;let p=c.position;
 let lo=min(r.xy-r.zw,r.xy+r.zw)*p.w;let hi=max(r.xy-r.zw,r.xy+r.zw)*p.w;
 var clip:array<f32,4>;clip[0]=p.x-lo.x;clip[1]=hi.x-p.x;clip[2]=p.y-lo.y;clip[3]=hi.y-p.y;
 return GroupOut(p,c.instance,c.uv,c.fromEmitter,c.region,clip);
}
@vertex fn shadow_group_lamp_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->GroupOut{
 return groupLampCaster(vertexIndex,instanceIndex,false,false);
}
@vertex fn shadow_group_lamp_cutout_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->GroupOut{
 return groupLampCaster(vertexIndex,instanceIndex,true,false);
}
@vertex fn shadow_group_lamp_blend_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->GroupOut{
 return groupLampCaster(vertexIndex,instanceIndex,false,true);
}`;
