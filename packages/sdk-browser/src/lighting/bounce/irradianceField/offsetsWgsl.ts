import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { ndcToPixel } from '../../../../../math/src/wgsl/projection.ts'
import { hammersley16 } from '../../../../../math/src/wgsl/sampling.ts'
import {
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { globalDistanceFieldReadWgsl } from '../../distanceField/globalReadWgsl.ts'
import { globalReadLayoutEntries } from '../../distanceField/view.ts'
import { WORLD_AT_WGSL } from '../../deferred/worldAtWgsl.ts'
import { atlasEntry } from '../atlas.ts'
import { bounceBindingsWgsl } from '../gridWgsl.ts'
import { POOL_ADAPTIVE, POOL_SLOT } from '../pool/poolLayout.ts'
import { PROBE_QUEUE_WORDS, QUEUED_PROBE_WGSL } from '../probes/probeQueueWgsl.ts'
import { BOUNCE_CM_WGSL } from '../tracedHitWgsl.ts'

/** The bindings both offset kernels start with: the levels' uniform, the cell table, the probe queue and the pool's slots (both written). */
const OFFSET_BINDINGS = { grid: 0, table: 1, queue: 2, slots: 3 } as const

/** The bindings of the kernel that moves the probes by the pixels near them (`GBUFFER_OFFSETS_PROGRAM`): the common ones, the view, the image's depth and its normals. */
export const GBUFFER_OFFSET_BINDINGS = {
  ...OFFSET_BINDINGS,
  view: 4,
  depth: 5,
  normals: 6,
} as const

/** The bindings of the kernel that moves the probes by the global distance field (`FIELD_OFFSETS_PROGRAM`): the common ones, then the field's six. */
export const FIELD_OFFSET_BINDINGS = { ...OFFSET_BINDINGS, field: 4 } as const

/** The layout of the kernel that moves the probes by the pixels near them. */
export const gbufferOffsetEntries = () => {
  const B = GBUFFER_OFFSET_BINDINGS
  return [
    computeUniformEntry(B.grid),
    atlasEntry(B.table),
    computeBufferEntry(B.queue, 'storage'),
    computeBufferEntry(B.slots, 'storage'),
    computeUniformEntry(B.view),
    computeTextureEntry(B.depth, 'depth'),
    computeTextureEntry(B.normals, 'float'),
  ]
}

/** The layout of the kernel that moves the probes by the global distance field. */
export const fieldOffsetEntries = () => {
  const B = FIELD_OFFSET_BINDINGS
  return [
    computeUniformEntry(B.grid),
    atlasEntry(B.table),
    computeBufferEntry(B.queue, 'storage'),
    computeBufferEntry(B.slots, 'storage'),
    ...globalReadLayoutEntries(B.field),
  ]
}

/** Threads a probe, a workgroup: the pixels one samples round the probe, and the places one tries off it. */
const OFFSET_THREADS = 64

/** The constants and the shared words of both kernels: the words of a queue entry and of a slot, the threads, and the precision the offsets the pixels vote are summed at. */
const offsetDeclarations = (queue: number, slots: number) => `${wgslConsts({
  OFFSET_THREADS,
  OFFSET_QUEUE_WORDS: PROBE_QUEUE_WORDS,
  OFFSET_SLOT_WORDS: POOL_SLOT.words,
  OFFSET_SLOT_OFFSET: POOL_SLOT.offset,
  OFFSET_PRECISION: POOL_ADAPTIVE.precision,
})}
/** How far (in cells) from the cell's centre a probe may be moved. */
const OFFSET_MAX_CELLS:f32=0.25;
@group(0) @binding(${queue}) var<storage,read_write> probeQueue:array<u32>;
@group(0) @binding(${slots}) var<storage,read_write> poolSlots:array<u32>;
/** The offset \`offset\` stored as the probe of queue entry \`entry\`, in slot \`slot\`, stands at, which this image's trace reads from the queue and the next ones from the slot. */
fn storeProbeOffset(entry:u32,slot:u32,offset:vec3f){
 let bits=bitcast<vec3u>(offset);
 for(var axis=0u;axis<3u;axis++){
  probeQueue[entry*OFFSET_QUEUE_WORDS+4u+axis]=bits[axis];
  poolSlots[slot*OFFSET_SLOT_WORDS+OFFSET_SLOT_OFFSET+axis]=bits[axis];
 }
}`

/**
 * THE PROBES MOVED BY THE PIXELS NEAR THEM (`gbufferOffsets`, `ComputeProbeWorldOffsetsCS`, the gbuffer permutation): for every probe the frame queued, a workgroup. Its first thread looks at the pixel the probe
 * projects to and the others at 63 pixels of a Hammersley pattern within 16 pixels of it; a pixel that shows a surface at least as near as the probe (less a twentieth of the cell) votes for the place a quarter of a cell
 * and three quarters off the surface (a fifth of the way along its normal and four fifths toward the eye) when that lies within a quarter of the cell of the cell's centre. The probe stands at the mean of the
 * places voted for, summed in whole units of a 64th of the cell's width so that integer atomics add them, and keeps the place it had when no pixel voted. The place is written to the slot (it lasts) and to the queue's entry
 * (this image's trace and filter read it).
 */
export const GBUFFER_OFFSETS_PROGRAM = wgslProgram(
  `@group(0) @binding(${GBUFFER_OFFSET_BINDINGS.view}) var<uniform> view:View;
@group(0) @binding(${GBUFFER_OFFSET_BINDINGS.depth}) var sceneDepth:texture_depth_2d;
@group(0) @binding(${GBUFFER_OFFSET_BINDINGS.normals}) var surfaceNormals:texture_2d<f32>;
${offsetDeclarations(GBUFFER_OFFSET_BINDINGS.queue, GBUFFER_OFFSET_BINDINGS.slots)}
/** The width of the window of pixels round the probe the votes come from. */
const OFFSET_KERNEL_WIDTH:f32=16.0;
/** How far off the surface the ideal place is, in cells. */
const OFFSET_PROBE_BIAS:f32=0.25;
/** Nearer than this (in cells) behind the surface a probe is still taken as in front of it. */
const OFFSET_BEHIND_CELLS:f32=0.05;
var<workgroup> idealSum:array<atomic<u32>,4>;
@compute @workgroup_size(OFFSET_THREADS)
fn gbufferOffsets(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let entry=group.x;
 let live=entry<bounce.frame.y&&bounce.counts.w!=0u;
 let queued=queuedProbe(select(0u,entry,live));
 let ready=live&&queued.valid;
 if(lane<4u){atomicStore(&idealSum[lane],0u);}
 workgroupBarrier();
 let cell=bounce.levels[select(0u,queued.level,ready)].spacing;
 let home=probePosition(queued.cell,cell);
 let whole=f32(OFFSET_PRECISION);
 let scale=whole*0.5/cell;
 let projected=view.viewProjection*vec4f(home+queued.offset,1.0);
 let size=vec2f(textureDimensions(sceneDepth));
 let sampled=ndcToPixel(projected.xy/projected.w,size)+select((hammersley16(lane,OFFSET_THREADS,vec2u(0u))-vec2f(0.5))*OFFSET_KERNEL_WIDTH,vec2f(0.0),lane==0u);
 let pixel=vec2i(floor(sampled));
 // A probe behind the eye projects to nowhere on the image.
 if(ready&&projected.w>0.0&&all(pixel>=vec2i(0))&&all(pixel<vec2i(size))){
  let z=textureLoad(sceneDepth,pixel,0);
  let normal=textureLoad(surfaceNormals,pixel,0).xyz;
  // Reverse depth: nothing drawn is at zero; a pixel without a normal shows no surface.
  if(z>0.0&&dot(normal,normal)>=0.5){
   let P=worldAt(vec2f(pixel)+vec2f(0.5),z);
   if(projected.w>(view.viewProjection*vec4f(P,1.0)).w-OFFSET_BEHIND_CELLS*cell){
    let ideal=P+(normalize(normal)*0.2+viewToEye(P)*0.8)*(0.75*cell*OFFSET_PROBE_BIAS)-home;
    if(all(abs(ideal)<vec3f(OFFSET_MAX_CELLS*cell))){
     atomicAdd(&idealSum[3],1u);
     let units=vec3u(clamp(round(ideal*scale+vec3f(whole*0.5)),vec3f(0.0),vec3f(whole)));
     atomicAdd(&idealSum[0],units.x);
     atomicAdd(&idealSum[1],units.y);
     atomicAdd(&idealSum[2],units.z);
    }
   }
  }
 }
 workgroupBarrier();
 let votes=f32(atomicLoad(&idealSum[3]));
 if(ready&&lane==0u&&votes>0.0){
  let sum=vec3f(f32(atomicLoad(&idealSum[0])),f32(atomicLoad(&idealSum[1])),f32(atomicLoad(&idealSum[2])));
  storeProbeOffset(entry,queued.slot,(sum/votes-vec3f(whole*0.5))/scale);
 }
}`,
  [
    bounceBindingsWgsl(0, GBUFFER_OFFSET_BINDINGS.grid, GBUFFER_OFFSET_BINDINGS.table),
    QUEUED_PROBE_WGSL,
    WORLD_AT_WGSL,
    ndcToPixel,
    hammersley16,
  ],
)

/**
 * THE PROBES MOVED BY THE GLOBAL DISTANCE FIELD (`fieldOffsets`, `ComputeProbeWorldOffsetsCS`, the field permutation): for every probe the frame queued that stands within a twentieth of a cell of a surface, a workgroup
 * that tries 64 places of a 4 × 4 × 4 grid spanning a quarter of the cell round it, the best of each eight and then of those eight, and moves the probe there when that place is a twentieth of a cell off the surfaces or
 * more. The place is added to the offset the probe had (the reference stores it alone, which moves a probe that had an offset to a place it did not measure: fixed), in the slot and in the queue's entry.
 */
export const FIELD_OFFSETS_PROGRAM = wgslProgram(
  `${offsetDeclarations(FIELD_OFFSET_BINDINGS.queue, FIELD_OFFSET_BINDINGS.slots)}
/** How near a surface (in cells) a probe is too near. */
const OFFSET_TOO_CLOSE_CELLS:f32=0.05;
var<workgroup> tried:array<vec4f,OFFSET_THREADS>;
var<workgroup> bestOfEight:array<vec4f,8>;
/** The distance, in metres, from the point \`p\` (metres) to the nearest surface of the global distance field. */
fn probeSurfaceDistance(p:vec3f)->f32{
 if(gdfView.clipmaps==0u){return 1e30;}
 return gdfDistanceToNearestSurface(p*f32(BOUNCE_CM))/f32(BOUNCE_CM);
}
@compute @workgroup_size(OFFSET_THREADS)
fn fieldOffsets(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let entry=group.x;
 let live=entry<bounce.frame.y&&bounce.counts.w!=0u;
 let queued=queuedProbe(select(0u,entry,live));
 let ready=live&&queued.valid;
 let cell=bounce.levels[select(0u,queued.level,ready)].spacing;
 let centre=queuedPosition(queued);
 let nearest=probeSurfaceDistance(centre);
 let tooClose=OFFSET_TOO_CLOSE_CELLS*cell;
 let close=ready&&nearest<tooClose;
 if(close){
  let at=vec3f(f32(lane%4u),f32((lane%16u)/4u),f32(lane/16u));
  let offset=(at*2.0/3.0-vec3f(1.0))*OFFSET_MAX_CELLS*cell;
  tried[lane]=vec4f(offset,probeSurfaceDistance(centre+offset));
 }
 workgroupBarrier();
 if(close&&lane<8u){
  var best=tried[lane*8u];
  for(var i=1u;i<8u;i++){
   if(tried[lane*8u+i].w>best.w){best=tried[lane*8u+i];}
  }
  bestOfEight[lane]=best;
 }
 workgroupBarrier();
 if(close&&lane==0u){
  var best=bestOfEight[0];
  for(var i=1u;i<8u;i++){
   if(bestOfEight[i].w>best.w){best=bestOfEight[i];}
  }
  if(best.w>=tooClose){storeProbeOffset(entry,queued.slot,clamp(queued.offset+best.xyz,vec3f(-OFFSET_MAX_CELLS*cell),vec3f(OFFSET_MAX_CELLS*cell)));}
 }
}`,
  [
    bounceBindingsWgsl(0, FIELD_OFFSET_BINDINGS.grid, FIELD_OFFSET_BINDINGS.table),
    QUEUED_PROBE_WGSL,
    BOUNCE_CM_WGSL,
    globalDistanceFieldReadWgsl(0, FIELD_OFFSET_BINDINGS.field),
  ],
)
