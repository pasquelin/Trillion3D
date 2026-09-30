import { DRAW_INDIRECT_WORDS, DRAW_ITEM_WGSL } from '../draw/contract.ts';
import { MAX_SHADOW_REGIONS } from './recordPack.ts';
import {
  CULL_UNIFORM_WORDS,
  LIGHT_CULL_UNIFORM_WORDS,
  SHADOW_REGION_COMMANDS,
  SHADOW_TESTED_WORD,
  wordStruct,
} from './batchBudget.ts';

/**
 * Per-shadow-region reject: from the instance list the LIGHT CUT of the region's face produced,
 * a region keeps only clusters whose world sphere touches its volume — for a perspective face,
 * the light's range and the region's cone; for a sun page, the box the page cuts in the
 * extent, its rectangle on the light plane by the whole depth of the map, flagged by a negative
 * half-angle. The others would be rejected anyway by the far plane or by the projection's side
 * planes and the scissor: the atlas comes out texel-for-texel identical.
 *
 Two entries share that test. `shadowCullScatter` reads the list the CPU cut wrote for one face:
 * `firstFace` and `faces` name its regions, `sourceBase` where its list starts, and the `commands`
 * indirect commands from `indirectBase` how long it is. `shadowCullLight` (`SHADOW_LIGHT_CULL_SHADER`)
 * reads what the GPU light cut drew, every view's log at once. The kept counts start at zero: the
 * host writes the frame's commands before the command buffer runs.
 *
 * A region also says which casters it draws (`CASTERS_*`): all of them, the static ones — into the
 * static layer —, or the moving ones, over a page restored from that layer. A row's mobility word
 * says which it is (`../../webgpu/shadow/mobility.ts`).
 */
export const CASTERS_ALL = 0,
  CASTERS_STATIC = 1,
  CASTERS_MOVING = 2;
/** Bits of a row's mobility word (`../../webgpu/shadow/mobility.ts`): its placement moves; its
 *  fragments can be cut — a cutout (`FLAG_MASK`) that is no blended caster (#965); and, from
 *  `MOBILITY_CORNER_SHIFT` up, the corners its page-table row draws (#966). */
export const MOBILITY_MOVING = 1,
  MOBILITY_CUTOUT = 2,
  MOBILITY_CORNER_SHIFT = 2;
/**
 * A region's two lists in its slot of `capacity` rows (#965): the casters no fragment can cut from
 * the slot's start up, counted by the region's first command and drawn with no fragment stage; the
 * cutout casters from its end down, counted by its second and drawn with the fragment test. A row is
 * kept once per region, so the two never meet. The cull and the occlusion test file alike. A list's
 * command draws as many corners as the largest caster it keeps (`keptCorners`, OMB-26, #966): every
 * kept caster's triangles, and never more vertices than the scene's largest cluster asked before.
 */
export const KEPT_LISTS_WGSL = `fn keptCount(region:u32,cutout:bool)->u32{return (region*${SHADOW_REGION_COMMANDS}u+select(0u,1u,cutout))*${DRAW_INDIRECT_WORDS}u+1u;}
fn keptCorners(region:u32,cutout:bool)->u32{return keptCount(region,cutout)-1u;}
fn keptAt(region:u32,rank:u32,capacity:u32,cutout:bool)->u32{return region*capacity+select(rank,capacity-1u-rank,cutout);}`;
/** A region's volume and the test of a caster's sphere against it: every cull's
 *  (\`../../webgpu/shadow/freshCullWgsl.ts\` too). */
export const SHADOW_VOLUME_WGSL = `struct Sphere{center:vec3f,radius:f32,}
struct Face{center:vec3f,far:f32,axis:vec3f,halfAngle:f32,right:vec3f,halfU:f32,up:vec3f,halfV:f32,casters:u32,view:u32,pad1:u32,pad2:u32,}
/** Whether a caster's world sphere touches a region's volume: the cone of a lamp page within its
 *  range, or the box of a sun page. */
fn sphereTouches(volume:Face,sphere:Sphere)->bool{
 let delta=sphere.center-volume.center;
 if(volume.halfAngle<0.0){
  let local=abs(vec3f(dot(delta,volume.right),dot(delta,volume.up),dot(delta,volume.axis)));
  let gap=max(local-vec3f(volume.halfU,volume.halfV,volume.far),vec3f(0.0));
  if(dot(gap,gap)>sphere.radius*sphere.radius){return false;}
 }else{
  let distance=length(delta);
  if(distance-sphere.radius>volume.far){return false;}
  if(volume.halfAngle<3.14159&&distance>sphere.radius){
   // Outside the cone when the angle to its axis exceeds halfAngle + the sphere's angular radius
   // β, sin β = r / d (#OMB-07): compared by cosines, cos(h + β)·d = cos h·√(d² − r²) − sin h·r,
   // with no inverse trigonometry. Only while h + β < π (sin(h + β) > 0); the margin keeps the test
   // conservative — a sphere it drops, the angles dropped too.
   let ch=cos(volume.halfAngle);let sh=sin(volume.halfAngle);
   let tangent=sqrt(max(distance*distance-sphere.radius*sphere.radius,0.0));
   let along=dot(delta,volume.axis);
   let limit=ch*tangent-sh*sphere.radius;
   if(sh*tangent+ch*sphere.radius>0.0&&along<limit-1e-4*distance){return false;}
  }
 }
 return true;
}`;

/** What both entries share: the spheres and mobility words they test, the kept lists they fill,
 *  and the test itself — one caster row against one region. Each declares the volumes itself.
 *  Each counts the casters its group tests — of the kind the region draws, kept or not —, then
 *  adds them once to the batch's tested word (\`flushTested\`, in uniform control flow): what the
 *  kept counts leave of them is what the cull rejected (#1211). */
