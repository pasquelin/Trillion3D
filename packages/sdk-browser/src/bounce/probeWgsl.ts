import { BOUNCE_SETTINGS } from '../../../sdk-core/src/index.ts'
import { DIRECT_LIGHT_WGSL } from '../lighting/direct/lightWgsl.ts'
import { BOUNCE_GRID_HEAD_WGSL, BOUNCE_GRID_WGSL, INVERSE_PI_WGSL } from './gridWgsl.ts'
import { residentProxyWgsl } from './nodeWgsl.ts'
import { BOUNCE_TRACE_WGSL } from './traceWgsl.ts'
import { SURFACE_RAY_WGSL } from './reflectWgsl.ts'
import { HASH_UNIT_WGSL } from '../gpu/shader/hashUnitWgsl.ts'
import { radianceProjectionShader } from '../../../sdk-core/src/scene/core/irradianceBasis.ts'
import { PROBE_TEXELS } from './atlas.ts'

/** Threads of a probe-pass workgroup: one group per probe, one thread per ray. */
const BOUNCE_WORKGROUP = 64

/**
 * Queue entry `entry`, as both the update and the snapshot's follow-up read it: its level, its
 * rank in the level, the cell that rank carries — the inverse of toroidal storage, in
 * `[base, base + side)` —, the probe's first texel, and whether the level exists. One text, so the
 * texels the snapshot copies are the ones the update wrote.
 */
const QUEUED_PROBE_WGSL = `struct QueuedProbe{level:u32,rank:u32,cell:vec3i,probe:vec3u,valid:bool,}
fn queuedProbe(entry:u32)->QueuedProbe{
 let packed=probeQueue[entry];
 let perLevel=max(bounce.counts.z,1u);
 let level=packed/perLevel;
 if(level>=bounce.counts.y){return QueuedProbe(level,0u,vec3i(0),vec3u(0u),false);}
 let rank=packed%perLevel;
 let side=i32(bounce.counts.x);
 let base=vec3i(bounce.levels[level].base.xyz);
 let ranked=vec3i(vec3u(rank%bounce.counts.x,(rank/bounce.counts.x)%bounce.counts.x,rank/(bounce.counts.x*bounce.counts.x)));
 let cell=base+(((ranked-base)%side)+side)%side;
 return QueuedProbe(level,rank,cell,probeOf(level,cell),true);
}`

/**
 * Update of the cascade irradiance probes.
 *
 * A probe fires a fixed budget of rays against the resident proxy and reads, at the hit
 * texel, the radiance the surface cache already holds there — direct, shadows and bounce
 * of the previous round. It accumulates it all in **order-2** spherical harmonics, nine
 * coefficients: one constant term, three linear and five quadratic, which make a much
 * sharper irradiance field than an order-1 basis on the same ray spend.
 *
 * The probes updated are those of a batch split among the levels: the finest surrounds
 * the camera and receives the largest share. A probe whose cell has changed — the cascade
 * has slid — starts from zero; a probe that keeps its cell keeps its work. A probe buried
 * in a surface or lost in open sky goes to sleep: later updates skip it without firing a
 * ray, until a light changes or it changes cell. That is the requested placement —
 * measured by the probe itself, never guessed by a rule on the scene.
 *
 * Damping is adaptive: a probe whose estimate jumps converges fast, a stable probe barely
 * moves. Nothing allocates, nothing loops unbounded, and a scene without a declared light
 * writes exactly zero. The grid is read from a snapshot frozen before the update and
 * written elsewhere: an update never sees a neighbour half-written, and the steady-state
 * frame does not depend on the order in which the GPU scheduled its threads. The snapshot then
 * takes, by the pass's next dispatch, the texels the update wrote (`BOUNCE_SNAPSHOT_SHADER`).
 */
