import { DRAW_INDIRECT_STRIDE, DRAW_INDIRECT_WORDS } from '../draw/contract.ts';
import { PAGE_INFO_STRUCT_WGSL } from '../../visibility/shader/pageWgsl.ts';
import { MAX_SHADOW_REGIONS } from './recordPack.ts';
import {
  BIN_UNIFORM_WORDS,
  SHADOW_FACE_STRIDE,
  SHADOW_REGION_COMMANDS,
  wordStruct,
} from './batchBudget.ts';
import { KEPT_LISTS_WGSL, MOBILITY_CORNER_SHIFT } from './cullShader.ts';

/**
 * RASTER BINS BY SIZE CLASS (OMB-26, #966), as cluster bins its clusters before it rasterizes them.
 * A region's list draws every caster at the corners of its largest; binned, the casters of one
 * class — a run of 32 triangles, `SHADOW_BIN_CORNERS` corners, up to the 128 of a cluster — draw
 * at the corners of the largest of that class. The invariant: each bin draws the same casters,
 * each through every one of its triangles — a command's corners are the most any of its casters
 * has —, so the pool holds the same depths, bit for bit; no caster runs more than 31 padded
 * triangles, and no command more corners than its region's list did, so a region never runs more
 * vertex invocations than before. The last class takes every larger caster: a line page's, say.
 */
export const SHADOW_BIN_CLASSES = 4;
const SHADOW_BIN_CORNERS = 96;
/** A region's commands — its two lists' (`KEPT_LISTS_WGSL`), one per class each — and bytes. */
const SHADOW_BIN_COMMANDS = SHADOW_REGION_COMMANDS * SHADOW_BIN_CLASSES;
export const SHADOW_BIN_REGION_BYTES = SHADOW_BIN_COMMANDS * DRAW_INDIRECT_STRIDE;
/** Words a caster place holds with its stored matrix (OMB-25): its row, then 16 floats. */
export const BIN_STORED_STRIDE = 17;
/** Invocations of a bin workgroup: one workgroup a region. */
const BIN_GROUP = 64;
if (MAX_SHADOW_REGIONS > 64) throw new Error('SHADOW_BIN_MASK: two words name 64 regions at most');

/** The class of a caster by its mobility word's corners (`binOf` in the kernel). */
export function shadowBinOf(word: number) {
  const corners = word >>> MOBILITY_CORNER_SHIFT;
  return corners
    ? Math.min(Math.floor((corners - 1) / SHADOW_BIN_CORNERS), SHADOW_BIN_CLASSES - 1)
    : 0;
}

/**
 * OMB-25 (#966), the `shadowLocalToClip` option: each kept caster's LocalToClip — its region's
 * view-projection times its world, `viewProjection*world`, the very product the vertex stage forms
 * per corner — computed once, here, and stored after the lists' rows: `MAX_SHADOW_REGIONS` lists of
 * `capacity` rows, then 16 floats per place. The stored entries (`storedWgsl.ts`) read it and form
 * one matrix-vector product per corner. Off by default: the GPU may contract the product apart
 * from the vertex stage's, so its depths may differ by an ulp — class 2, declared.
 */
const STORED_WGSL = `fn localToClip(region:u32,row:u32)->mat4x4f{return views[region].viewProjection*pages[row].world;}
fn storeLocalToClip(place:u32,m:mat4x4f){
 let at=${MAX_SHADOW_REGIONS}u*uni.capacity+place*16u;
 ${Array.from({ length: 16 }, (_, k) => `binned[at+${k}u]=bitcast<u32>(m[${k >> 2}].${'xyzw'[k & 3]});`).join('')}
}`;

/**
 * One workgroup per region the uniform's mask names: it counts its kept casters by list and class
 * and takes each class's largest corners (`binCount`), writes a command per class — its corners,
 * its casters, from the list's first instance on (`binCommands`) —, then files each caster at its
 * class's place (`binScatter`), from the slot's start for the first list and from its end down for
 * the cutouts, as the cull files them (`keptAt`). The draws read the binned list as they read the
 * cull's, an instance's first index the class's first place. Order within a class is free: the
 * pool keeps a depth minimum.
 */
