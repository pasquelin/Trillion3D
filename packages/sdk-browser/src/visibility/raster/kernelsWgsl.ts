import {
  CNT_COARSE,
  CNT_FINE,
  CNT_LARGE,
  FINE_PER_GROUP,
  FINE_SIDE,
  LIST_HEADER,
  MODE_DEPTH,
  MODE_ID,
  RASTER_CLASSES,
  TILE,
  rasterEntry,
} from './contract.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FLAG_MASK } from '../types.ts'
import { VIS_TRIANGLE_BITS } from '../visWords.ts'

/** The six entry points: three size classes, each in the two modes. */
const entryPoints = () =>
  RASTER_CLASSES.flatMap((klass) =>
    [MODE_DEPTH, MODE_ID].map(
      (mode) =>
        `@compute @workgroup_size(${TILE},${TILE}) fn ${rasterEntry(klass, mode)}(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_id) l:vec3u,@builtin(num_workgroups) n:vec3u){${klass}Group(g,l,n,${mode}u);}`,
    ),
  ).join('\n')

/**
 * The class lists of one pass in the `work` buffer, as its binning appends to them and its raster
 * passes read them: `LIST`, their header's first word, is the pipeline's override — the main
 * pass's lists or the post pass's (`RASTER_PASSES`) —, `capacity` entries a list. Fine and coarse
 * share `LIST_S`, the fine class from the front and the coarse one from the back: neither
 * overflows while the other has room, and the bound held is the sum — every triangle of every
 * row. Large has `LIST_L`.
 */
export const rasterListWgsl = (capacity: number) =>
  wgslBlock(
    `rasterListWgsl(${capacity})`,
    [],
    `
override LIST:u32;
override LIST_S:u32=LIST+${LIST_HEADER}u;
override LIST_L:u32=LIST+${LIST_HEADER + capacity}u;
/** Class \`k\`'s list place of its \`at\`-th entry, \`k\` its count's rank (\`CNT_*\`). */
fn classPlace(k:u32,at:u32)->u32{
 if(k==${CNT_LARGE}u){return LIST_L+at;}
 return select(LIST_S+at,LIST_S+${capacity}u-1u-at,k==${CNT_COARSE}u);
}
/** Class \`k\`'s count (\`CNT_*\`). */
fn classCount(k:u32)->u32{return atomicLoad(&work[LIST+k]);}
`,
  )

/**
 * Software-raster kernels: the three classes, each in the two modes, over the lists of the
 * pipeline's pass (`LIST`).
 *
 * **The passes are the cut's.** Each pass has its own binning (`binWgsl.ts`), which selects its
 * rows by its own mask — the main pass's draws before the post pass, the post pass's alone after
 * it —, so every entry of a pass's lists is drawn by that pass: no kernel reads a verdict. The main
 * pass's depth is what the pyramid of the post pass's test reduces; the identifiers are chosen
 * once both passes' depths are down, over both passes' lists. An image whose cut ran in one pass
 * has no post lists to draw.
 */
export const rasterKernels = (capacity: number) => `
/** A list entry becomes the triangle it names again: set up as binning set it up
 *  (\`setupTriangle\`), with the cutout coordinate and the vertex alpha of its corners on a masked
 *  row — the only one that pays the read of its surface's header. */
fn triOf(entry:u32)->Tri{
 let row=entry>>${VIS_TRIANGLE_BITS}u;let page=pages[row];
 let masked=(page.flags&${FLAG_MASK}u)!=0u;
 let h=pageHeaderFor(page,masked);
 var t=setupTriangle(row,page,h,visTriangle(entry),pageTransform(page),pageWinding(page));
 if(t.ok!=0u&&masked){
  let k=t.corners;
  t.ua=vec3f(pageMaskUv(page,h,k.x),pageMaskAlpha(page,h,k.x));
  t.ub=vec3f(pageMaskUv(page,h,k.y),pageMaskAlpha(page,h,k.y));
  t.uc=vec3f(pageMaskUv(page,h,k.z),pageMaskAlpha(page,h,k.z));
 }
 return t;
}
// A group past its class count reads nothing useful, but it does read: its rank is clamped on
// the list so that read stays in the buffer. Its triangle is dropped just after.
fn held(i:u32)->u32{return min(i,${capacity - 1}u);}
// A group is always sixty-four threads, whatever the class: coarse spends them on the eight-by-
// eight tile of a single triangle, fine on ${FINE_PER_GROUP} triangles of ${FINE_SIDE}×${FINE_SIDE}
// pixels each. A triangle is prepared once for the threads that share it, which then reread what
// a per-thread prepare would have produced.
var<workgroup> shared_tri:array<Tri,${FINE_PER_GROUP}u>;
fn fineGroup(group:vec3u,lane:vec3u,n:vec3u,mode:u32){
 let index=lane.y*${TILE}u+lane.x;
 let slot=index/${FINE_SIDE * FINE_SIDE}u;
 let i=flatIndex(group,n,1u)*${FINE_PER_GROUP}u+slot;
 if(index%${FINE_SIDE * FINE_SIDE}u==0u){
  var t:Tri;t.ok=0u;
  if(i<classCount(${CNT_FINE}u)){t=triOf(atomicLoad(&work[classPlace(${CNT_FINE}u,i)]));}
  shared_tri[slot]=t;
 }
 workgroupBarrier();
 let t=shared_tri[slot];
 if(t.ok==0u){return;}
 let pixel=index%${FINE_SIDE * FINE_SIDE}u;
 rasterPixel(t,t.minPixel+vec2i(i32(pixel%${FINE_SIDE}u),i32(pixel/${FINE_SIDE}u)),mode);
}
/** Triangle this group rasters, prepared by one thread and reread by the sixty-four. */
fn oneTri(entry:u32,valid:bool,lane:vec3u)->Tri{
 if(lane.x==0u&&lane.y==0u){
  var t:Tri;t.ok=0u;
  if(valid){t=triOf(entry);}
  shared_tri[0]=t;
 }
 workgroupBarrier();
 return shared_tri[0];
}
fn coarseGroup(group:vec3u,lane:vec3u,n:vec3u,mode:u32){
 let i=flatIndex(group,n,1u);
 let live=i<classCount(${CNT_COARSE}u);
 let t=oneTri(select(0u,atomicLoad(&work[classPlace(${CNT_COARSE}u,held(i))]),live),live,lane);
 if(t.ok==0u){return;}
 rasterPixel(t,t.minPixel+vec2i(lane.xy),mode);
}
// Pixel of tile (tx,ty) of a box: rasterPixel drops those past it.
fn tilePixel(t:Tri,lane:vec3u,tx:u32,ty:u32)->vec2i{
 return t.minPixel+vec2i(i32(tx*${TILE}u+lane.x),i32(ty*${TILE}u+lane.y));
}
fn largeGroup(group:vec3u,lane:vec3u,n:vec3u,mode:u32){
 let i=flatIndex(group,n,1u);
 let live=i<classCount(${CNT_LARGE}u);
 let t=oneTri(select(0u,atomicLoad(&work[classPlace(${CNT_LARGE}u,held(i))]),live),live,lane);
 if(t.ok==0u){return;}
 // At most eight tiles an axis: the setup holds every box to \`MAX_SPAN\`.
 let cols=tileCols(t);let rows=tileRows(t);
 for(var ty=0u;ty<rows;ty=ty+1u){
  for(var tx=0u;tx<cols;tx=tx+1u){
   rasterPixel(t,tilePixel(t,lane,tx,ty),mode);
  }
 }
}
${entryPoints()}
`
