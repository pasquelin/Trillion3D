import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { meshFieldWgsl } from '../meshFieldWgsl.ts'
import { OBJECT_DATA_STRIDE } from '../layout.ts'
import { DFSH_COMMON_WGSL } from './commonWgsl.ts'
import { DFSH_BINDING as B, DFSH_CUBE } from './layout.ts'

/**
 * A POINT OF A MESH'S VOLUME in the shadow space (`dfshObjectPoint`): the record's volume-to-world
 * rows (the fourth, fifth and sixth `vec4` after its first three, `objectRecords.ts`) take the point,
 * a position from the mesh's high centre, to the world; the eye is taken off by the pair of floats.
 */
const DFSH_OBJECT_POINT_WGSL = wgslBlock(
  'DFSH_OBJECT_POINT_WGSL',
  [DFSH_COMMON_WGSL],
  `fn dfshVolumeToWorld(object:u32,row:u32)->vec4f{
 return bitcast<vec4f>(sceneObjectData[object*${OBJECT_DATA_STRIDE}u+6u+row]);
}
fn dfshObjectPoint(object:u32,local:vec3f)->vec3f{
 let p=vec4f(local,1.0);
 let high=bitcast<vec3f>(sceneObjectData[object*${OBJECT_DATA_STRIDE}u].xyz);
 let relative=vec3f(dot(dfshVolumeToWorld(object,0u),p),dot(dfshVolumeToWorld(object,1u),p),dot(dfshVolumeToWorld(object,2u),p));
 return dfshFromEye(DfVec3(high,relative));
}
fn dfshCorner(i:u32)->vec3f{
 return vec3f(select(-1.0,1.0,(i&1u)!=0u),select(-1.0,1.0,(i&2u)!=0u),select(-1.0,1.0,(i&4u)!=0u));
}`,
)

/**
 * THE MESHES SCATTERED TO THE GRID OF TILES (`dfshScatterVs`, `dfshScatterCount`, `dfshScatterWrite`): the
 * box of every culled mesh — a cube of its volume's extent, grown by the half diagonal of a tile
 * (`dfsh.expand.x`), one side of it drawn (a convex box covers a pixel once on each side) — is seen
 * from the light into a target with a pixel a tile; each pixel is a tile the box covers, and
 * decides whether the mesh reaches it.
 *
 * The decision (`dfshTileHit`, a separating-axis test): the mesh's box in the shadow space, its
 * bounds grown by the widest cone radius across the light, must meet the tile's column, which runs
 * from the sphere's far side to far toward the light (z from 0 to 1000: a mesh between the light and
 * the cascade casts onto it), on the three axes of the tile's column; then the column's corners
 * must not all lie to one side of the box on any of the box's three axes. The count pass (run when the
 * lists are compacted) adds one to the tile; the write pass takes the next place in the tile's run of
 * the lists — from the start offsets, or the tile's own place when they are not compacted
 * (`dfshTileStart`) — and writes the mesh in it, if the room after the start has it (`dfshTileRoom`).
 * The target is a stand-in: the passes write no colour.
 */
export const DFSH_SCATTER_WGSL = wgslProgram(
  `@group(0) @binding(${B.culledObjects}) var<storage,read> culledObjects:array<u32>;
@group(0) @binding(${B.tileCounts}) var<storage,read_write> tileCounts:array<atomic<u32>>;
@group(0) @binding(${B.tileOffsets}) var<storage,read> tileOffsets:array<u32>;
@group(0) @binding(${B.tileData}) var<storage,read_write> tileData:array<u32>;
var<private> cubeCorners:array<u32,${DFSH_CUBE.length}>=array<u32,${DFSH_CUBE.length}>(${DFSH_CUBE.join(',')});
struct DfshScatter{
 @builtin(position) position:vec4f,
 @location(0) @interpolate(flat) object:u32,
}
@vertex
fn dfshScatterVs(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->DfshScatter{
 let object=culledObjects[instance];
 let x=dfshVolumeToWorld(object,0u);
 let y=dfshVolumeToWorld(object,1u);
 let z=dfshVolumeToWorld(object,2u);
 let lengths=vec3f(length(vec3f(x.x,y.x,z.x)),length(vec3f(x.y,y.y,z.y)),length(vec3f(x.z,y.z,z.z)));
 let local=dfshCorner(cubeCorners[vertex])*(loadDfObjectData(object).extent+dfsh.expand.x/lengths);
 return DfshScatter(vec4f(dfshShadowSpace(dfshObjectPoint(object,local)).xy,0.5,1.0),object);
}
struct DfshBox{lo:vec3f,hi:vec3f,x:vec3f,y:vec3f,z:vec3f}
fn dfshViewBox(object:u32)->DfshBox{
 let extent=loadDfObjectData(object).extent;
 var lo=vec3f(2000000.0);
 var hi=vec3f(-2000000.0);
 var corners:array<vec3f,8>;
 for(var i=0u;i<8u;i++){
  corners[i]=dfshShadowSpace(dfshObjectPoint(object,dfshCorner(i)*extent));
  lo=min(lo,corners[i]);
  hi=max(hi,corners[i]);
 }
 let x=0.5*(corners[1]-corners[0]);
 let y=0.5*(corners[2]-corners[0]);
 let z=0.5*(corners[4]-corners[0]);
 let grow=vec3f(dfsh.expand.y,dfsh.expand.y,0.0);
 return DfshBox(lo-grow,hi+grow,x/max(dot(x,x),0.0001),y/max(dot(y,y),0.0001),z/max(dot(z,z),0.0001));
}
fn dfshTileHit(tile:vec2u,object:u32)->bool{
 let side=f32(dfsh.tiles.x);
 let up=vec2f(f32(tile.x),side-1.0-f32(tile.y));
 let low=vec3f(up/side*2.0-1.0,0.0);
 let high=vec3f((up+1.0)/side*2.0-1.0,1000.0);
 let box=dfshViewBox(object);
 if(!(all(box.hi>low)&&all(box.lo.xy<high.xy))){return false;}
 let centre=0.5*(box.lo+box.hi);
 var least=vec3f(500000.0);
 var most=vec3f(-500000.0);
 for(var i=0u;i<8u;i++){
  let corner=vec3f(select(low.x,high.x,(i&1u)!=0u),select(low.y,high.y,(i&2u)!=0u),select(low.z,high.z,(i&4u)!=0u));
  let d=corner-centre;
  let along=vec3f(dot(d,box.x),dot(d,box.y),dot(d,box.z));
  least=min(least,along);
  most=max(most,along);
 }
 return all(least<vec3f(1.0))&&all(most>vec3f(-1.0));
}
@fragment
fn dfshScatterCount(v:DfshScatter)->@location(0) vec4f{
 let tile=vec2u(v.position.xy);
 if(dfshTileHit(tile,v.object)){atomicAdd(&tileCounts[tile.y*dfsh.tiles.x+tile.x],1u);}
 return vec4f(0.0);
}
@fragment
fn dfshScatterWrite(v:DfshScatter)->@location(0) vec4f{
 let tile=vec2u(v.position.xy);
 if(dfshTileHit(tile,v.object)){
  let at=tile.y*dfsh.tiles.x+tile.x;
  let start=dfshTileStart(at,tileOffsets[at]);
  let place=atomicAdd(&tileCounts[at],1u);
  if(place<dfshTileRoom(start)){tileData[start+place]=v.object;}
 }
 return vec4f(0.0);
}`,
  [DFSH_COMMON_WGSL, meshFieldWgsl(0, B.objects), DFSH_OBJECT_POINT_WGSL],
)
