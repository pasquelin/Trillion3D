import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { dfshCommonWgsl } from './commonWgsl.ts'
import { DFSH_BINDING as B } from './layout.ts'
import { dfshTraceObjectWgsl } from './traceObjectWgsl.ts'

/**
 * THE RAY OF A POINT THROUGH THE MESHES OF THE TILE IT STARTS IN (`dfshTraceThroughTile`), for the sun `sun` of the `suns` the bind group
 * `group` holds: the positions from the eye, in centimetres, the lists the group's one buffer of tile lists holds — the tiles' start offsets from
 * the word `lists.y` of the sun's block, their counts from `lists.z` and the entries from `lists.w`, a sun's after its predecessor's (its tiles from the
 * word `counts.z` of its block, its entries from `lists.x`): the tile's meshes in the order of
 * the list, a ray with no cone (no tangent, no least radius), the meshes' surfaces expanded, until it is wholly
 * occluded; 1 outside the grid of tiles. The cards' direct light reads it for the suns (`lighting/surfaceCache/lighting/meshShadowWgsl.ts`).
 */
export const dfshTileTraceWgsl = (group: number, suns: number) =>
  wgslBlock(
    `DFSH_TILE_TRACE_WGSL ${group} ${suns}`,
    [dfshCommonWgsl(group, suns), dfshTraceObjectWgsl(group, suns)],
    `@group(${group}) @binding(${B.tileOffsets}) var<storage,read> tileLists:array<u32>;
var<private> dfshSet:u32=0xffffffffu;
fn dfshTraceThroughTile(sun:u32,rayStart:vec3f,rayEnd:vec3f)->f32{
 if(dfshSet!=sun){dfsh=dfshSuns[sun];dfshSet=sun;}
 let tile=dfshTileOf(rayStart);
 if(tile.x<0){return 1.0;}
 let own=u32(tile.y)*dfsh.tiles.x+u32(tile.x);
 let at=dfsh.counts.z+own;
 let start=dfshTileStart(own,tileLists[dfsh.lists.y+at]);
 let count=min(tileLists[dfsh.lists.z+at],dfshTileRoom(start));
 var visibility=1.0;
 for(var k=0u;k<count;k++){
  visibility=dfshTraceCone(tileLists[dfsh.lists.w+dfsh.lists.x+start+k],rayStart,rayEnd,0.0,0.0,true,visibility);
  if(visibility<0.01){return 0.0;}
 }
 return visibility;
}`,
  )
