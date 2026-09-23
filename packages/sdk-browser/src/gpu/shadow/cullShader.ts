import { MAX_SHADOW_REGIONS } from './recordPack.ts';

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
/** What both entries share: the spheres and mobility words they test, the kept lists they fill,
 *  and the test itself — one caster row against one region. Each declares the volumes itself. */
const CULL_COMMON = `struct Sphere{center:vec3f,radius:f32,}
struct Face{center:vec3f,far:f32,axis:vec3f,halfAngle:f32,right:vec3f,halfU:f32,up:vec3f,halfV:f32,casters:u32,view:u32,pad1:u32,pad2:u32,}
@group(0) @binding(0) var<storage, read> spheres:array<Sphere>;
@group(0) @binding(3) var<storage, read_write> kept:array<u32>;
@group(0) @binding(4) var<storage, read_write> indirect:array<atomic<u32>>;
@group(0) @binding(7) var<storage, read> mobility:array<u32>;

/** One instance, one region: kept or not. Result order is free — the GPU keeps a depth
 *  minimum, and a minimum does not depend on write order. */
fn keepCaster(face:u32,row:u32,capacity:u32){
 let volume=faces[face];
 // Which casters the region draws: every one, the static ones, or the moving ones.
 if(volume.casters!=${CASTERS_ALL}u&&(mobility[row]!=0u)!=(volume.casters==${CASTERS_MOVING}u)){return;}
 let sphere=spheres[row];
 let delta=sphere.center-volume.center;
 if(volume.halfAngle<0.0){
  let local=abs(vec3f(dot(delta,volume.right),dot(delta,volume.up),dot(delta,volume.axis)));
  let gap=max(local-vec3f(volume.halfU,volume.halfV,volume.far),vec3f(0.0));
  if(dot(gap,gap)>sphere.radius*sphere.radius){return;}
 }else{
  let distance=length(delta);
  if(distance-sphere.radius>volume.far){return;}
  if(volume.halfAngle<3.14159&&distance>sphere.radius){
   let axis=clamp(dot(delta,volume.axis)/distance,-1.0,1.0);
   if(acos(axis)-asin(clamp(sphere.radius/distance,0.0,1.0))>volume.halfAngle){return;}
  }
 }
 let rank=atomicAdd(&indirect[face*4u+1u],1u);
 kept[face*capacity+rank]=row;
}
`;

export const SHADOW_CULL_SHADER = `${CULL_COMMON}
struct Uni{firstFace:u32,faces:u32,sourceBase:u32,indirectBase:u32,commands:u32,capacity:u32,pad0:u32,pad1:u32,}
@group(0) @binding(1) var<storage, read> source:array<u32>;
@group(0) @binding(2) var<storage, read> sourceIndirect:array<u32>;
@group(0) @binding(5) var<uniform> uni:Uni;
@group(0) @binding(6) var<storage, read> faces:array<Face>;

/** Instances of the face's list: the sum of its commands, contiguous from \`sourceBase\`. */
fn listed()->u32{
 var sum=0u;
 for(var command=0u;command<uni.commands;command++){sum=sum+sourceIndirect[uni.indirectBase+command*4u+1u];}
 return min(sum,uni.capacity);
}

@compute @workgroup_size(64)
fn shadowCullScatter(@builtin(global_invocation_id) id:vec3u){
 let index=id.x;
 if(id.y>=uni.faces||index>=listed()){return;}
 keepCaster(uni.firstFace+id.y,source[uni.sourceBase+index],uni.capacity);
}
`;

/**
 * The GPU light cut's casters, culled straight from its drawn log: one thread per drawn page and
 * per region of the frame, every view in the same dispatch. A region's view (`Face.view`) names its
 * range of the log — its start and its count, words of the cut's `work` — and each page finds the
 * row that holds it through `rowOf` (`../draw/lightRows.ts`); an entry the map no longer vouches
 * for — the row moved or left — is skipped. No list is built between the cut and the cull.
 *
 * The volumes come in as a uniform — a frame's regions are few — so that the draw records and the
 * map fit the eight storage buffers a compute stage is guaranteed.
 */
export const SHADOW_LIGHT_CULL_SHADER = `${CULL_COMMON}
struct DrawItem{pageIndex:u32,bin:u32,selectionIndex:u32,layer:u32,triangles:u32,}
struct Uni{logBase:u32,offsetWord:u32,countWord:u32,capacity:u32,rows:u32,pad0:u32,pad1:u32,pad2:u32,}
@group(0) @binding(1) var<storage, read> drawn:array<u32>;
@group(0) @binding(2) var<storage, read> work:array<u32>;
@group(0) @binding(5) var<uniform> uni:Uni;
@group(0) @binding(6) var<uniform> faces:array<Face,${MAX_SHADOW_REGIONS}>;
@group(0) @binding(8) var<storage, read> items:array<DrawItem>;
@group(0) @binding(9) var<storage, read> rowOf:array<u32>;

@compute @workgroup_size(64)
fn shadowCullLight(@builtin(global_invocation_id) id:vec3u){
 let s=id.x;let face=id.y;
 let view=faces[face].view;
 if(s>=min(work[uni.countWord+view],uni.capacity)){return;}
 let page=drawn[uni.logBase+work[uni.offsetWord+view]+s];
 let row=rowOf[page];
 if(row>=uni.rows||items[row].selectionIndex!=page){return;}
 keepCaster(face,items[row].pageIndex,uni.capacity);
}
`;
