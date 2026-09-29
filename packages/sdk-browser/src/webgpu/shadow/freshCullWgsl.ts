import {
  MOBILITY_CORNER_SHIFT,
  SHADOW_CULL_GROUP,
  SHADOW_VOLUME_WGSL,
} from '../../gpu/shadow/cullShader.ts';
import { FRESH_LAYOUT_WGSL, FRESH_PARAMS_WGSL } from './freshLayout.ts';

/**
 * THE CULL OF THE PAGES THE GPU DRAWS ITSELF (#1275): one invocation per caster row and per
 * region the compose laid out (`freshWgsl.ts`), dispatched by the arguments it wrote. Every row of
 * the frame is tested — the page table's, every resident page of every caster, whatever the camera
 * or a light cut selected, then the blended casters' —, against the region's own volume in light
 * space by the regions' one test (`sphereTouches`): a caster the camera does not see keeps its
 * shadow on a receiver it sees. Each row a region keeps is one pair, `(region, row)`, in one list
 * every layer's draw reads (`shader.ts`, `shadow_fresh_vs`); the draws' corners are the most any
 * kept row draws. The compose picks no more regions than the list holds a pair of every row for
 * (`pickPages`): no pair is ever past its capacity, and no page is sealed short of a caster.
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
fn keepPair(k:u32,row:u32){
 if(!sphereTouches(volumes[k],spheres[row])){return;}
 let at=atomicAdd(&args[FRESH_PAIRS],1u);
 if(at>=atomicLoad(&args[FRESH_CAPACITY])){return;}
 pairs[2u*at]=k;pairs[2u*at+1u]=row;
 atomicMax(&args[FRESH_CORNERS],mobility[row]>>${MOBILITY_CORNER_SHIFT}u);
}
@compute @workgroup_size(${SHADOW_CULL_GROUP}) fn shadowCullPairs(@builtin(global_invocation_id) id:vec3u){
 let row=freshRow(id.x);
 if(row<0||id.y>=atomicLoad(&args[FRESH_REGIONS])){return;}
 keepPair(id.y,u32(row));
}`;
