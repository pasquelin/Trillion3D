import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { FLAT_INDEX_WGSL } from '../../../gpu/dispatch/grid.ts'
import { HAIR_TILE_ALL, HAIR_TILE_SIZE } from '../../../hair/visibilityMath.ts'
import { hairTilePixel } from '../../../hair/tilesWgsl.ts'
import { WORLD_AT_WGSL } from '../../deferred/worldAtWgsl.ts'
import { markPoint } from './poolMarkWgsl.ts'

/** Where the strands' mark pass binds what it reads and writes, in group 0. */
export const MARK_HAIR_BINDINGS = {
  grid: 0,
  view: 1,
  hairDepth: 2,
  counts: 3,
  tiles: 4,
  marks: 5,
} as const
const b = MARK_HAIR_BINDINGS

/**
 * THE MARK PASS OVER THE STRANDS' TILES: a group a tile of the list of all the tiles with strands, a thread a pixel of it. The tile's depth is the
 * nearest strand any of its pixels holds (reverse depth: the largest, 0 for none); where there is one, the points of the tile's rectangle at that depth
 * — its two opposite corners, the box they span — mark the probes of the levels that hold them (`markPoint`), the eight corners of the box:
 * a box inside the cell of one level marks the cell's probes once, one across a cell or a level marks each side's.
 */
export const MARK_HAIR_SHADER = wgslProgram(
  `@group(0) @binding(${b.grid}) var<uniform> bounce:BounceGrid;
@group(0) @binding(${b.view}) var<uniform> view:View;
@group(0) @binding(${b.hairDepth}) var hairDepth:texture_2d<f32>;
@group(0) @binding(${b.counts}) var<uniform> hairTileCounts:vec4u;
@group(0) @binding(${b.tiles}) var<storage,read> hairTiles:array<u32>;
var<workgroup> nearest:atomic<u32>;
@compute @workgroup_size(${HAIR_TILE_SIZE},${HAIR_TILE_SIZE})
fn markHair(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_id) lane:vec3u){
 let rank=flatIndex(group,n,1u);
 // The whole group leaves together or none does: the barrier below is reached by every thread.
 let listed=rank<hairTileCounts[${HAIR_TILE_ALL}]&&bounce.counts.w!=0u;
 let tile=select(0u,hairTiles[rank],listed);
 let pixel=hairTilePixel(tile,lane.xy);
 if(lane.x==0u&&lane.y==0u){atomicStore(&nearest,0u);}
 workgroupBarrier();
 if(listed&&all(pixel<vec2u(view.viewport.xy))){
  // Depths are not negative, so their bits order as the values do.
  atomicMax(&nearest,bitcast<u32>(max(textureLoad(hairDepth,vec2i(pixel),0).x,0.0)));
 }
 workgroupBarrier();
 if(!listed||lane.x!=0u||lane.y!=0u){return;}
 let z=bitcast<f32>(atomicLoad(&nearest));
 if(!(z>0.0)){return;}
 let low=vec2f(hairTilePixel(tile,vec2u(0u)));
 let a=worldAt(low,z);
 let c=worldAt(low+vec2f(${HAIR_TILE_SIZE}.0),z);
 let lo=min(a,c);
 let hi=max(a,c);
 for(var corner=0u;corner<8u;corner++){
  markPoint(select(lo,hi,vec3<bool>((corner&1u)!=0u,(corner&2u)!=0u,(corner&4u)!=0u)));
 }
}`,
  [WORLD_AT_WGSL, FLAT_INDEX_WGSL, hairTilePixel, markPoint(b.marks)],
)
