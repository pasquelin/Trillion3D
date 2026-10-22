import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { DFAO_COMMON_WGSL } from './commonWgsl.ts'
import { CONE_TRACE_DOWNSAMPLE, TILE_SIZE } from './cones.ts'
import { DFAO_GRID_WGSL, DFAO_VISIBILITY_WRITE_WGSL } from './gridWgsl.ts'
import { DFAO_BINDING as B } from './layout.ts'
import { meshFieldWgsl } from '../meshFieldWgsl.ts'

/** The threads of a group of the cone trace against the meshes. */
export const CONE_OBJECTS_GROUP = 64
/** The side of a culled tile in cells of the cone grid, and the tiles a group of threads traces. */
export const CONE_TILE_SIDE = TILE_SIZE / CONE_TRACE_DOWNSAMPLE
export const CONE_TILES_PER_GROUP = CONE_OBJECTS_GROUP / (CONE_TILE_SIDE * CONE_TILE_SIDE)
/** The words of a culled tile's record: the tile, then the mesh. */
export const CULLED_TILE_DATA_STRIDE = 2

/** The options of the cone trace against one mesh. */
export interface ConeObjectsShape {
  /** The global field traces the rest of the cone (`GlobalMaxOcclusionDistance` above zero and a field to read). */
  global: boolean
  /** A cone climbs to the coarser mips of the field away from the surface. */
  traverseMips: boolean
}

/**
 * ONE MESH'S FIELD TRACED BY A CELL'S CONES (`dfaoTraceObject`): skipped when its bounding sphere subtends less
 * than a quarter of the cell's view of it (the sphere's radius over its distance) or lies further than the
 * occlusion distance; each cone is stepped through the mesh's field in the volume's space, the steps
 * clamped to the volume's box (the distance to the box added to the sample's: a position past the box sees the
 * field's edge), the cone's visibility at a step the least of
 *  - the share of the cone's radius the distance to the surface covers;
 *  - one minus the share the mesh's own radius (half the volume's diagonal, in the world) covers of that radius,
 *    so that a small mesh never occludes a step wholly;
 *  - one minus the offset over the self-shadow distance, so that a mesh does not shadow itself within it;
 *  - the fade that rises with the offset over the occlusion distance;
 * and the next step the distance to the surface, or a share of the spacing of the steps at least (0.6, and 2
 * where the global field traces the rest; with it the cone starts 2 cm out). Climbing the mips: where the
 * distance passes the band of the mip, the next step reads the coarser; where it is within a quarter of it, the
 * distance is drawn back six times the volume's surface bias and the next step reads the finer. The mip a cone ends
 * on is the next cone's first, as the reference's loops carry it.
 */
const TRACE_OBJECT = (shape: ConeObjectsShape) => `
fn dfaoTraceObject(object:u32,cell:u32,position:vec3f,normal:vec3f,axes:DfaoAxes){
 let reach=${shape.global ? 'dfao.global.x' : 'dfao.distances.x'};
 let farthest=dfaoStepOffset(f32(CONE_STEPS));
 let bounds=loadDfObjectBounds(object);
 let toObject=bounds.center.hi+bounds.center.lo-position;
 if(bounds.sphereRadius*bounds.sphereRadius/dot(toObject,toObject)<=0.0625){return;}
 let data=loadDfObjectData(object);
 let volumePosition=dfWorldToVolume(data,DfVec3(position,vec3f(0.0)));
 if(dfaoBoxDistance(-data.extent,data.extent,volumePosition)*data.volumeScale>=dfao.distances.x){return;}
 let ownRadius=length(data.extent)*0.5*data.volumeScale;
 let selfShadow=1.0/max(data.selfShadowBias,0.0001);
 let lastMip=dfAssetMip(data.asset,0u).numMips-1u;
 var mip=${shape.traverseMips ? 'lastMip' : 'min(1u,lastMip)'};
 var asset=dfAssetMip(data.asset,mip);
 for(var cone=0u;cone<CONE_DIRECTIONS;cone++){
  let world=dfaoConeDirection(cone,normal,axes);
  let direction=vec3f(dot(data.rows[0].xyz,world),dot(data.rows[1].xyz,world),dot(data.rows[2].xyz,world));
  var least=1.0;
  var offset=dfaoStepOffset(0.0)${shape.global ? '+2.0' : ''};
  var spacing=offset;
  for(var stepIndex=0u;stepIndex<CONE_STEPS&&offset<farthest;stepIndex++){
   let at=volumePosition+direction*offset;
   let clamped=clamp(at,-data.extent,data.extent);
   var distance=sampleSparseMeshSdf(clamped,asset);
${
  shape.traverseMips
    ? `   let band=asset.scaleBias.x+asset.scaleBias.y;
   if(abs(distance)>band&&mip>0u){
    mip--;
    asset=dfAssetMip(data.asset,mip);
   }else if(abs(distance)<0.25*band&&mip<lastMip){
    distance-=6.0*data.surfaceBias;
    mip++;
    asset=dfAssetMip(data.asset,mip);
   }
