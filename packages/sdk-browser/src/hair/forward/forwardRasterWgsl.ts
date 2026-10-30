import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import {
  HAIR_COVERAGE_FORMAT,
  HAIR_NODE_COUNTER_STORED,
  HAIR_NODE_COUNTERS,
  HAIR_ONLY_DEPTH_FORMAT,
  HAIR_TRANSMITTANCE_FORMAT,
} from '../visibilityMath.ts'
import {
  FORWARD_COMPLETE_COVERAGE,
  FORWARD_MAX_WORK,
  FORWARD_RASTER_TILE,
  FORWARD_SEGMENT_BATCH,
  FORWARD_SHADE_BUCKETS,
  FORWARD_TILE,
  FORWARD_TILE_LISTS,
  FORWARD_TILE_PRIMS,
} from './forwardMath.ts'
import {
  FORWARD_BINDINGS_WGSL,
  FORWARD_CONSTANTS_WGSL,
  FORWARD_PARAMS_WGSL,
  forwardPacking,
  groupSync,
} from './forwardCommonWgsl.ts'
import { forwardShade } from './forwardShadeWgsl.ts'

/** The format the colour raster writes: the colour premultiplied by the coverage, and the coverage. */
export const FORWARD_COLOR_FORMAT: GPUTextureFormat = 'rgba16float'

/** The bindings of the raster, in group 0 (the parameters and the view are 0 and 1), by what it writes. */
const FORWARD_RASTER_BINDING = {
  points: 2,
  prims: 3,
  tiles: 4,
  work: 5,
  counters: 6,
  sceneDepth: 7,
  /** Depth raster: the transmittance, the depth of the nearest strand, the coverage. Colour raster: the lit grid, the counters of the nodes, the colour. */
  out0: 8,
  out1: 9,
  out2: 10,
} as const
const B = FORWARD_RASTER_BINDING
const T = FORWARD_TILE
const LIST = FORWARD_TILE_PRIMS
const SEGMENTS = FORWARD_SEGMENT_BATCH
const BUCKETS = FORWARD_SHADE_BUCKETS

/** The outputs of each form: its bindings, what a pixel keeps of a segment's sample, and what the pixel writes at the end. */
const outputs = (color: boolean) =>
  color
    ? {
        bindings: `@group(0) @binding(${B.out0}) var lightGrid:texture_2d<f32>;
@group(0) @binding(${B.out1}) var<storage,read> nodeCounter:array<u32,${HAIR_NODE_COUNTERS}>;
@group(0) @binding(${B.out2}) var colorOut:texture_storage_2d<${FORWARD_COLOR_FORMAT},write>;
var<workgroup> sampleColor:array<vec2u,${SEGMENTS * FORWARD_RASTER_TILE}>;
fn litNode(id:u32)->vec3f{
 let side=u32(ceil(sqrt(f32(nodeCounter[${HAIR_NODE_COUNTER_STORED}]))));
 return textureLoad(lightGrid,vec2i(i32(id%side),i32(id/side)),0).rgb;
}`,
        keep: `sampleColor[at]=vec2u(pack2x16float(c.xy),pack2x16float(vec2f(c.z,0.0)));`,
        gather: `let packed=sampleColor[at];
     let c=vec3f(unpack2x16float(packed.x),unpack2x16float(packed.y).x);
     colour+=through*cover*c;`,
        sample: `let c=mix(litNode(id),litNode(id+1u),attr);`,
        write: `if(coverage>0.0){textureStore(colorOut,vec2i(pixel),vec4f(colour,min(coverage,1.0)));}`,
      }
    : {
        bindings: `@group(0) @binding(${B.out0}) var transmittanceOut:texture_storage_2d<${HAIR_TRANSMITTANCE_FORMAT},write>;
@group(0) @binding(${B.out1}) var depthOut:texture_storage_2d<${HAIR_ONLY_DEPTH_FORMAT},write>;
@group(0) @binding(${B.out2}) var coverageOut:texture_storage_2d<${HAIR_COVERAGE_FORMAT},write>;
var<workgroup> sampleDepth:array<f32,${SEGMENTS * FORWARD_RASTER_TILE}>;`,
        keep: `sampleDepth[at]=depth;`,
        gather: `nearest=max(nearest,sampleDepth[at]);`,
        sample: ``,
        write: `if(coverage>0.0){
   let covered=min(coverage,1.0);
   textureStore(transmittanceOut,vec2i(pixel),vec4f(1.0-covered,0.0,0.0,0.0));
   textureStore(depthOut,vec2i(pixel),vec4f(nearest,0.0,0.0,0.0));
   textureStore(coverageOut,vec2i(pixel),vec4f(saturate(covered/params.fullCoverage),0.0,0.0,0.0));
  }`,
      }

