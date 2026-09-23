import {
  CNT_COARSE,
  CNT_FINE,
  CNT_HUGE,
  CNT_LARGE,
  DISPATCH_BASE,
  DISPATCH_SPAN,
  FINE_PER_GROUP,
  FINE_SIDE,
  LIST_HEADER,
  MODE_DEPTH_OCCLUDER,
  MODE_DEPTH_REST,
  RASTER_CLASSES,
  TILE,
  TILE_ROWS,
  rasterEntry,
} from './contract.ts';
import { DEPTH_CLEAR } from '../../camera/depthConvention.ts';
import { VERDICT_KEPT, VERDICT_OCCLUDER, VERDICT_REJECTED } from '../partition/contract.ts';
import { wgslFloat } from '../partition/margins.ts';

/** The twelve entry points: four size classes, each in the frame's three modes. */
const entryPoints = () =>
  RASTER_CLASSES.flatMap((klass, index) =>
    [0, 1, 2].map(
      (mode) =>
        `@compute @workgroup_size(${TILE},${TILE}) fn ${rasterEntry(klass, mode)}(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_id) l:vec3u){${['fineGroup', 'coarseGroup', 'largeGroup', 'hugeGroup'][index]}(g,l,${mode}u);}`,
    ),
  ).join('\n');

/**
 * Compute-raster kernels: clearing the frame, binning triangles by class, turning counts into
 * dispatches, and the four classes themselves.
 *
 * **The three modes and the occlusion test.** The occluder/tested split the partition decides
 * does not travel through an extra buffer — the GPU has none left at the compute stage. It
 * travels through the verdict word each row already owns: the partition writes `0` there for
 * the occluder half and `2` for the tested half, and the Hi-Z test brings that `2` to `1` on
 * rows it rejects. Mode `0` therefore writes occluder depth — that is what the pyramid reduces
 * —, mode `1` adds the surviving tested half, and mode `2` resolves identifiers over everything
 * that was drawn. Without partition or pyramid, every word is zero: mode `0` draws the whole
 * cut and the other two add nothing, which is exactly a single-pass frame.
 *
 * Binning itself does not know the verdicts: it runs before the pyramid, hence before THIS
 * frame's test has decided anything. It bins everything the cut carries, and it is the raster
 * passes that drop rejected rows. A rejected row costs its binning, not its pixels.
 */