`
    : ''
}   let toOccluder=(distance+length(at-clamped))*data.volumeScale;
   let invRadius=1.0/(offset*dfao.global.y);
   var visibility=saturate(toOccluder*invRadius);
   let smallObject=1.0-saturate(ownRadius*invRadius);
   let ownShadow=1.0-saturate(offset*selfShadow);
   let fraction=(offset+toOccluder)/reach;
   visibility=max(visibility,max(smallObject,max(ownShadow,saturate(fraction*fraction*0.6))));
   least=min(visibility,least);
   let next=dfaoStepOffset(f32(stepIndex+1u));
   let minimum=${shape.global ? '2.0' : '0.6'}*(next-spacing);
   spacing=next;
   offset+=max(toOccluder,minimum);
  }
  dfaoKeepVisibility(cone,cell,least);
 }
}`

/**
 * THE CONES AGAINST THE MESHES' FIELDS (`dfaoConeObjects`), a group of threads over `CONE_TILES_PER_GROUP` tiles
 * of the screen that one mesh reaches (`cull*Wgsl.ts`): a thread a cone-grid cell of the tile, which traces that
 * one mesh (`dfaoTraceObject`) and folds its cones into the cell's visibilities by minimum, beside the global
 * field's. A tile slot holding no tile (`DFAO_NO_TILE`, the padding that rounds a mesh's tiles to a group) or a cell
 * past the cone grid does nothing. The mesh is the one the group's first tile names.
 */
export const dfaoConeObjectsShader = (shape: ConeObjectsShape) =>
  wgslProgram(
    `${TRACE_OBJECT(shape)}
@group(0) @binding(${B.tileData}) var<storage,read> culledTileData:array<u32>;
@compute @workgroup_size(${CONE_OBJECTS_GROUP})
fn dfaoConeObjects(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let cellInTile=lane%(${CONE_TILE_SIDE * CONE_TILE_SIDE}u);
 let first=group.x*${CONE_TILES_PER_GROUP}u;
 let slot=first+lane/${CONE_TILE_SIDE * CONE_TILE_SIDE}u;
 let tile=culledTileData[slot*${CULLED_TILE_DATA_STRIDE}u];
 let object=culledTileData[first*${CULLED_TILE_DATA_STRIDE}u+1u];
 let tileCoord=vec2u(tile%dfao.cones.z,tile/dfao.cones.z);
 let coord=tileCoord*${CONE_TILE_SIDE}u+vec2u(cellInTile%${CONE_TILE_SIDE}u,cellInTile/${CONE_TILE_SIDE}u);
 if(tile==DFAO_NO_TILE||any(coord>=dfao.cones.xy)){return;}
 let surface=dfaoGrid(dfaoCellTexel(coord));
 if(dot(surface.xyz,surface.xyz)<0.5){return;}
 let position=dfaoWorldAt(dfaoCellNdc(coord),surface.w);
 dfaoTraceObject(object,coord.y*dfao.cones.x+coord.x,position,surface.xyz,dfaoAxes(surface.xyz));
}`,
    [DFAO_COMMON_WGSL, DFAO_GRID_WGSL, DFAO_VISIBILITY_WRITE_WGSL, meshFieldWgsl(0, B.objects)],
  )
