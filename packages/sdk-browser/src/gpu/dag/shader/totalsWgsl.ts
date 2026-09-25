import { CLUSTER_TRANSPARENT } from '../layout.ts';

/**
 * Triangle totals of a frame, held BY THE GPU.
 *
 * The CPU sums none: that would require it to know the cut — the whole list, reported frame after
 * frame. They are accumulated where the verdict is given, in `dagMask`, the only kernel that
 * knows what a frame draws.
 *
 * They are taken on the set the cut rule draws (`../../../page/cut/rule.ts`): `selected`, the
 * triangles it draws — no cluster the rule draws can lack its bytes, so the readout copies it as
 * the drawn total (`../uniforms.ts`) —, and `transparent`, its blended share. A surface the rule
 * leaves undrawn has no cluster to count it, so no uncovered total is kept here: holes are proven
 * on the drawn set (`../../../page/cut/cutRule.test.ts`, `held-gpu-cut.browser.ts`).
 *
 * They describe the CUT, never the list that reports it: a rank the readback cap refuses does not
 * subtract from a total. That is what lets them survive the disappearance of the lists.
 *
 * THE SUM HAPPENS IN THE WORKGROUP FIRST. Unique words added by EVERY live cluster serialize the
 * whole GPU on a few addresses: that is the classic atomic hotspot, and it grows with the scene.
 * Each group of 64 threads therefore sums in its own shared memory — a workgroup atomic, with no
 * memory traffic — then two of its threads pour the subtotal into the frame words. The GPU goes
 * from two global adds per cluster to two per group, sixty-four times fewer contests, for exactly
 * the same numbers.
 */
export const DAG_TOTALS_WGSL = `var<workgroup> totauxGroupe:array<atomic<u32>,2>;
fn ouvreTotaux(lid:u32){
 if(lid<2u){atomicStore(&totauxGroupe[lid],0u);}
 workgroupBarrier();
}
fn noteImage(r:u32,flags:u32,drawn:bool){
 if(!drawn){return;}
 let tri=trianglesOf(r);
 atomicAdd(&totauxGroupe[0],tri);
 if((flags&${CLUSTER_TRANSPARENT}u)!=0u){atomicAdd(&totauxGroupe[1],tri);}
}
/** Two threads, one counter each: the group pours nothing when it counted nothing. The barrier
 *  is crossed by EVERY thread in the group, including those that had no cluster. */
fn verseTotaux(lid:u32){
 workgroupBarrier();
 if(lid>=2u){return;}
 let v=atomicLoad(&totauxGroupe[lid]);
 if(v==0u){return;}
 if(lid==0u){atomicAdd(&out.selectedTriangles,v);}else{atomicAdd(&out.transparentTriangles,v);}
}
fn resetTotaux(){
 atomicStore(&out.selectedTriangles,0u);atomicStore(&out.transparentTriangles,0u);
}
`;