export const shadowBinShader = (stored: boolean) => `${KEPT_LISTS_WGSL}
${PAGE_INFO_STRUCT_WGSL}
struct View{@size(${SHADOW_FACE_STRIDE}) viewProjection:mat4x4f,}
${wordStruct('Uni', ['regions:u32', 'capacity:u32', 'maskLow:u32', 'maskHigh:u32'], BIN_UNIFORM_WORDS)}
@group(0) @binding(0) var<uniform> uni:Uni;
@group(0) @binding(1) var<storage,read> list:array<u32>;
@group(0) @binding(2) var<storage,read> counts:array<u32>;
@group(0) @binding(3) var<storage,read> mobility:array<u32>;
@group(0) @binding(4) var<storage,read_write> binned:array<u32>;
@group(0) @binding(5) var<storage,read_write> commands:array<u32>;
@group(0) @binding(6) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(7) var<storage,read> views:array<View>;
var<workgroup> binTotal:array<atomic<u32>,${SHADOW_BIN_COMMANDS}>;
var<workgroup> binCorners:array<atomic<u32>,${SHADOW_BIN_COMMANDS}>;
var<workgroup> binNext:array<atomic<u32>,${SHADOW_BIN_COMMANDS}>;
var<workgroup> binFirst:array<u32,${SHADOW_BIN_COMMANDS}>;
fn binOf(word:u32)->u32{let corners=word>>${MOBILITY_CORNER_SHIFT}u;if(corners==0u){return 0u;}return min(u32((corners-1u)/${SHADOW_BIN_CORNERS}u),${SHADOW_BIN_CLASSES - 1}u);}
fn binIndex(cutout:bool,word:u32)->u32{return select(0u,${SHADOW_BIN_CLASSES}u,cutout)+binOf(word);}
fn binCommand(region:u32,bin:u32)->u32{return (region*${SHADOW_BIN_COMMANDS}u+bin)*${DRAW_INDIRECT_WORDS}u;}
fn binMasked(region:u32)->bool{return region<uni.regions&&((select(uni.maskHigh,uni.maskLow,region<32u)>>(region&31u))&1u)!=0u;}
/** The first list's length, and both lists' together. */
fn binLists(region:u32)->vec2u{let opaque=min(counts[keptCount(region,false)],uni.capacity);return vec2u(opaque,opaque+min(counts[keptCount(region,true)],uni.capacity-opaque));}
fn binRow(region:u32,i:u32,opaque:u32,cutout:bool)->u32{return list[keptAt(region,select(i,i-opaque,cutout),uni.capacity,cutout)];}
fn binClear(lane:u32){if(lane<${SHADOW_BIN_COMMANDS}u){atomicStore(&binTotal[lane],0u);atomicStore(&binCorners[lane],0u);atomicStore(&binNext[lane],0u);}}
fn binCount(region:u32,lane:u32,lists:vec2u){
 for(var i=lane;i<lists.y;i+=${BIN_GROUP}u){
  let cutout=i>=lists.x;let word=mobility[binRow(region,i,lists.x,cutout)];let bin=binIndex(cutout,word);
  atomicAdd(&binTotal[bin],1u);atomicMax(&binCorners[bin],word>>${MOBILITY_CORNER_SHIFT}u);
 }
}
fn binCommands(region:u32){
 for(var cutout=0u;cutout<2u;cutout++){
  var at=0u;
  for(var c=0u;c<${SHADOW_BIN_CLASSES}u;c++){
   let bin=cutout*${SHADOW_BIN_CLASSES}u+c;let n=atomicLoad(&binTotal[bin]);let command=binCommand(region,bin);
   binFirst[bin]=at;
   commands[command]=atomicLoad(&binCorners[bin]);commands[command+1u]=n;commands[command+2u]=0u;commands[command+3u]=at;
   at+=n;
  }
 }
}
${stored ? STORED_WGSL : ''}
fn binScatter(region:u32,lane:u32,lists:vec2u){
 for(var i=lane;i<lists.y;i+=${BIN_GROUP}u){
  let cutout=i>=lists.x;let row=binRow(region,i,lists.x,cutout);let bin=binIndex(cutout,mobility[row]);
  let place=keptAt(region,binFirst[bin]+atomicAdd(&binNext[bin],1u),uni.capacity,cutout);
  binned[place]=row;${stored ? 'storeLocalToClip(place,localToClip(region,row));' : ''}
 }
}
@compute @workgroup_size(${BIN_GROUP}) fn shadowBin(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_index) lane:u32){
 let region=wg.x;
 if(!binMasked(region)){return;}
 let lists=binLists(region);
 binClear(lane);
 workgroupBarrier();
 binCount(region,lane,lists);
 workgroupBarrier();
 if(lane==0u){binCommands(region);}
 workgroupBarrier();
 binScatter(region,lane,lists);
}`;