/**
 * THE RASTER OF THE BINNED SEGMENTS, by tiles of 8 pixels: a workgroup is 64 threads, a thread a pixel, and it takes the next tile to shade from a counter until
 * none is left (`FORWARD_MAX_WORK` at most). A tile of pixels is a quarter of a row of 4 by 4 of a tile of 32, whose gathered lists it walks from the nearest
 * (the first `FORWARD_TILE_LISTS`), and stops at once when all its pixels are complete (coverage over `FORWARD_COMPLETE_COVERAGE`). For a list: each segment is
 * cut to the view and to the tile, its depth range found, and the segments ordered by depth into `FORWARD_SHADE_BUCKETS` buckets; then 32 at a time (a thread
 * a segment) are walked pixel by pixel along their major axis, a pixel keeping the sample if the segment is in front of the opaque depth, with the
 * coverage the strand's radius gives it over the least radius of a pixel there and, in the colour raster, the colour of the lit points mixed along the segment;
 * each pixel (a thread) then takes the 32 segments' samples in order, each through what the ones before it let through. The depth raster keeps the
 * transmittance, the depth of the nearest strand and the coverage of each pixel; the colour raster the premultiplied colour and the coverage, to be laid on the lit image.
 * A group of threads waits at each barrier together: what decides the walk is read through `workgroupUniformLoad`.
 */
