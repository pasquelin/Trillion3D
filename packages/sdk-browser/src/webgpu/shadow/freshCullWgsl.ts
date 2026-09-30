import {
  MOBILITY_CORNER_SHIFT,
  SHADOW_CULL_GROUP,
  SHADOW_VOLUME_WGSL,
} from '../../gpu/shadow/cullShader.ts';
import { LANE_SCAN_WGSL } from '../../gpu/core/laneScanWgsl.ts';
import { FRESH_LAYOUT_WGSL, FRESH_PARAMS_WGSL } from './freshLayoutWgsl.ts';

/**
 * THE CULL OF THE PAGES THE GPU DRAWS ITSELF (#1275): one invocation per caster row and per
 * region the compose laid out (`freshWgsl.ts`), dispatched by the arguments it wrote. Every row of
 * the frame is tested — the page table's, every resident page of every caster, whatever the camera
 * or a light cut selected, then the blended casters' —, against the region's own volume in light
 * space by the regions' one test (`sphereTouches`): a caster the camera does not see keeps its
 * shadow on a receiver it sees. Each row a region keeps is one pair, `(region, row)`, in one list
 * every layer's draw reads (`shader.ts`, `shadow_fresh_vs`); the draws' corners are the most any
 * kept row draws.
 *
 * In three steps, so a region is drawn whole or not at all (#1363): `shadowCountPairs` counts each
 * region's pairs; `admitShadowPairs`, one workgroup, gives each region its place in the list —
 * the regions' counts scanned over the lanes, a run of regions each (`LANE_SCAN_WGSL`, as the
 * tested half's compaction does) — and admits the longest prefix of whole regions the list holds:
 * the rest are marked short (`FRESH_SHORT`), keep none and wait, unread, for the next frame. It
 * writes the pairs kept and those every region counted, which the seal hands the host to grow the
 * list by (`pairGrowth.ts`); `shadowCullPairs` lays each admitted region's pairs from its place on.
 * No pair is past the list, and none is drawn for a page left unreadable.
 */
export const SHADOW_FRESH_CULL_WGSL = `
${SHADOW_VOLUME_WGSL}
${FRESH_PARAMS_WGSL}
${FRESH_LAYOUT_WGSL}
@group(0) @binding(0) var<storage,read> spheres:array<Sphere>;
@group(0) @binding(1) var<storage,read> params:ShadowFreshParams;
@group(0) @binding(2) var<storage,read> volumes:array<Face>;
@group(0) @binding(3) var<storage,read_write> pairs:array<u32>;
@group(0) @binding(4) var<storage,read_write> args:array<atomic<u32>>;
@group(0) @binding(5) var<storage,read> mobility:array<u32>;
/** The row of invocation \`i\`: the table's rows first, then the blended casters'; past both, none. */
fn freshRow(i:u32)->i32{
 if(i<params.rows){return i32(i);}
 let row=params.blendFirst+(i-params.rows);
 return select(-1,i32(row),row<params.blendEnd);
}
/** Whether region \`k\` keeps the row of invocation \`i\`. */
fn freshKeeps(k:u32,i:u32)->bool{
 let row=freshRow(i);
 return row>=0&&k<atomicLoad(&args[FRESH_REGIONS])&&sphereTouches(volumes[k],spheres[u32(row)]);
}
@compute @workgroup_size(${SHADOW_CULL_GROUP}) fn shadowCountPairs(@builtin(global_invocation_id) id:vec3u){
 if(freshKeeps(id.y,id.x)){atomicAdd(&args[freshRegionPairs(params.pages,id.y)],1u);}
}
${LANE_SCAN_WGSL}@compute @workgroup_size(64) fn admitShadowPairs(@builtin(local_invocation_index) lane:u32){
 let span=laneRun(lane,atomicLoad(&args[FRESH_REGIONS]));
 var sum=0u;
 for(var k=span.x;k<span.y;k++){sum+=atomicLoad(&args[freshRegionPairs(params.pages,k)]);}
 var at=laneScan(lane,sum)-sum;
 for(var k=span.x;k<span.y;k++){
  let slot=freshRegionPairs(params.pages,k);let count=atomicLoad(&args[slot]);
  let fits=at<=params.capacity&&count<=params.capacity-at;
  // The first region past the prefix: the pairs kept end where it would have started.
  if(at<=params.capacity&&!fits){atomicStore(&args[FRESH_PAIRS],at);}
  atomicStore(&args[slot],select(FRESH_SHORT,at,fits));at+=count;
 }
 if(lane==63u){
  let need=laneSums[63u];atomicStore(&args[FRESH_NEED],need);
  if(need<=params.capacity){atomicStore(&args[FRESH_PAIRS],need);}
 }
}
@compute @workgroup_size(${SHADOW_CULL_GROUP}) fn shadowCullPairs(@builtin(global_invocation_id) id:vec3u){
 let slot=freshRegionPairs(params.pages,id.y);
 if(atomicLoad(&args[slot])==FRESH_SHORT||!freshKeeps(id.y,id.x)){return;}
 let row=u32(freshRow(id.x));let at=atomicAdd(&args[slot],1u);
 pairs[2u*at]=id.y;pairs[2u*at+1u]=row;
 atomicMax(&args[FRESH_CORNERS],mobility[row]>>${MOBILITY_CORNER_SHIFT}u);
}`;