export const BOUNCE_PROBE_SHADER = `
@group(0) @binding(0) var<uniform> bounce:BounceGrid;
${residentProxyWgsl(1)}
@group(0) @binding(2) var<storage,read> directLights:DirectLights;
@group(0) @binding(3) var<storage,read> probeQueue:array<u32>;
@group(0) @binding(4) var probes:texture_2d_array<f32>;
@group(0) @binding(5) var probesOut:texture_storage_2d_array<rgba32float,write>;
@group(0) @binding(6) var surface:texture_2d<f32>;
${DIRECT_LIGHT_WGSL}
${INVERSE_PI_WGSL}
${BOUNCE_GRID_WGSL}
${QUEUED_PROBE_WGSL}
${BOUNCE_TRACE_WGSL}
const RAYS_PER_PROBE:u32=${BOUNCE_SETTINGS.raysPerProbe}u;
const WORKGROUP:u32=${BOUNCE_WORKGROUP}u;
const BLEND_STABLE:f32=${BOUNCE_SETTINGS.blendStable};
const BLEND_MOVING:f32=${BOUNCE_SETTINGS.blendMoving};
const MOVING_RESIDUAL:f32=${BOUNCE_SETTINGS.movingResidual};
const BOUNCE_BURIED:f32=${BOUNCE_SETTINGS.buriedFraction};
const BOUNCE_SKY:f32=${BOUNCE_SETTINGS.skyFraction};
const GOLDEN_ANGLE:f32=2.39996323;
/** Writes vector \`k\` of the probe whose first texel is \`probe\`, where \`probeAt\` reads it (\`atlas.ts\`). */
fn probeStore(probe:vec3u,k:u32,value:vec4f){
 textureStore(probesOut,vec2u(probe.x+k,probe.y),probe.z,value);
}
${HASH_UNIT_WGSL}
/** A direction of a Fibonacci spiral, offset on every update to cover the sphere. */
fn rayDirection(slot:u32,jitter:f32,rotation:f32)->vec3f{
 let index=f32(slot)+jitter;
 let z=1.0-2.0*index/f32(RAYS_PER_PROBE);
 let radius=sqrt(max(0.0,1.0-z*z));
 let angle=index*GOLDEN_ANGLE+rotation;
 return vec3f(radius*cos(angle),radius*sin(angle),z);
}
${SURFACE_RAY_WGSL}
/** Partial sums of a group: nine basis accumulators, four of distance, one of travel. */
var<workgroup> partial:array<array<vec3f,${BOUNCE_WORKGROUP}>,13>;
var<workgroup> partialTravelled:array<f32,${BOUNCE_WORKGROUP}>;
@compute @workgroup_size(${BOUNCE_WORKGROUP})
fn updateProbes(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 if(group.x>=bounce.frame.y||bounce.counts.w==0u){return;}
 // The queue says, rank by rank, which probe of which level works: the scheduler filled
 // it by skipping the cells the occupancy map declares of no interest.
 let queued=queuedProbe(group.x);
 if(!queued.valid){return;}
 let level=queued.level;let rank=queued.rank;let cell=queued.cell;let probe=queued.probe;
 let held=all(probeCell(probe)==cell);
 // A sleeping probe — buried in a surface or lost in open sky — fires no ray
 // as long as its cell does not change and no light has moved.
 if(held&&probeAt(probe,PROBE_IDLE).w==f32(bounce.frame.x)){return;}
 let spacing=bounce.levels[level].originSpacing.w;
 let origin=probeCentre(cell,spacing);
 let reach=bounce.reach.x;
 let rotation=hashUnit(rank*9781u+bounce.frame.z)*6.2831853;
 let jitter=hashUnit(rank*6151u+bounce.frame.z*131u);
 var sums:array<vec3f,13>;
 var travelled=0.0;
 // One thread per ray: a probe at sixty-four rays occupies a whole group, where a single
 // thread chained them one after another and left the GPU idle.
 for(var ray=lane;ray<RAYS_PER_PROBE;ray+=WORKGROUP){
  let d=rayDirection(ray,jitter,rotation);
  let sample=rayRadiance(origin,d,reach);
  let span=sample.w;
  travelled+=span;
  ${radianceProjectionShader((k) => `sums[${k}]`, 'sample.rgb', 'd')}
  let weight=abs(d);
  let positive=select(vec3f(0.0),weight,d>vec3f(0.0));
  sums[9]+=positive*span;
  sums[10]+=positive;
  sums[11]+=(weight-positive)*span;
  sums[12]+=weight-positive;
 }
 // The group's thread sums gather by successive halves: one barrier per
 // round, and thread zero writes the probe.
 for(var k=0u;k<13u;k++){partial[k][lane]=sums[k];}
 partialTravelled[lane]=travelled;
 for(var stride=WORKGROUP/2u;stride>0u;stride>>=1u){
  workgroupBarrier();
  if(lane<stride){
   for(var k=0u;k<13u;k++){partial[k][lane]+=partial[k][lane+stride];}
   partialTravelled[lane]+=partialTravelled[lane+stride];
  }
 }
 workgroupBarrier();
 if(lane!=0u){return;}
 for(var k=0u;k<13u;k++){sums[k]=partial[k][0];}
 travelled=partialTravelled[0]/f32(RAYS_PER_PROBE);
 // A probe locked in a surface hits something in every direction, at point-blank
 // range; a probe in open sky hits nothing. The criterion is a distance, never a winding
 // order: that is reliable on no imported scene, and the proxy is two-sided.
 let buried=travelled<spacing*BOUNCE_BURIED;
 let asleep=buried||travelled>reach*BOUNCE_SKY;
 let usable=select(1.0,0.0,buried);
 // Monte-Carlo estimator over the whole sphere: 4π divided by the ray count.
 let scale=12.5663706/f32(RAYS_PER_PROBE);
 let updates=select(0.0,probeAt(probe,0u).w,held);
 let previous=select(vec3f(0.0),probeAt(probe,0u).xyz,held);
 let fresh=sums[0]*scale;
 let change=length(fresh-previous)/(length(fresh)+length(previous)+1e-4);
 // Adaptive hysteresis. A new probe, or one that just changed cell, takes everything; a
 // stable probe follows a running average, which smooths Monte-Carlo noise without freezing the frame;
 // a probe whose estimate jumps takes almost everything and restarts from a low count.
 var blend=max(1.0/(updates+1.0),BLEND_STABLE);
 var count=updates+1.0;
 if(change>MOVING_RESIDUAL){blend=BLEND_MOVING;count=1.0;}
 if(updates<0.5){blend=1.0;count=1.0;}
 // A texel is stored whole: each coefficient with the state its w lane carries, zero elsewhere.
 var state=array<f32,9>();
 state[0]=count;state[PROBE_CHANGE]=change;state[PROBE_VALID]=usable;
 state[PROBE_CELL]=f32(cell.x);state[PROBE_CELL+1u]=f32(cell.y);state[PROBE_CELL+2u]=f32(cell.z);
 state[PROBE_IDLE]=select(0.0,f32(bounce.frame.x),asleep);
 for(var k=0u;k<9u;k++){
  let kept=select(vec3f(0.0),probeAt(probe,k).xyz,held);
  probeStore(probe,k,vec4f(mix(kept,sums[k]*scale*usable,blend),state[k]));
 }
 let meanPositive=sums[9]/max(sums[10],vec3f(1e-6));
 let meanNegative=sums[11]/max(sums[12],vec3f(1e-6));
 let keptPositive=select(vec3f(0.0),probeAt(probe,PROBE_DISTANCE_POSITIVE).xyz,held);
 let keptNegative=select(vec3f(0.0),probeAt(probe,PROBE_DISTANCE_NEGATIVE).xyz,held);
 probeStore(probe,PROBE_DISTANCE_POSITIVE,vec4f(mix(keptPositive,meanPositive,blend),0.0));
 probeStore(probe,PROBE_DISTANCE_NEGATIVE,vec4f(mix(keptNegative,meanNegative,blend),0.0));
}`