export const forwardRasterWgsl = (color: boolean) => {
  const o = outputs(color)
  return wgslProgram(
    `@group(0) @binding(${B.points}) var<storage,read> points:array<vec4f>;
@group(0) @binding(${B.prims}) var<storage,read> prims:array<u32>;
@group(0) @binding(${B.tiles}) var<storage,read> tiles:array<u32>;
@group(0) @binding(${B.work}) var<storage,read> work:array<vec2u>;
@group(0) @binding(${B.counters}) var<storage,read_write> counters:array<atomic<u32>>;
@group(0) @binding(${B.sceneDepth}) var sceneDepth:texture_depth_2d;
${o.bindings}
const INVALID=0xffffffffu;
var<workgroup> segmentDepth:array<u32,${LIST}>;
var<workgroup> sorted:array<u32,${LIST}>;
var<workgroup> leastDepth:atomic<u32>;
var<workgroup> greatestDepth:atomic<u32>;
var<workgroup> bucketCount:array<atomic<u32>,${BUCKETS}>;
var<workgroup> bucketFill:array<atomic<u32>,${BUCKETS}>;
var<workgroup> pixelMask:array<atomic<u32>,${FORWARD_RASTER_TILE * FORWARD_RASTER_TILE}>;
var<workgroup> sampleCover:array<f32,${SEGMENTS * FORWARD_RASTER_TILE}>;
var<workgroup> steepMask:atomic<u32>;
var<workgroup> completeMask:array<atomic<u32>,2>;
var<workgroup> taken:vec4u;
var<workgroup> decided:vec4u;
fn bucketOf(depth:f32,extent:f32)->u32{
 let least=depthOf(atomicLoad(&leastDepth));
 return ${BUCKETS - 1}u-u32(clamp(saturate((depth-least)*extent)*${BUCKETS}.0,0.0,${BUCKETS - 1}.0));
}
fn allComplete()->bool{return atomicLoad(&completeMask[0])==INVALID&&atomicLoad(&completeMask[1])==INVALID;}
@compute @workgroup_size(${FORWARD_RASTER_TILE},${FORWARD_RASTER_TILE},1) fn forwardRaster(@builtin(local_invocation_index) lane:u32,@builtin(local_invocation_id) local:vec3u){
 for(var item=0u;item<${FORWARD_MAX_WORK}u;item++){
  if(lane==0u){
   let workId=atomicAdd(&counters[${color ? 'COUNTER_COLOR_TAKEN' : 'COUNTER_DEPTH_TAKEN'}],1u);
   let fetch=workId/16u;
   var lists=0u;
   var offset=0u;
   let fetched=min(atomicLoad(&counters[COUNTER_WORK]),arrayLength(&work));
   if(fetch<fetched){
    let entry=work[fetch];
    let held=min(atomicLoad(&counters[COUNTER_GATHERED]),params.maxTiles);
    offset=entry.x;
    lists=min(min(entry.y,${FORWARD_TILE_LISTS}u),max(held,offset)-offset);
   }
   taken=vec4u(workId,select(0u,1u,fetch<fetched),offset,lists);
   atomicStore(&completeMask[0],0u);
   atomicStore(&completeMask[1],0u);
  }
  let job=workgroupUniformLoad(&taken);
  if(job.y==0u){break;}
  let quadrant=job.x%16u;
  let binTile=unpackCoord(tiles[job.z*${T.words}u+${T.coord}u]);
  let low=vec2f((binTile*4u+vec2u(quadrant%4u,quadrant/4u))*${FORWARD_RASTER_TILE}u);
  let pixel=vec2u(low)+local.xy;
  var colour=vec3f(0.0);
  var coverage=0.0;
  var nearest=0.0;
  var complete=false;
  for(var listRank=0u;listRank<job.w;listRank++){
   let list=job.z+listRank;
   let count=tiles[list*${T.words}u+${T.count}u];
   if(lane==0u){
    atomicStore(&leastDepth,depthBits(1e8));
    atomicStore(&greatestDepth,0u);
    atomicStore(&steepMask,0u);
    decided=vec4u(select(0u,1u,allComplete()),0u,0u,0u);
   }
   for(var b=lane;b<${BUCKETS}u;b+=${FORWARD_RASTER_TILE * FORWARD_RASTER_TILE}u){
    atomicStore(&bucketCount[b],0u);
    atomicStore(&bucketFill[b],0u);
   }
   atomicStore(&pixelMask[lane],0u);
   groupSync();
   if(workgroupUniformLoad(&decided).x!=0u){break;}
   // The segments of the list: cut, and their nearest depth found.
   for(var p=lane;p<count;p+=${FORWARD_RASTER_TILE * FORWARD_RASTER_TILE}u){
    let s=shadeSegment(prims[list*${LIST}u+p],low);
    segmentDepth[p]=select(INVALID,depthBits(max(s.sp0.z,s.sp1.z)),s.ok);
    if(s.ok){
     atomicMin(&leastDepth,segmentDepth[p]);
     atomicMax(&greatestDepth,segmentDepth[p]);
    }
   }
   groupSync();
   let extent=1.0/max(0.0001,depthOf(atomicLoad(&greatestDepth))-depthOf(atomicLoad(&leastDepth)));
   for(var p=lane;p<count;p+=${FORWARD_RASTER_TILE * FORWARD_RASTER_TILE}u){
    if(segmentDepth[p]!=INVALID){atomicAdd(&bucketCount[bucketOf(depthOf(segmentDepth[p]),extent)],1u);}
   }
   groupSync();
   if(lane==0u){
    var running=0u;
    for(var b=0u;b<${BUCKETS}u;b++){
     let n=atomicLoad(&bucketCount[b]);
     atomicStore(&bucketCount[b],running);
     running+=n;
    }
    decided=vec4u(0u,running,0u,0u);
   }
   groupSync();
   for(var p=lane;p<count;p+=${FORWARD_RASTER_TILE * FORWARD_RASTER_TILE}u){
    if(segmentDepth[p]!=INVALID){
     let b=bucketOf(depthOf(segmentDepth[p]),extent);
     sorted[atomicLoad(&bucketCount[b])+atomicAdd(&bucketFill[b],1u)]=p;
    }
   }
   groupSync();
   let valid=workgroupUniformLoad(&decided).y;
   for(var batch=0u;batch<(valid+${SEGMENTS - 1}u)/${SEGMENTS}u;batch++){
    atomicStore(&pixelMask[lane],0u);
    if(lane==0u){
     atomicStore(&steepMask,0u);
     decided=vec4u(select(0u,1u,allComplete()),0u,0u,0u);
    }
    groupSync();
    if(workgroupUniformLoad(&decided).x!=0u){break;}
    let rank=batch*${SEGMENTS}u+lane;
    if(lane<${SEGMENTS}u&&rank<valid){
     let id=prims[list*${LIST}u+sorted[rank]];
     let s=shadeSegment(id,low);
     if(s.ok){
      let d=s.sp1.xy-s.sp0.xy;
      let lenSq=dot(d,d);
      let rcpLen=select(0.0,1.0/lenSq,lenSq>1e-8);
      let steep=abs(d.x)<abs(d.y);
      let begin=select(min(s.sp0.x,s.sp1.x),min(s.sp0.y,s.sp1.y),steep);
      let finish=select(max(s.sp0.x,s.sp1.x),max(s.sp0.y,s.sp1.y),steep);
      let rcpSteps=select(0.0,1.0/(finish-begin),finish-begin>1e-6);
      let steps=i32(ceil(finish)-floor(begin));
      if(steep){atomicOr(&steepMask,1u<<lane);}
      for(var j=0;j<steps;j++){
       let sp=mix(s.sp0,s.sp1,saturate(f32(j)*rcpSteps));
       let coords=vec2i(sp.xy);
       let inside=coords-vec2i(low);
       if(any(inside<vec2i(0))||any(inside>=vec2i(${FORWARD_RASTER_TILE}))||any(vec2u(max(coords,vec2i(0)))>=params.size)){continue;}
       let along=saturate(dot(vec2f(coords)+vec2f(0.5)-s.sp0.xy,d)*rcpLen);
       let depth=mix(s.sp0.z,s.sp1.z,along);
       if(depth<=textureLoad(sceneDepth,coords,0)){continue;}
       let invW=mix(s.sp0.w,s.sp1.w,along);
       let attr=mix(s.alpha0,s.alpha1,perspectiveAlpha(along,s.sp0.w,s.sp1.w));
       ${o.sample}
       let depthAhead=1.0/max(invW,1e-20);
       let least=select(view.radii.y*depthAhead,view.radii.y,view.forward.w!=0.0);
       let cover=saturate(mix(s.rad0,s.rad1,attr)/max(least,1e-20));
       atomicOr(&pixelMask[u32(inside.x+inside.y*${FORWARD_RASTER_TILE})],1u<<lane);
       let at=lane*${FORWARD_RASTER_TILE}u+select(u32(inside.x),u32(inside.y),steep);
       sampleCover[at]=cover;
       ${o.keep}
      }
     }
    }
    groupSync();
    let hit=atomicLoad(&pixelMask[lane]);
    let steeps=atomicLoad(&steepMask);
    for(var bit=0u;bit<${SEGMENTS}u;bit++){
     if(((hit>>bit)&1u)==0u){continue;}
     let at=bit*${FORWARD_RASTER_TILE}u+select(local.x,local.y,((steeps>>bit)&1u)!=0u);
     let cover=sampleCover[at];
     let through=saturate(1.0-coverage);
     coverage+=through*cover;
     ${o.gather}
    }
    if(!complete&&coverage>${FORWARD_COMPLETE_COVERAGE}){
     atomicOr(&completeMask[lane/32u],1u<<(lane%32u));
     complete=true;
    }
    groupSync();
   }
   groupSync();
  }
  if(all(pixel<params.size)){
   ${o.write}
  }
  groupSync();
 }
}`,
    [
      FORWARD_BINDINGS_WGSL,
      FORWARD_PARAMS_WGSL,
      FORWARD_CONSTANTS_WGSL,
      forwardPacking,
      groupSync,
      forwardShade,
    ],
  )
}
