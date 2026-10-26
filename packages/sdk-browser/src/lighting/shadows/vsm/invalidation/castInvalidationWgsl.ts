/**
 * THE ONE STALE OF THE SHADOW CHANGES (`castInvalidation.ts`), over the previous frame's maps, in
 * two ranges of boxes of one format: the list the diff of the instances' boxes appended
 * (`../../casters/castChanges.ts`), read where it lies, never by the CPU, then the CPU's boxes
 * (`castBoxes.ts`), read from their own buffer. One thread a (box, map) pair stales a box's pages
 * (`vsmStaleBoxPages`) in every map: a box of casters already moving stales the dynamic layer of
 * each page it touches, whatever drew it, but for the coarse pages of a map whose coarse pages keep
 * their dynamic layer (`VSM_MAP_COARSE_KEEPS_DYNAMIC`): those keep the shadow a mover left until a
 * static change stales both their layers. A map that uses the receiver cover draws its dynamic
 * layer again each frame, so it skips such a box altogether: only the box of a first move (the
 * static layer's) and a change of the static casters stale it.
 *
 * A box is four vectors of four words, the same in the list and in the CPU's buffer: its centre and
 * a sign (floats), negative for casters already moving, then its three half axes (floats, one a
 * vector; the first's fourth word the bits of the views whose maps it stales).
 * A list that overflowed reads as one box holding the world: every page goes stale, never fewer.
 *
 * The dispatch's size is the GPU's: a one-thread kernel (`CAST_ARGS_WGSL`) writes its indirect
 * arguments from the list's count, the CPU's boxes' and the maps', before the CPU could know the
 * list's count.
 */
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock, wgslFn, wgslStruct } from '../../../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../../../math/src/wgsl/number.ts'
import { ceilDivWgsl } from '../../../../../../math/src/wgsl/integer.ts'
import { GROUP_GRID_WGSL, WORKGROUP_THREADS_WGSL } from '../../../../gpu/dispatch/grid.ts'
import { UNBOUNDED_EXTENT, VSM_NO_HZB_WGSL, vsmInvalidationProgram } from '../invalidationWgsl.ts'
import { VSM_OCCLUSION_PAGES_WGSL } from '../occlusion/occlusionTestWgsl.ts'
import type { VsmLayout } from '../layout.ts'

/** Whether a list of `records` records whose header is `header` overflowed, and the boxes the stale
 *  reads: the list's then the CPU's `boxes`; one, the world's, once the list overflowed. The two
 *  kernels read it alike. */
const CASTS_WHOLE = wgslFn(
  'castsWhole',
  [],
  'fn castsWhole(header:vec4u,records:u32)->bool{return header.y!=0u||header.x>records;}',
)
/** The boxes a list of `vectors` vectors of four words holds: its header takes the first, a box four. */
const CAST_RECORDS = wgslFn(
  'castRecords',
  [],
  'fn castRecords(vectors:u32)->u32{return (vectors-1u)/4u;}',
)
const CAST_TOTAL = wgslFn(
  'castTotal',
  [CASTS_WHOLE],
  'fn castTotal(header:vec4u,records:u32,boxes:u32)->u32{return select(header.x+boxes,1u,castsWhole(header,records));}',
)

/** The stale's parameters, which its two kernels read: the maps' count, the CPU's boxes', whether the
 *  pages are tested against the previous frame's pyramid (`shadowCacheInvalidateUseHzb`, the kept
 *  tables bound). */
const CAST_PARAMS = wgslStruct(
  'VsmCastParams',
  [],
  'struct VsmCastParams{mapCount:u32,boxCount:u32,useHzb:u32,_pad1:u32,}',
)
/** Bytes of the stale's parameters (`VsmCastParams`). */
export const VSM_CAST_PARAMS_BYTES = 16

/** The pass's entry, one thread a (record, map) pair. */
export const CAST_INVALIDATION_ENTRY = 'vsmStaleCasts'

/** The pyramid's hooks of the stale (`vsmStaleBoxPages`), the reference's test of an invalidation
 *  against the previous frame's depth pyramid: the box's rect in the map's mip, a hair nearer
 *  (\`1e-8\`, the reference's allowance for a box parallel to the light's near plane), held at the
 *  level where a page is 4x4 texels; a page the pyramid hides it on is not seen, a page the table does
 *  not map is. Group 2: the kept tables of the previous frame, the first cull's. */