/**
 * The snapshot's follow-up, in the bounce pass after the update: every texel the update may have
 * written — the `PROBE_VECTORS` texels of each probe its queue names — copied from the probes'
 * atlas to the snapshot, one thread per texel. The two atlases were equal before the update
 * (zeroed together, cleared together), so they are equal after it, and the next update reads its
 * frozen grid without the copy of the whole atlas each image paid. A probe the update
 * skipped — asleep — copies the texels it holds already.
 */
export const BOUNCE_SNAPSHOT_SHADER = `
@group(0) @binding(0) var<uniform> bounce:BounceGrid;
@group(0) @binding(1) var<storage,read> probeQueue:array<u32>;
@group(0) @binding(2) var probes:texture_2d_array<f32>;
@group(0) @binding(3) var snapshotOut:texture_storage_2d_array<rgba32float,write>;
${BOUNCE_GRID_HEAD_WGSL}
${QUEUED_PROBE_WGSL}
@compute @workgroup_size(${BOUNCE_WORKGROUP})
fn followSnapshot(@builtin(global_invocation_id) id:vec3u){
 let entry=id.x/PROBE_VECTORS;
 if(entry>=bounce.frame.y||bounce.counts.w==0u){return;}
 let queued=queuedProbe(entry);
 if(!queued.valid){return;}
 let at=vec2u(queued.probe.x+id.x%PROBE_VECTORS,queued.probe.y);
 textureStore(snapshotOut,at,queued.probe.z,textureLoad(probes,at,queued.probe.z,0));
}`

/** Workgroups of the snapshot's follow-up for a queue of `entries` probes: a thread a texel. */
export const snapshotGroups = (entries: number) =>
  Math.ceil((entries * PROBE_TEXELS) / BOUNCE_WORKGROUP)