const CULL_COMMON = `${KEPT_LISTS_WGSL}
${SHADOW_VOLUME_WGSL}
@group(0) @binding(0) var<storage, read> spheres:array<Sphere>;
@group(0) @binding(3) var<storage, read_write> kept:array<u32>;
@group(0) @binding(4) var<storage, read_write> indirect:array<atomic<u32>>;
@group(0) @binding(7) var<storage, read> mobility:array<u32>;
var<workgroup> tested:atomic<u32>;

/** The group's tested casters, added to the batch's word by its first lane, past every lane's. */
fn flushTested(lane:u32){
 workgroupBarrier();
 if(lane==0u){let n=atomicLoad(&tested);if(n>0u){atomicAdd(&indirect[${SHADOW_TESTED_WORD}u],n);}}
}

/** One instance, one region: kept or not. Result order is free — the GPU keeps a depth
 *  minimum, and a minimum does not depend on write order. */
fn keepCaster(face:u32,row:u32,capacity:u32){
 let volume=faces[face];
 let word=mobility[row];
 // Which casters the region draws: every one, the static ones, or the moving ones.
 if(volume.casters!=${CASTERS_ALL}u&&((word&${MOBILITY_MOVING}u)!=0u)!=(volume.casters==${CASTERS_MOVING}u)){return;}
 atomicAdd(&tested,1u);
 if(!sphereTouches(volume,spheres[row])){return;}
 let cutout=(word&${MOBILITY_CUTOUT}u)!=0u;
 kept[keptAt(face,atomicAdd(&indirect[keptCount(face,cutout)],1u),capacity,cutout)]=row;
 let corners=word>>${MOBILITY_CORNER_SHIFT}u;
 if(atomicLoad(&indirect[keptCorners(face,cutout)])<corners){atomicMax(&indirect[keptCorners(face,cutout)],corners);}
}
`;

/** Invocations of a workgroup of the region culls, one caster row each. */
export const SHADOW_CULL_GROUP = 64;

export const SHADOW_CULL_SHADER = `${CULL_COMMON}
${wordStruct('Uni', ['firstFace:u32', 'faces:u32', 'sourceBase:u32', 'indirectBase:u32', 'commands:u32', 'capacity:u32'], CULL_UNIFORM_WORDS)}
@group(0) @binding(1) var<storage, read> source:array<u32>;
@group(0) @binding(2) var<storage, read> sourceIndirect:array<u32>;
@group(0) @binding(5) var<uniform> uni:Uni;
@group(0) @binding(6) var<storage, read> faces:array<Face>;

/** Instances of the face's list: the sum of its commands, contiguous from \`sourceBase\`. */
fn listed()->u32{
 var sum=0u;
 for(var command=0u;command<uni.commands;command++){sum=sum+sourceIndirect[uni.indirectBase+command*${DRAW_INDIRECT_WORDS}u+1u];}
 return min(sum,uni.capacity);
}

@compute @workgroup_size(${SHADOW_CULL_GROUP})
fn shadowCullScatter(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32){
 let index=id.x;
 if(id.y<uni.faces&&index<listed()){keepCaster(uni.firstFace+id.y,source[uni.sourceBase+index],uni.capacity);}
 flushTested(lane);
}
`;

/**
 * The GPU light cut's casters, culled straight from its drawn log: one thread per drawn page and
 * per region of the frame, every view in the same dispatch. A region's view (`Face.view`) names its
 * range of the log — its start and its count, words of the cut's `work` — and each page finds the
 * row that holds it through `rowOf` (`../draw/lightRows.ts`); an entry the map no longer vouches
 * for — the row moved or left — is skipped. A row of `[blendFirst, blendEnd)` is a blended
 * cluster's caster row, which no draw record names: the host pins it and unpins it itself, so it
 * is kept as it is. No list is built between the cut and the cull.
 *
 * The volumes come in as a uniform — a frame's regions are few — so that the draw records and the
 * map fit the eight storage buffers a compute stage is guaranteed.
 */
export const SHADOW_LIGHT_CULL_SHADER = `${CULL_COMMON}
${DRAW_ITEM_WGSL}
${wordStruct('Uni', ['logBase:u32', 'offsetWord:u32', 'countWord:u32', 'capacity:u32', 'rows:u32', 'blendFirst:u32', 'blendEnd:u32'], LIGHT_CULL_UNIFORM_WORDS)}
@group(0) @binding(1) var<storage, read> drawn:array<u32>;
@group(0) @binding(2) var<storage, read> work:array<u32>;
@group(0) @binding(5) var<uniform> uni:Uni;
@group(0) @binding(6) var<uniform> faces:array<Face,${MAX_SHADOW_REGIONS}>;
@group(0) @binding(8) var<storage, read> items:array<DrawItem>;
@group(0) @binding(9) var<storage, read> rowOf:array<u32>;

@compute @workgroup_size(64)
fn shadowCullLight(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32){
 cullLight(id.x,id.y);
 flushTested(lane);
}
fn cullLight(s:u32,face:u32){
 let view=faces[face].view;
 if(s>=min(work[uni.countWord+view],uni.capacity)){return;}
 let page=drawn[uni.logBase+work[uni.offsetWord+view]+s];
 let row=rowOf[page];
 if(row>=uni.blendFirst&&row<uni.blendEnd){keepCaster(face,row,uni.capacity);return;}
 if(row>=uni.rows||items[row].selectionIndex!=page){return;}
 keepCaster(face,items[row].pageIndex,uni.capacity);
}
`;