const CAST_HZB_WGSL = wgslBlock(
  'CAST_HZB_WGSL',
  [VSM_OCCLUSION_PAGES_WGSL],
  `
struct VsmHzbRect{rect:VsmScreenRect,}
fn vsmHzbRectOf(cull:VsmBoxInView,mapTexels:i32)->VsmHzbRect{
 var r=vsmScreenRect(vec4i(0,0,mapTexels,mapTexels),cull);
 r.depth+=1e-8;
 return VsmHzbRect(vsmPageLevelRect(r));
}
fn vsmHzbPageSeen(h:VsmHandle,mipLevel:u32,r:VsmHzbRect,x:u32,y:u32)->bool{
 if(vsmCast.useHzb==0u){return true;}
 return vsmPageVisibleHzb(h,mipLevel,r.rect,x,y,false,true);
}
`,
)

/** The stale of the list's records, then the CPU's boxes, over the previous frame's maps
 *  (`vsmStaleBoxPages`), the pages tested against the pyramid where the layout holds it. */
export const castInvalidationWgsl = (layout: VsmLayout) =>
  vsmInvalidationProgram(
    layout,
    /* wgsl */ `
@group(1) @binding(0) var<uniform> vsmCast:VsmCastParams;
@group(1) @binding(1) var<storage,read> vsmCastMaps:array<u32>;
@group(1) @binding(2) var<storage,read> vsmCasts:array<vec4u>;
@group(1) @binding(3) var<storage,read> vsmCastBoxes:array<vec4u>;
const UNBOUNDED_EXTENT:f32=${wgslF32(UNBOUNDED_EXTENT)};
@compute @workgroup_size(WORKGROUP_THREADS)
fn ${CAST_INVALIDATION_ENTRY}(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lidx:u32){
 let thread=flatIndex(wid,nwg,1u)*WORKGROUP_THREADS+lidx;
 let maps=vsmCast.mapCount;
 if(maps==0u){return;}
 let header=vsmCasts[0];
 let records=castRecords(arrayLength(&vsmCasts));
 let box=thread/maps;
 if(box>=castTotal(header,records,vsmCast.boxCount)){return;}
 var inst=VsmInvalidationInstance(vec3f(0.0),0u,vec3f(UNBOUNDED_EXTENT,0.0,0.0),0xffffffffu,vec3f(0.0,UNBOUNDED_EXTENT,0.0),0u,vec3f(0.0,0.0,UNBOUNDED_EXTENT),0u);
 if(!castsWhole(header,records)){
  var record:vec4u;
  var axes:array<vec4u,3>;
  if(box<header.x){
   let at=1u+4u*box;
   record=vsmCasts[at];
   axes=array<vec4u,3>(vsmCasts[at+1u],vsmCasts[at+2u],vsmCasts[at+3u]);
  }else{
   let at=4u*(box-header.x);
   record=vsmCastBoxes[at];
   axes=array<vec4u,3>(vsmCastBoxes[at+1u],vsmCastBoxes[at+2u],vsmCastBoxes[at+3u]);
  }
  inst.centre=bitcast<vec3f>(record.xyz);
  inst.axisX=bitcast<vec3f>(axes[0].xyz);
  inst.axisY=bitcast<vec3f>(axes[1].xyz);
  inst.axisZ=bitcast<vec3f>(axes[2].xyz);
  inst.views=axes[0].w;
  inst.flags=select(0u,VSM_BOX_MOVING,bitcast<f32>(record.w)<0.0);
 }
 let mapId=vsmCastMaps[thread%maps];
 if(mapId>=arrayLength(&vsmProjectionData)){return;}
 vsmStaleBoxPages(vsmProjectionOf(vsmHandleFromId(mapId)),inst);
}
`,
    [CAST_PARAMS, CAST_TOTAL, CAST_RECORDS, layout.occlusion ? CAST_HZB_WGSL : VSM_NO_HZB_WGSL],
  )

/** The arguments' kernel's entry. */
export const CAST_ARGS_ENTRY = 'vsmCastArgs'

/** One thread: the stale's indirect arguments, its workgroups over every (record, map) pair, in
 *  rows (`groupGrid`). */
export const CAST_ARGS_WGSL = wgslProgram(
  /* wgsl */ `
@group(0) @binding(0) var<uniform> vsmCast:VsmCastParams;
@group(0) @binding(1) var<storage,read> casts:array<vec4u>;
@group(0) @binding(2) var<storage,read_write> args:array<u32>;
@compute @workgroup_size(1) fn ${CAST_ARGS_ENTRY}(){
 let count=castTotal(casts[0],castRecords(arrayLength(&casts)),vsmCast.boxCount);
 let grid=groupGrid(ceilDiv(count*vsmCast.mapCount,WORKGROUP_THREADS));
 args[0]=grid.x;
 args[1]=grid.y;
 args[2]=1u;
}`,
  [CAST_PARAMS, GROUP_GRID_WGSL, CAST_TOTAL, CAST_RECORDS, ceilDivWgsl, WORKGROUP_THREADS_WGSL],
)
