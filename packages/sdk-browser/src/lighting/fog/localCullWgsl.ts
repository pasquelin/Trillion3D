import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FOG_FURTHEST_READ_WGSL } from './integrateWgsl.ts'
import { LOCAL_FOG_SLOT } from './localLayout.ts'
import { FOG_LOCAL_DATA_WGSL, localFogBlock } from './localWgsl.ts'

const row = (at: number) => localFogBlock(LOCAL_FOG_SLOT.projection + at)
/** The rows of the view-projection, for a point relative to the eye (`LOCAL_FOG_SLOT.projection`). */
const ROWS = { x: row(0), y: row(1), z: row(2), w: row(3) } as const
const SCREEN = localFogBlock(LOCAL_FOG_SLOT.screen)
const TILING = localFogBlock(LOCAL_FOG_SLOT.tiling)

/** Threads of a workgroup along each side of the tile grid, and along the volumes. */
export const LOCAL_CULL_TILE_SIDE = 8
export const LOCAL_CULL_VOLUME_GROUP = 64

/**
 * THE LOCAL FOG VOLUMES CULLED BY TILE (`localCullTile`): the view is cut into square tiles of pixels
 * (`LOCAL_FOG_SLOT.tiling`), and one thread a tile keeps, in the lists' buffer (`localFogTiles`), the
 * list of the volumes of the view that can show over it — a count, then the numbers of the volumes,
 * four to a word, in the order they are drawn (`localFogListVolume` reads them back). A pixel, or a cell
 * of the fog's volume, then walks the list of its tile and not every volume of the view.
 *
 * A volume stays in a tile's list unless its sphere lies wholly outside the tile's frustum: past one
 * of the four planes through the eye and the tile's sides — the rows of the view-projection combined
 * with the tile's edges in device coordinates, the last row and column of tiles reaching only as far
 * as the view — or wholly before the view's near distance; or the depth pyramid shows it hidden
 * (`localCullVolumeSeen`). The planes are taken at their length: a sphere is outside one where its
 * centre is farther past it than its radius.
 *
 * `FOG_LOCAL_CULL_SEEN_WGSL` and `FOG_LOCAL_CULL_HIDDEN_WGSL` are the two readings of
 * `localCullVolumeSeen` a program takes: every volume seen, or the pyramid's verdict, which
 * `localCullVolume` wrote once a volume for all the tiles. The program declares the light buffer as
 * `directLights` and the lists as the storage `localFogTiles`; for the second it lists the depth
 * pyramid's reader (`hizDepthWgsl`). The flags the pyramid's verdicts are kept in follow the tiles' lists.
 */
export const FOG_LOCAL_CULL_WGSL = wgslBlock(
  'FOG_LOCAL_CULL_WGSL',
  [FOG_LOCAL_DATA_WGSL],
  `
/** Whether the sphere of centre \`c\` and radius \`r\` lies wholly on the outer side of the plane \`plane\`
 *  (\`dot(xyz, p) + w\` at least 0 inside). */
fn localCullOutside(plane:vec4f,c:vec3f,r:f32)->bool{
 return dot(plane.xyz,c)+plane.w<-r*length(plane.xyz);
}
/** Whether the sphere lies wholly before the view's near distance, along the view's own depth (the row of
 *  the weight, which an orthographic projection has none of). */
fn localCullBeforeNear(c:vec3f,r:f32)->bool{
 let w=${ROWS.w};
 let scale=length(w.xyz);
 return scale>0.0&&(dot(w.xyz,c)+w.w)/scale+r<${SCREEN}.z;
}
@compute @workgroup_size(${LOCAL_CULL_TILE_SIDE},${LOCAL_CULL_TILE_SIDE},1)
fn localCullMain(@builtin(global_invocation_id) id:vec3u){localCullTile(id.xy);}
/** The list of the tile \`tile\` written into the lists' buffer: the volumes of the view, in order, that are
 *  neither outside the tile's four sides nor before the near distance nor hidden by the depth. */
fn localCullTile(tile:vec2u){
 let tiling=${TILING};
 if(tiling.y<1.0||any(tile>=vec2u(tiling.yz))){return;}
 let view=${SCREEN}.xy;
 // The tile's edges as device coordinates, its last row and column held to the view.
 let first=vec2f(tile)*tiling.x/view*2.0-1.0;
 let last=min((vec2f(tile)+1.0)*tiling.x,view)/view*2.0-1.0;
 let left=${ROWS.x}-first.x*${ROWS.w};
 let right=last.x*${ROWS.w}-${ROWS.x};
 let bottom=${ROWS.y}+last.y*${ROWS.w};
 let top=-first.y*${ROWS.w}-${ROWS.y};
 let list=(tile.y*u32(tiling.y)+tile.x)*u32(tiling.w);
 let count=localFogCount();
 var kept=0u;
 var word=0u;
 for(var i=0u;i<count;i++){
  let f=localFogAt(i);
  if(localCullOutside(left,f.centre,f.radius)||localCullOutside(right,f.centre,f.radius)||
   localCullOutside(bottom,f.centre,f.radius)||localCullOutside(top,f.centre,f.radius)||
   localCullBeforeNear(f.centre,f.radius)||!localCullVolumeSeen(i)){continue;}
  word|=i<<((kept&3u)*8u);
  kept++;
  if((kept&3u)==0u){
   localFogTiles[list+(kept>>2u)]=word;
   word=0u;
  }
 }
 if((kept&3u)!=0u){localFogTiles[list+1u+(kept>>2u)]=word;}
 localFogTiles[list]=kept;
}`,
)

