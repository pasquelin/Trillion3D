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
 * `dfshTraceThroughTileWith` is the same walk for a ray with a cone (the tangent of its half angle and its least radius, centimetres, in `cone`), the tile of the point `at`, and the meshes' surfaces expanded or not: the sun's cascade on the view reads it (`classic/fieldShadow/`).
 */
export const dfshTileTraceWgsl = (group: number, suns: number) =>
  wgslBlock(
    `DFSH_TILE_TRACE_WGSL ${group} ${suns}`,
    [dfshCommonWgsl(group, suns), dfshTraceObjectWgsl(group, suns)],
    `@group(${group}) @binding(${B.tileOffsets}) var<storage,read> tileLists:array<u32>;
var<private> dfshSet:u32=0xffffffffu;
fn dfshTraceThroughTileWith(sun:u32,at:vec3f,rayStart:vec3f,rayEnd:vec3f,cone:vec2f,expandSurface:bool)->f32{
 if(dfshSet!=sun){dfsh=dfshSuns[sun];dfshSet=sun;}
 let tile=dfshTileOf(at);
 if(tile.x<0){return 1.0;}
 let own=u32(tile.y)*dfsh.tiles.x+u32(tile.x);
 let place=dfsh.counts.z+own;
 let start=dfshTileStart(own,tileLists[dfsh.lists.y+place]);
 let count=min(tileLists[dfsh.lists.z+place],dfshTileRoom(start));
 var visibility=1.0;
 for(var k=0u;k<count;k++){
  visibility=dfshTraceCone(tileLists[dfsh.lists.w+dfsh.lists.x+start+k],rayStart,rayEnd,cone.x,cone.y,expandSurface,visibility);
  if(visibility<0.01){return 0.0;}
 }
 return visibility;
}
fn dfshTraceThroughTile(sun:u32,rayStart:vec3f,rayEnd:vec3f)->f32{
 return dfshTraceThroughTileWith(sun,rayStart,rayStart,rayEnd,vec2f(0.0),true);
}`,
  )
