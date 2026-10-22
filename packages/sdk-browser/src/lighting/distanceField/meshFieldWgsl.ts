import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { DOUBLE_FLOAT_WGSL } from './doubleFloatWgsl.ts'
import {
  ASSET_MIPS_SHIFT,
  ASSET_MIP_STRIDE,
  ASSET_STRIDE,
  INDIRECTION_SIDE_BITS,
  INVALID_BRICK_INDEX,
  OBJECT_BOUNDS_STRIDE,
  OBJECT_DATA_STRIDE,
  SCENE_BLOCK,
} from './layout.ts'

/**
 * THE DISTANCE TO A MESH'S SURFACE, read from the scene's records and the brick atlas, for the
 * passes of the global distance field and of the streaming (`globalDistanceField.ts`,
 * `streamingWgsl.ts`).
 *
 * A placement's data holds the transform from the world to its mesh's volume — the box of the mesh
 * scaled to half-extents of at most 1 about its centre — as three rows applied to a position
 * relative to the high part of the placement's centre, the volume's extent, the scale back to the
 * world on each axis and the mesh's asset. `distanceToNearestSurfaceForObject` carries a world
 * position into that volume, takes the distance to the box where the position lies outside it,
 * and, within `maxDistance`, the distance to the surface itself: the coarsest mip first, a finer
 * one while the position is within a quarter of the band of the one before; the stored byte is
 * mapped to a volume distance by the mip's scale and bias, then to the world by the smallest axis
 * scale. A negative distance inside the volume never reaches out of its box.
 */