export const rasterKernels = (capacity: number) => `
const LIST_S:u32=LIST+${LIST_HEADER}u;
const LIST_L:u32=LIST+${LIST_HEADER + capacity}u;
@compute @workgroup_size(64) fn clear(@builtin(global_invocation_id) gid:vec3u){
 let offset=gid.x;let pixels=pixelCount();if(offset>=pixels){return;}
 // Reverse-Z: the buffer starts at FAR, and the GREATEST wins afterwards.
 atomicStore(&work[offset],bitcast<u32>(${wgslFloat(DEPTH_CLEAR)}));atomicStore(&work[pixels+offset],0xffffffffu);
}
/** Verdict of a row, the contract's VERDICT_*; a row without a Hi-Z slot is an occluder. */
fn rowVerdict(page:PageInfo)->u32{
 if(page.hizSlot==0xffffffffu){return ${VERDICT_OCCLUDER}u;}
 return hizFlags[page.hizSlot];
}
fn modeKeeps(mode:u32,verdict:u32)->bool{
 if(mode==${MODE_DEPTH_OCCLUDER}u){return verdict==${VERDICT_OCCLUDER}u;}
 if(mode==${MODE_DEPTH_REST}u){return verdict==${VERDICT_KEPT}u;}
 return verdict!=${VERDICT_REJECTED}u;
}
/** A list entry becomes the triangle it names again, if the current mode draws it. */
fn triOf(entry:u32,mode:u32)->Tri{
 var t:Tri;t.ok=0u;
 let row=entry>>8u;let page=pages[row];
 if(!modeKeeps(mode,rowVerdict(page))){return t;}
 return setupTriangle(row,entry&0xffu,pageTransform(page),pageWinding(page));
}
// One dispatch dimension caps at 65 535 groups, well below the page count a replicated scene
// reaches: the page row spreads over y and z, bounded by the live-row count.
fn pageRow(group:vec3u)->u32{return group.y+group.z*${DISPATCH_SPAN}u;}
// The 64 threads of a binning group share the same page: thread zero computes for them the two
// quantities that belong only to the page, and the other 63 reread them instead of remaking them.
var<workgroup> rowVp:mat4x4f;
var<workgroup> rowDet:f32;
// One thread per triangle of the drawable rows. Survivors are binned in their class list, whose
// order the frame cannot see: the passes resolve their pixels by a minimum.
@compute @workgroup_size(64) fn bin(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) lane:vec3u){
 let row=pageRow(group);
 let live=row<uni.pageCount;
 if(live&&lane.x==0u){let page=pages[row];rowVp=pageTransform(page);rowDet=pageWinding(page);}
 workgroupBarrier();
 if(!live){return;}
 let triangle=group.x*64u+lane.x;
 let t=setupTriangle(row,triangle,rowVp,rowDet);
 if(t.ok==0u){return;}
 let entry=(row<<8u)|(triangle&0xffu);
 let klass=triClass(t);
 // Two classes per list, filled from both ends: neither overflows while the other has room, and
 // the bound held is the sum — every triangle of every row.
 if(klass==0u){atomicStore(&work[LIST_S+atomicAdd(&work[LIST+${CNT_FINE}u],1u)],entry);}
 else if(klass==1u){atomicStore(&work[LIST_S+${capacity}u-1u-atomicAdd(&work[LIST+${CNT_COARSE}u],1u)],entry);}
 else if(klass==2u){atomicStore(&work[LIST_L+atomicAdd(&work[LIST+${CNT_LARGE}u],1u)],entry);}
 else{
  atomicStore(&work[LIST_L+${capacity}u-1u-atomicAdd(&work[LIST+${CNT_HUGE}u],1u)],entry);
  // The frame's tallest box gives the y dimension of the huge-class dispatch: one group per
  // eight-row tile, and those that overshoot their triangle's box leave at once.
  atomicMax(&work[LIST+${TILE_ROWS}u],tileRows(t));
 }
}
/** The two dimensions of a list dispatch: x caps, y takes the overflow. */
fn spread(slot:u32,groups:u32){
 let base=LIST+${DISPATCH_BASE}u+slot*3u;
 atomicStore(&work[base],min(groups,${DISPATCH_SPAN}u));
 atomicStore(&work[base+1u],(groups+${DISPATCH_SPAN}u-1u)/${DISPATCH_SPAN}u);
 atomicStore(&work[base+2u],1u);
}
/** Each count becomes its dispatch, without any going through the CPU. */
@compute @workgroup_size(1) fn plan(){
 let fine=(atomicLoad(&work[LIST+${CNT_FINE}u])+${FINE_PER_GROUP}u-1u)/${FINE_PER_GROUP}u;
 spread(0u,fine);
 spread(1u,atomicLoad(&work[LIST+${CNT_COARSE}u]));
 spread(2u,atomicLoad(&work[LIST+${CNT_LARGE}u]));
 let huge=atomicLoad(&work[LIST+${CNT_HUGE}u]);
 atomicStore(&work[LIST+${DISPATCH_BASE + 9}u],min(huge,${DISPATCH_SPAN}u));
 atomicStore(&work[LIST+${DISPATCH_BASE + 10}u],max(1u,atomicLoad(&work[LIST+${TILE_ROWS}u])));
 atomicStore(&work[LIST+${DISPATCH_BASE + 11}u],(huge+${DISPATCH_SPAN}u-1u)/${DISPATCH_SPAN}u);
}
fn listAt(group:vec3u)->u32{return group.x+group.y*${DISPATCH_SPAN}u;}
// A group past its class count reads nothing useful, but it does read: its rank is clamped on
// the list so that read stays in the buffer. Its triangle is dropped just after.
fn held(i:u32)->u32{return min(i,${capacity - 1}u);}
// A group is always sixty-four threads, whatever the class: coarse spends them on the eight-by-
// eight tile of a single triangle, fine on ${FINE_PER_GROUP} triangles of ${FINE_SIDE}×${FINE_SIDE}
// pixels each. A triangle is prepared once for the threads that share it, which then reread what
// a per-thread prepare would have produced.
var<workgroup> shared_tri:array<Tri,${FINE_PER_GROUP}u>;
fn fineGroup(group:vec3u,lane:vec3u,mode:u32){
 let index=lane.y*${TILE}u+lane.x;
 let slot=index/${FINE_SIDE * FINE_SIDE}u;
 let i=listAt(group)*${FINE_PER_GROUP}u+slot;
 if(index%${FINE_SIDE * FINE_SIDE}u==0u){
  var t:Tri;t.ok=0u;
  if(i<atomicLoad(&work[LIST+${CNT_FINE}u])){t=triOf(atomicLoad(&work[LIST_S+i]),mode);}
  shared_tri[slot]=t;
 }
 workgroupBarrier();
 let t=shared_tri[slot];
 if(t.ok==0u){return;}
 let pixel=index%${FINE_SIDE * FINE_SIDE}u;
 rasterPixel(t,vec2i(t.lo)+vec2i(i32(pixel%${FINE_SIDE}u),i32(pixel/${FINE_SIDE}u)),mode==2u);
}
/** Triangle this group rasters, prepared by one thread and reread by the sixty-four. */
fn oneTri(entry:u32,valid:bool,lane:vec3u,mode:u32)->Tri{
 if(lane.x==0u&&lane.y==0u){
  var t:Tri;t.ok=0u;
  if(valid){t=triOf(entry,mode);}
  shared_tri[0]=t;
 }
 workgroupBarrier();
 return shared_tri[0];
}
fn coarseGroup(group:vec3u,lane:vec3u,mode:u32){
 let i=listAt(group);
 let live=i<atomicLoad(&work[LIST+${CNT_COARSE}u]);
 let t=oneTri(select(0u,atomicLoad(&work[LIST_S+${capacity}u-1u-held(i)]),live),live,lane,mode);
 if(t.ok==0u){return;}
 rasterPixel(t,vec2i(t.lo)+vec2i(lane.xy),mode==2u);
}
// Pixel of tile (tx,ty) of a box: rasterPixel drops those that leave the frame.
fn tilePixel(t:Tri,lane:vec3u,tx:u32,ty:u32)->vec2i{
 return vec2i(t.lo)+vec2i(i32(tx*${TILE}u+lane.x),i32(ty*${TILE}u+lane.y));
}
fn largeGroup(group:vec3u,lane:vec3u,mode:u32){
 let i=listAt(group);
 let live=i<atomicLoad(&work[LIST+${CNT_LARGE}u]);
 let t=oneTri(select(0u,atomicLoad(&work[LIST_L+held(i)]),live),live,lane,mode);
 if(t.ok==0u){return;}
 let cols=tileCols(t);let rows=tileRows(t);
 for(var ty=0u;ty<rows;ty=ty+1u){
  for(var tx=0u;tx<cols;tx=tx+1u){
   rasterPixel(t,tilePixel(t,lane,tx,ty),mode==2u);
  }
 }
}
// The huge class no longer loops over its tile rows: each is one more group, taken on the
// dispatch y dimension. A group whose row overshoots its triangle's box leaves.
fn hugeGroup(group:vec3u,lane:vec3u,mode:u32){
 let i=group.x+group.z*${DISPATCH_SPAN}u;
 let live=i<atomicLoad(&work[LIST+${CNT_HUGE}u]);
 let t=oneTri(select(0u,atomicLoad(&work[LIST_L+${capacity}u-1u-held(i)]),live),live,lane,mode);
 if(t.ok==0u||group.y>=tileRows(t)){return;}
 let cols=tileCols(t);
 for(var tx=0u;tx<cols;tx=tx+1u){
  rasterPixel(t,tilePixel(t,lane,tx,group.y),mode==2u);
 }
}
${entryPoints()}
`;
