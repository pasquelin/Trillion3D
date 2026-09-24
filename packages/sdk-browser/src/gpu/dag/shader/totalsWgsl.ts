import { CLUSTER_TRANSPARENT } from '../layout.ts';

/**
 * Triangle totals of a frame, held BY THE GPU.
 *
 * The CPU sums none: that would require it to know the cut — the whole list, reported frame after
 * frame. They are accumulated where the verdict is given, in `dagMask`, the only kernel that
 * knows what a frame draws.
 *
 * ALL THREE ARE TAKEN ON THE SAME SET, and that is what holds the invariant the CPU documented —
 * `selected − drawn − uncovered = 0`:
 *
 * - `voulu`: the FULL DRAWABLE CUT, i.e. what `dagMask` would draw if residency did not oppose it.
 *   This is not what `dagWanted` keeps: between the two, residency escalation has raised the
 *   primitive's threshold, and a cluster kept at the frame threshold may no longer be at the
 *   escalated one.
 * - `dessinee`: what actually goes to the raster, hence what the mask carries.
 * - `trou`: what the cut wanted to draw and residency refuses it. Exactly the difference of the
 *   two, never anything else.
 *
 * They describe the CUT, never the list that reports it: a rank the readback cap refuses does not
 * subtract from a total. That is what lets them survive the disappearance of the lists.
 *
 * THE SUM HAPPENS IN THE WORKGROUP FIRST. Four unique words added by EVERY live cluster serialize
 * the whole GPU on four addresses: that is the classic atomic hotspot, and it grows with the scene.
 * Each group of 64 threads therefore sums in its own shared memory — a workgroup atomic, with no
 * memory traffic — then four of its threads pour the subtotal into the frame words. The GPU goes
 * from four global adds per cluster to four per group, sixty-four times fewer contests, for exactly
 * the same numbers.
 */
export const DAG_TOTALS_WGSL = `var<workgroup> totauxGroupe:array<atomic<u32>,4>;
fn ouvreTotaux(lid:u32){
 if(lid<4u){atomicStore(&totauxGroupe[lid],0u);}
 workgroupBarrier();
}
fn noteImage(i:u32,flags:u32,voulu:bool,dessinee:bool,trou:bool){
 if(!voulu){return;}
 let tri=trianglesOf(i);
 atomicAdd(&totauxGroupe[0],tri);
 if((flags&${CLUSTER_TRANSPARENT}u)!=0u){atomicAdd(&totauxGroupe[1],tri);}
 if(dessinee){atomicAdd(&totauxGroupe[2],tri);}
 if(trou){atomicAdd(&totauxGroupe[3],tri);}
}
/** Four threads, one counter each: the group pours nothing when it counted nothing. The barrier
 *  is crossed by EVERY thread in the group, including those that had no cluster. */
fn verseTotaux(lid:u32){
 workgroupBarrier();
 if(lid>=4u){return;}
 let v=atomicLoad(&totauxGroupe[lid]);
 if(v==0u){return;}
 switch lid{
  case 0u:{atomicAdd(&out.selectedTriangles,v);}
  case 1u:{atomicAdd(&out.transparentTriangles,v);}
  case 2u:{atomicAdd(&out.drawnTriangles,v);}
  default:{atomicAdd(&out.uncoveredTriangles,v);}
 }
}
fn resetTotaux(){
 atomicStore(&out.selectedTriangles,0u);atomicStore(&out.transparentTriangles,0u);
 atomicStore(&out.drawnTriangles,0u);atomicStore(&out.uncoveredTriangles,0u);
}
`;