export const MESH_FIELD_FUNCTIONS_WGSL = wgslBlock(
  'MESH_FIELD_FUNCTIONS_WGSL',
  [DOUBLE_FLOAT_WGSL],
  `
struct DfAssetData{numMips:u32,dims:vec3u,tableOffset:u32,scaleBias:vec2f,toIndirectionScale:vec3f,toIndirectionAdd:vec3f}
fn loadDfAssetData(offset:u32)->DfAssetData{
 let v0=sceneAssetData[offset];
 let v1=bitcast<vec4f>(sceneAssetData[offset+1u]);
 let v2=bitcast<vec4f>(sceneAssetData[offset+2u]);
 let side=(1u<<${INDIRECTION_SIDE_BITS}u)-1u;
 return DfAssetData(v0.x>>${ASSET_MIPS_SHIFT}u,vec3u(v0.x&side,(v0.x>>${INDIRECTION_SIDE_BITS}u)&side,(v0.x>>${2 * INDIRECTION_SIDE_BITS}u)&side),v0.y,vec2f(v1.w,v2.w),v1.xyz,v2.xyz);
}
fn dfAssetMip(asset:u32,reversedMip:u32)->DfAssetData{return loadDfAssetData(asset*${ASSET_STRIDE}u+reversedMip*${ASSET_MIP_STRIDE}u);}
struct DfObjectBounds{center:DfVec3,sphereRadius:f32,boxExtent:vec3f,flags:u32}
fn loadDfObjectBounds(index:u32)->DfObjectBounds{
 let at=index*${OBJECT_BOUNDS_STRIDE}u;
 let v0=bitcast<vec4f>(sceneObjectBounds[at]);
 let v1=bitcast<vec4f>(sceneObjectBounds[at+1u]);
 let v2=sceneObjectBounds[at+2u];
 return DfObjectBounds(DfVec3(v0.xyz,v1.xyz),v1.w,bitcast<vec3f>(v2.xyz),v2.w);
}
struct DfObjectData{positionHigh:vec3f,rows:array<vec4f,3>,extent:vec3f,surfaceBias:f32,mostlyTwoSided:bool,volumeScale:f32,drawDistance2:vec2f,selfShadowBias:f32,instance:u32,toWorldScale:vec3f,asset:u32}
fn loadDfObjectData(index:u32)->DfObjectData{
 let at=index*${OBJECT_DATA_STRIDE}u;
 let v4=bitcast<vec4f>(sceneObjectData[at+4u]);
 let v5=bitcast<vec4f>(sceneObjectData[at+5u]);
 let v9=bitcast<vec4f>(sceneObjectData[at+9u]);
 let scale=v9.xyz;
 return DfObjectData(bitcast<vec3f>(sceneObjectData[at].xyz),array<vec4f,3>(bitcast<vec4f>(sceneObjectData[at+1u]),bitcast<vec4f>(sceneObjectData[at+2u]),bitcast<vec4f>(sceneObjectData[at+3u])),v4.xyz,abs(v4.w),v4.w<0.0,min(scale.x,min(scale.y,scale.z)),v5.xy,v5.z,sceneObjectData[at+5u].w,scale,sceneObjectData[at+9u].w);
}
fn dfWorldToVolume(o:DfObjectData,world:DfVec3)->vec3f{
 let p=vec4f(dfAddFloatDemote(world,-o.positionHigh),1.0);
 return vec3f(dot(o.rows[0],p),dot(o.rows[1],p),dot(o.rows[2],p));
}
fn sampleSparseMeshSdf(p:vec3f,a:DfAssetData)->f32{
 let at=p*a.toIndirectionScale+a.toIndirectionAdd;
 let cell=vec3u(vec3i(at));
 let brick=indirectionTable[a.tableOffset+(cell.z*a.dims.y+cell.y)*a.dims.x+cell.x];
 var distance=a.scaleBias.x+a.scaleBias.y;
 if(brick!=${INVALID_BRICK_INDEX}u){
  let offset=vec3f(vec3u(brick&dfScene.atlasMask.x,(brick>>dfScene.atlasLog2.x)&dfScene.atlasMask.y,brick>>(dfScene.atlasLog2.x+dfScene.atlasLog2.y)));
  let uv=offset*dfScene.offsetToUv+(at-vec3f(vec3i(at)))*dfScene.uniqueInTexels+dfScene.halfTexel;
  distance=textureSampleLevel(brickTexture,brickSampler,uv,0.0).x*a.scaleBias.x+a.scaleBias.y;
 }
 return distance;
}
fn distanceToMeshSurfaceStandalone(p:vec3f,o:DfObjectData)->f32{
 let mips=dfAssetMip(o.asset,0u).numMips;
 var distance=0.0;
 for(var mip=0u;mip<mips;mip++){
  let a=dfAssetMip(o.asset,mip);
  distance=sampleSparseMeshSdf(p,a);
  if(abs(distance)>0.25*(a.scaleBias.x+a.scaleBias.y)){break;}
 }
 return distance;
}
fn distanceToNearestSurfaceForObject(o:DfObjectData,world:DfVec3,maxDistance:f32)->f32{
 let volume=dfWorldToVolume(o,world);
 let clamped=clamp(volume,-o.extent,o.extent);
 let toBox=(abs(volume)-o.extent)*o.toWorldScale;
 let toBoxDistance=length(max(vec3f(0.0),toBox))+min(0.0,max(toBox.x,max(toBox.y,toBox.z)));
 var distance=maxDistance;
 if(toBoxDistance<maxDistance){
  distance=distanceToMeshSurfaceStandalone(clamped,o)*o.volumeScale+max(0.0,toBoxDistance);
  distance=max(distance,toBoxDistance);
 }
 return distance;
}`,
)

/** The structure of the scene's block, once. */
export const MESH_FIELD_SCENE_STRUCT_WGSL = wgslBlock(
  'MESH_FIELD_SCENE_STRUCT_WGSL',
  [],
  `\n${SCENE_BLOCK.wgsl}`,
)

/**
 * The scene's bindings from `first` in group `group`: its block, the bounds and the data of its
 * objects, the data of its meshes, the indirection tables, the brick atlas and the sampler it is
 * read through — bilinear, repeating —, then the functions above.
 */
export function meshFieldWgsl(group: number, first = 0) {
  const at = (k: number) => `@group(${group}) @binding(${first + k})`
  return wgslBlock(
    `MESH_FIELD_WGSL ${group} ${first}`,
    [MESH_FIELD_SCENE_STRUCT_WGSL, MESH_FIELD_FUNCTIONS_WGSL],
    `
${at(0)} var<uniform> dfScene:DfScene;
${at(1)} var<storage,read> sceneObjectBounds:array<vec4u>;
${at(2)} var<storage,read> sceneObjectData:array<vec4u>;
${at(3)} var<storage,read> sceneAssetData:array<vec4u>;
${at(4)} var<storage,read> indirectionTable:array<u32>;
${at(5)} var brickTexture:texture_3d<f32>;
${at(6)} var brickSampler:sampler;`,
  )
}

/** The bindings `meshFieldWgsl` takes. */
export const MESH_FIELD_BINDINGS = 7
