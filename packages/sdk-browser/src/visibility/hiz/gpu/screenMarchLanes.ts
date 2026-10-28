import { wgslBlock, type WgslDecl } from '../../../../../math/src/wgsl/decl.ts'

/** How the reference walk counts the lanes of its subgroup that are still walking (`screenMarchReference`): not at all (`none`, the
 *  text the screen probes read), by the subgroup's own sum (`native`, the `subgroups` feature) or, where the device has none or no subgroup
 *  of 32 lanes, by a count the threads of the workgroup keep in its memory (`polyfill`), the same number. */
export type MarchLanes = 'none' | 'native' | 'polyfill'

/** The lanes of a subgroup the walk counts over: 32, the subgroup the reference's early exit is written for (it is only on where the device runs
 *  subgroups of 32). The polyfill's virtual subgroups are this many consecutive threads of the workgroup. */
export const MARCH_VIRTUAL_LANES = 32
/** The workgroup size the polyfill counts for unless the kernel says another: the reflections' kernels hold 8 × 8 threads. */
const WORKGROUP_THREADS = 64

/**
 * THE LANES STILL WALKING, for a walk that gives up when no more than `occupancy` lanes of its subgroup are still walking (zero: it never gives up).
 *
 * Native (`screenMarchHolds`): the number of active lanes of the subgroup, one summed over them (`subgroupAdd`), read in the loop's condition by the lanes
 * that reach it — the lanes still walking, as the reference counts them.
 *
 * Polyfill, the same number: every thread of the workgroup takes part in every round of the walk, those that walk and those that do not (finished, given
 * up, or with no ray), so that the workgroup is in uniform control flow at the round's barriers. A round (`screenMarchRound`): each thread
 * writes whether it walks, a barrier, the first thread sums the walkers of each virtual subgroup of `MARCH_VIRTUAL_LANES` consecutive threads
 * (`screenMarchLeft` reads its own subgroup's, itself included) and of the whole workgroup, and the round tells every thread, uniformly
 * (`workgroupUniformLoad`), whether nobody walks any more. The count a thread reads is the one `subgroupAdd` gives a subgroup of the same lanes.
 * The kernel that calls the walk sets `screenMarchLane` (its thread's index in the workgroup, `threads` threads of it, a multiple of `MARCH_VIRTUAL_LANES`)
 * before the first round.
 * None for `none`.
 */
export const screenMarchLanesWgsl = (
  lanes: MarchLanes,
  threads = WORKGROUP_THREADS,
): readonly WgslDecl[] => {
  if (lanes === 'none') return []
  return [
    lanes === 'native'
      ? wgslBlock(
          'SCREEN_MARCH_LANES_WGSL(native)',
          [],
          `enable subgroups;
diagnostic(off,subgroup_uniformity);
fn screenMarchHolds(occupancy:u32)->bool{
 return occupancy==0u||subgroupAdd(1u)>occupancy;
}`,
        )
      : wgslBlock(
          threads === WORKGROUP_THREADS
            ? 'SCREEN_MARCH_LANES_WGSL(polyfill)'
            : `SCREEN_MARCH_LANES_WGSL(polyfill, ${threads})`,
          [],
          `var<private> screenMarchLane:u32;
var<workgroup> screenMarchWalking:array<u32,${threads}>;
var<workgroup> screenMarchCounts:array<u32,${threads / MARCH_VIRTUAL_LANES}>;
var<workgroup> screenMarchTotal:u32;
fn screenMarchRound(walking:bool)->bool{
 screenMarchWalking[screenMarchLane]=select(0u,1u,walking);
 workgroupBarrier();
 if(screenMarchLane==0u){
  var total=0u;
  for(var w=0u;w<${threads / MARCH_VIRTUAL_LANES}u;w++){
   var n=0u;
   for(var i=0u;i<${MARCH_VIRTUAL_LANES}u;i++){n+=screenMarchWalking[w*${MARCH_VIRTUAL_LANES}u+i];}
   screenMarchCounts[w]=n;
   total+=n;
  }
  screenMarchTotal=total;
 }
 return workgroupUniformLoad(&screenMarchTotal)==0u;
}
fn screenMarchLeft()->u32{return screenMarchCounts[screenMarchLane/${MARCH_VIRTUAL_LANES}u];}`,
        ),
  ]
}