/** The reading of `localCullVolumeSeen` that holds every volume seen: the run has no depth pyramid for the
 *  image, or does not ask for it to cull. */
export const FOG_LOCAL_CULL_SEEN_WGSL = wgslBlock(
  'FOG_LOCAL_CULL_SEEN_WGSL',
  [],
  `
fn localCullVolumeSeen(i:u32)->bool{return true;}`,
)

/**
 * The reading of `localCullVolumeSeen` that holds a volume hidden where the depth pyramid shows it
 * wholly behind the surfaces, as `localCullVolume` found, once for all the tiles (a thread a volume,
 * before the tiles' pass): the box around its sphere — its eight corners — is taken to the screen by
 * the rows of the view-projection; the rectangle they cover, the pixels whose centres it holds, is
 * read at the pyramid's level where four texels cover it (`fogFurthestOver`, which the fog's volume
 * reads its furthest depth by as well), the furthest depth of the surfaces over it; the volume is
 * hidden where even the box's nearest corner is further than that — a depth is the larger the nearer.
 * A box that reaches the plane of the eye covers the whole view and is as near as can be: it is
 * never hidden. The depth is the culling layer's, the farthest of the opaque surfaces alone, which
 * only comes nearer later in the image.
 */
export const FOG_LOCAL_CULL_HIDDEN_WGSL = wgslBlock(
  'FOG_LOCAL_CULL_HIDDEN_WGSL',
  [FOG_FURTHEST_READ_WGSL, FOG_LOCAL_DATA_WGSL],
  `
/** Whether the depth pyramid shows the box of the sphere of centre \`c\` and radius \`r\` hidden. */
fn localCullHidden(c:vec3f,r:f32)->bool{
 var low=vec2f(1.0);
 var high=vec2f(-1.0);
 var nearest=-1.0;
 var least=1e30;
 for(var corner=0u;corner<8u;corner++){
  let side=vec3f(f32(corner&1u),f32((corner>>1u)&1u),f32((corner>>2u)&1u))*2.0-1.0;
  let p=vec4f(c+r*side,1.0);
  let clip=vec4f(dot(${ROWS.x},p),dot(${ROWS.y},p),dot(${ROWS.z},p),dot(${ROWS.w},p));
  least=min(least,clip.w);
  if(clip.w>0.0){
   let ndc=clip.xyz/clip.w;
   low=min(low,ndc.xy);
   high=max(high,ndc.xy);
   nearest=max(nearest,ndc.z);
  }
 }
 if(least<=0.0){return false;}
 let uv=saturate(vec4f(low.x,high.y,high.x,low.y)*vec4f(0.5,-0.5,0.5,-0.5)+0.5);
 return nearest<fogFurthestOver(uv,${SCREEN}.xy);
}
/** Where the flags of the volumes lie in the lists' buffer: behind the lists of every tile. */
fn localCullFlags()->u32{return u32(${TILING}.y)*u32(${TILING}.z)*u32(${TILING}.w);}
fn localCullVolumeSeen(i:u32)->bool{return localFogTiles[localCullFlags()+i]!=0u;}
/** The verdict on the volume \`i\`, kept for every tile (\`localCullVolumeSeen\`). */
fn localCullVolume(i:u32){
 if(i>=localFogCount()){return;}
 let f=localFogAt(i);
 localFogTiles[localCullFlags()+i]=select(1u,0u,localCullHidden(f.centre,f.radius));
}
@compute @workgroup_size(${LOCAL_CULL_VOLUME_GROUP})
fn localCullVolumesMain(@builtin(global_invocation_id) id:vec3u){localCullVolume(id.x);}`,
)
