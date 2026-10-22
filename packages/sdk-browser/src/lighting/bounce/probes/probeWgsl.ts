import { WORKGROUP_THREADS_WGSL, WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { BOUNCE_SETTINGS } from '../../../../../sdk-core/src/bounce/contracts.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { BOUNCE_GRID_WGSL, bounceBindingsWgsl } from '../gridWgsl.ts'
import { runtimeRadianceWgsl } from '../runtime/runtimeRadianceWgsl.ts'
import { hashUnit } from '../../../../../math/src/wgsl/sampling.ts'
import { TWO_PI } from '../../../../../math/src/wgsl/constants.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { ACCUMULATION_WGSL } from '../../../post/taa/accumulationWgsl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { radianceProjectionShader } from '../../../../../sdk-core/src/scene/core/irradianceBasis.ts'
import { BOUNCE_ATLAS_FORMAT, PROBE_TEXELS } from '../atlas.ts'
import { PROBE_BINDINGS, PROBE_PROXY, SNAPSHOT_BINDINGS } from './probeBindings.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { QUEUED_PROBE_WGSL } from './probeQueueWgsl.ts'
import { PROBE_GROUP_WGSL } from './probeGroupWgsl.ts'
import { censusWgsl } from './censusWgsl.ts'
import { PROBE_FILTER_WGSL } from './probeFilterWgsl.ts'

/**
 * Update of the irradiance probes.
 *
 * A probe fires a fixed budget of rays against the proxy and reads, at the hit, the radiance the
 * surface is lit to there — direct, shadows traced against the proxy, and the bounce the grid
 * already holds (`rtProbeRay`) —, and, for a ray that leaves the scene, the sky the scene's sky light
 * gives. It accumulates it all in **order-2** spherical harmonics, nine
 * coefficients: one constant term, three linear and five quadratic, which make a much
 * sharper irradiance field than an order-1 basis on the same ray spend. So the probes hold the sky
 * the scene lets through: the streets lit from above, the arcades dark.
 *
 * The surface a ray hit reads only the light the levels hold there (`surfaceLit`, nothing for what no
 * probe holds yet): the probes are the cells the image reads (`../marks.ts`), so a surface the image
 * does not show has no light of its own to give back.
 *
 * The probes updated are the queue's (`../schedule.ts`): the ones that hold nothing yet first, then
 * those the longest untouched. A probe taken for another cell, or traced for the first time, starts
 * from zero; a probe that keeps its cell keeps its work. A probe buried
 * in a surface or lost in open sky goes to sleep: later updates skip it without firing a
 * ray, until a light or the sky changes or it changes cell. That is the requested placement —
 * measured by the probe itself, never guessed by a rule on the scene.
 *
 * A fresh estimate is first averaged with the six neighbours' (`PROBE_FILTER_WGSL`): the field is not as many
 * noisy estimates as probes. Damping is the engine's one accumulation law (`ACCUMULATION_WGSL`): a probe whose estimate
 * jumps restarts and converges fast, a stable probe barely moves. Nothing allocates, nothing loops unbounded, and a scene without a declared light
 * writes exactly zero. The grid is read from a snapshot frozen before the update and
 * written elsewhere: an update never sees a neighbour half-written, and the steady-state
 * frame does not depend on the order in which the GPU scheduled its threads. The snapshot then
 * takes, by the pass's next dispatch, the texels the update wrote (`BOUNCE_SNAPSHOT_SHADER`).
 */
export const BOUNCE_PROBE_SHADER = wgslProgram(
  `
@group(0) @binding(${PROBE_BINDINGS.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${PROBE_BINDINGS.queue}) var<storage,read> probeQueue:array<u32>;
@group(0) @binding(${PROBE_BINDINGS.probes}) var probesOut:texture_storage_2d_array<${BOUNCE_ATLAS_FORMAT},write>;
@group(0) @binding(${PROBE_BINDINGS.lists}) var<storage,read> tileLights:array<u32>;
/** The updates a probe's estimate averages (\`ACCUMULATION_WGSL\`): one over the stable blend. */
const PROBE_SAMPLES:f32=${wgslF32(1 / BOUNCE_SETTINGS.blendStable)};
/** The weight a probe whose estimate jumps keeps of its history: the law then takes the moving blend
 *  of the fresh estimate, \`1/(held + 1)\`. */
const PROBE_JUMP_HELD:f32=${wgslF32(1 / BOUNCE_SETTINGS.blendMoving - 1)};
const MOVING_RESIDUAL:f32=${BOUNCE_SETTINGS.movingResidual};
const BOUNCE_BURIED:f32=${BOUNCE_SETTINGS.buriedFraction};
const BOUNCE_SKY:f32=${BOUNCE_SETTINGS.skyFraction};
/** Writes vector \`k\` of the probe whose first texel is \`probe\`, where \`probeAt\` reads it (\`atlas.ts\`). */
fn probeStore(probe:vec3u,k:u32,value:vec4f){
 textureStore(probesOut,probeTexel(probe,k),probe.z,value);
}
@compute @workgroup_size(PROBE_THREADS)
fn updateProbes(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 if(group.x>=bounce.frame.y||bounce.counts.w==0u){return;}
 // The queue says, entry by entry, which probe of the pool works, for which cell of which level.
 let queued=queuedProbe(group.x);
 if(!queued.valid){return;}
 let level=queued.level;let slot=queued.slot;let cell=queued.cell;let probe=queued.probe;
 let held=!queued.fresh&&all(probeCell(probe)==cell)&&probeLevel(probe)==level;
 // A sleeping probe — buried in a surface or lost in open sky — fires no ray
 // as long as its cell does not change and no light has moved.
 if(held&&probeAt(probe,PROBE_IDLE).w==f32(bounce.frame.x)){return;}
 let spacing=bounce.levels[level].spacing;
 let origin=probeCentre(cell,spacing);
 let reach=bounce.reach.x;
 let rotation=hashUnit(slot*9781u+bounce.frame.z)*TWO_PI;
 let jitter=hashUnit(slot*6151u+bounce.frame.z*131u);
 // The neighbours the estimate is averaged with, a lane each, read before the rays: nothing waits for them.
 if(PROBE_FILTER){
  if(lane<FILTER_NEIGHBOURS){filterRead(lane,cell,level,spacing);}
  workgroupBarrier();
 }
 var sums:array<vec3f,PROBE_SUMS>;
 // One thread per ray, the group as wide as the probe's rays (\`PROBE_THREADS\`): a probe at
 // sixty-four rays occupies a whole group, where a single thread chained them and left the GPU idle.
 let d=rayDirection(lane,jitter,rotation);
 let sample=rtProbeRay(origin,d,reach);
 // The ray counted in the group's tally (\`censusAdd\`), flushed once: the work it and its shadow rays spent, by
 // bucket and in all, the part the tree's groups took (this image's rays only), what its shadow rays found.
 let spent=rtWork+rtExtra;
 censusAdd(CENSUS_WORK+min(CENSUS_BUCKETS-1u,firstLeadingBit(max(spent>>5u,1u))),1u);
 censusAdd(CENSUS_WALK_WORK,spent);
 censusAdd(CENSUS_WALK_MEMBERS,rtMembers);
 censusAdd(CENSUS_SHADOW_FREE,rtShadowFree);
 censusAdd(CENSUS_SHADOW_BLOCKED,rtShadowHit);
 // What spent a ray's walk and its shadow ray is counted: the ray answers all the same (\`rtProbeRay\`), an
 // exhausted walk as a hit where it stopped and an exhausted shadow ray as a blocker, none left out.
 if(rtCause!=0u){censusAdd(CENSUS_EXHAUSTED_BY+rtCause-1u,1u);}
 if(rtShadowCause!=0u){censusAdd(CENSUS_EXHAUSTED_BY+3u+rtShadowCause,1u);}
 let span=sample.w;
 if(any(sample.rgb>vec3f(0.0))){censusAdd(CENSUS_LIT,1u);}
 // A ray that met no surface answers with its whole reach: the sky is all it brings.
 if(span>=reach){censusAdd(CENSUS_ESCAPED,1u);}
 ${radianceProjectionShader((k) => `sums[${k}]`, 'sample.rgb', 'd')}
 let weight=abs(d);
 let positive=select(vec3f(0.0),weight,d>vec3f(0.0));
 sums[9]+=positive*span;
 sums[10]+=positive;
 sums[11]+=(weight-positive)*span;
 sums[12]+=weight-positive;
 if(PROBE_FILTER){
  let shares=filterShares(d,span,spacing);
  sums[13]+=shares.low;
  sums[14]+=shares.high;
 }
 // The group's thread sums gather by successive halves: one barrier per
 // round, and thread zero writes the probe.
 for(var k=0u;k<PROBE_SUMS;k++){partial[k][lane]=sums[k];}
 partialTravelled[lane]=span;
 for(var stride=PROBE_THREADS/2u;stride>0u;stride>>=1u){
  workgroupBarrier();
  if(lane<stride){
   for(var k=0u;k<PROBE_SUMS;k++){partial[k][lane]+=partial[k][lane+stride];}
   partialTravelled[lane]+=partialTravelled[lane+stride];
  }
 }
 workgroupBarrier();
 censusFlush(lane);
 if(lane!=0u){return;}
 for(var k=0u;k<PROBE_SUMS;k++){sums[k]=partial[k][0];}
 // Every ray answered (\`rtProbeRay\`): the mean is over the group's rays.
 let rays=f32(PROBE_THREADS);
 atomicAdd(&census[CENSUS_UPDATED],1u);
 atomicAdd(&census[CENSUS_FIRED],PROBE_THREADS);
 let travelled=partialTravelled[0]/rays;
 // A probe locked in a surface hits something in every direction, at point-blank
 // range; a probe in open sky hits nothing. The criterion is a distance, never a winding
 // order: that is reliable on no imported scene, and the proxy is two-sided.
 let buried=travelled<spacing*BOUNCE_BURIED;
 let asleep=buried||travelled>reach*BOUNCE_SKY;
 let usable=select(1.0,0.0,buried);
 atomicAdd(&census[select(CENSUS_WRITTEN,CENSUS_BURIED,buried)],1u);
 // Monte-Carlo estimator over the whole sphere: 4π divided by the count of the rays.
 let scale=2.0*TWO_PI/rays;
 let meanPositive=sums[9]/max(sums[10],vec3f(1e-6));
 let meanNegative=sums[11]/max(sums[12],vec3f(1e-6));
 // The estimate: the basis the rays gave, averaged with the neighbours' that filter, each by its weight
 // (\`filterWeight\`), the probe's own one. A buried probe holds none.
 var estimate=array<vec3f,9>();
 for(var k=0u;k<9u;k++){estimate[k]=sums[k]*scale;}
 if(PROBE_FILTER&&!buried){
  var total=1.0;
  for(var n=0u;n<FILTER_NEIGHBOURS;n++){
   let pair=select(sums[13],sums[14],n>=3u);
   let weight=filterWeight(n,pair[n%3u]/rays,meanPositive,meanNegative,spacing);
   if(weight<=0.0){continue;}
   let neighbour=poolProbe(filterSlot[n]-1u);
   for(var k=0u;k<9u;k++){estimate[k]+=weight*probeAt(neighbour,k).xyz;}
   total+=weight;
  }
  for(var k=0u;k<9u;k++){estimate[k]/=total;}
 }
 let updates=select(0.0,probeAt(probe,0u).w,held);
 let previous=select(vec3f(0.0),probeAt(probe,0u).xyz,held);
 let fresh=estimate[0];
 let change=length(fresh-previous)/(length(fresh)+length(previous)+1e-4);
 // The engine's one accumulation law (\`ACCUMULATION_WGSL\`): a stable probe follows a running
 // average of \`PROBE_SAMPLES\` updates, which smooths Monte-Carlo noise without freezing the frame;
 // a new probe or one that just changed cell (nothing held) takes the fresh estimate whole; one whose
 // estimate jumps keeps less of its history the more it jumps — a continuous weight, from all of it
 // at the residual to the little a jump keeps (\`PROBE_JUMP_HELD\`, the moving blend) at twice it.
 let jump=saturate(change/MOVING_RESIDUAL-1.0);
 let restart=mix(updates,min(updates,PROBE_JUMP_HELD),jump);
 let blend=accumulationShare(restart,1.0,PROBE_SAMPLES);
 let count=accumulationCount(restart,1.0,PROBE_SAMPLES);
 // A texel is stored whole: each coefficient with the state its w lane carries, zero elsewhere.
 var state=array<f32,9>();
 state[0]=count;state[PROBE_VALID]=select(PROBE_USABLE,PROBE_BURIED,buried);
 state[PROBE_CELL]=f32(cell.x);state[PROBE_CELL+1u]=f32(cell.y);state[PROBE_CELL+2u]=f32(cell.z);
 state[PROBE_IDLE]=select(0.0,f32(bounce.frame.x),asleep);
 state[PROBE_LEVEL]=f32(level);
 for(var k=0u;k<9u;k++){
  let kept=select(vec3f(0.0),probeAt(probe,k).xyz,held);
  probeStore(probe,k,vec4f(mix(kept,estimate[k]*usable,blend),state[k]));
 }
 let keptPositive=select(vec3f(0.0),probeAt(probe,PROBE_DISTANCE_POSITIVE).xyz,held);
 let keptNegative=select(vec3f(0.0),probeAt(probe,PROBE_DISTANCE_NEGATIVE).xyz,held);
 probeStore(probe,PROBE_DISTANCE_POSITIVE,vec4f(mix(keptPositive,meanPositive,blend),0.0));
 probeStore(probe,PROBE_DISTANCE_NEGATIVE,vec4f(mix(keptNegative,meanNegative,blend),0.0));
}`,
  [
    runtimeRadianceWgsl(PROBE_PROXY),
    DIRECT_LIGHT_WGSL,
    bounceBindingsWgsl(0, PROBE_BINDINGS.grid, PROBE_BINDINGS.snapshot),
    BOUNCE_GRID_WGSL,
    QUEUED_PROBE_WGSL,
    PROBE_GROUP_WGSL,
    PROBE_FILTER_WGSL,
    censusWgsl(PROBE_BINDINGS.census),
    TWO_PI,
    hashUnit,
    ACCUMULATION_WGSL,
  ],
)

/**
 * The snapshot's follow-up, in the bounce pass after the update: every texel the update may have
 * written — the `PROBE_TEXELS` texels of each probe its queue names — copied from the probes'
 * atlas to the snapshot, one thread per texel. The two atlases were equal before the update
 * (zeroed together, cleared together), so they are equal after it, and the next update reads its
 * frozen grid without the copy of the whole atlas each image paid. A probe the update
 * skipped — asleep — copies the texels it holds already.
 */
export const BOUNCE_SNAPSHOT_SHADER = wgslProgram(
  `
@group(0) @binding(${SNAPSHOT_BINDINGS.queue}) var<storage,read> probeQueue:array<u32>;
@group(0) @binding(${SNAPSHOT_BINDINGS.snapshot}) var snapshotOut:texture_storage_2d_array<${BOUNCE_ATLAS_FORMAT},write>;
@compute @workgroup_size(WORKGROUP_THREADS)
fn followSnapshot(@builtin(global_invocation_id) id:vec3u){
 let entry=id.x/PROBE_TEXELS;
 if(entry>=bounce.frame.y||bounce.counts.w==0u){return;}
 let queued=queuedProbe(entry);
 if(!queued.valid){return;}
 let at=probeTexel(queued.probe,id.x%PROBE_TEXELS);
 textureStore(snapshotOut,at,queued.probe.z,textureLoad(probes,at,queued.probe.z,0));
}`,
  [
    bounceBindingsWgsl(0, SNAPSHOT_BINDINGS.grid, SNAPSHOT_BINDINGS.probes),
    QUEUED_PROBE_WGSL,
    WORKGROUP_THREADS_WGSL,
  ],
)

/** Workgroups of the snapshot's follow-up for a queue of `entries` probes: a thread a texel. */
export const snapshotGroups = (entries: number) =>
  ceilDiv(entries * PROBE_TEXELS, WORKGROUP_THREADS)
