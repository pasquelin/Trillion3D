import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { VG_TYPES_WGSL } from './gridTypesWgsl.ts'

/** The bytes of one volume's parameters (`VgSizeParams`); a dispatch binds its own slot at a dynamic offset of 256. */
export const VG_SIZE_PARAMS_BYTES = 208

/**
 * THE VOXEL SIZE OF EACH TOP-LEVEL CELL a volume touches: one dispatch a volume, each cell its bounds meet takes the voxel the shading
 * rate projects at the cell's distance (in the view's frustum, else out of it), bandlimited by the smallest voxel, the smaller of it
 * and what an earlier volume left. The size is held in the cell as a float until the bottom level is allocated.
 *
 * Bindings: 0 the parameters (uniform, dynamic offset), 1 the top-level cells (storage).
 */
export const VG_TOP_LEVEL_VOXEL_SIZE_WGSL = wgslProgram(
  `struct VgSizeParams{
 resolution:vec3i,
 useProjected:i32,
 boundsMin:vec3f,
 shadingRateIn:f32,
 boundsMax:vec3f,
 shadingRateOut:f32,
 primitiveMin:vec3f,
 minSizeIn:f32,
 primitiveMax:vec3f,
 minSizeOut:f32,
 cameraOrigin:vec3f,
 downsample:f32,
 // x the tangent of half the field of view across, y the view's width in pixels, z one for an orthographic view.
 view:vec4f,
 forward:vec4f,
 // The near plane and the four sides, outward.
 planes:array<vec4f,5>,
}
@group(0) @binding(0) var<uniform> params:VgSizeParams;
@group(0) @binding(1) var<storage,read_write> topLevel:array<u32>;

fn vgBoundsOfCell(cell:vec3f)->array<vec3f,2>{
 let extent=params.boundsMax-params.boundsMin;
 let res=vec3f(params.resolution);
 return array<vec3f,2>(params.boundsMin+extent*(cell/res),params.boundsMin+extent*((cell+vec3f(1.0))/res));
}
fn vgPrimitiveMeetsCell(cellMin:vec3f,cellMax:vec3f)->bool{
 return !(any(params.primitiveMin>cellMax)||any(cellMin>params.primitiveMax));
}
fn vgBoxMeetsFrustum(origin:vec3f,extent:vec3f)->bool{
 for(var i=0;i<5;i++){
  let plane=params.planes[i];
  if(dot(origin,plane.xyz)+plane.w>dot(extent,abs(plane.xyz))){return false;}
 }
 return true;
}
fn vgDistanceToCamera(v:vec3f)->f32{
 let d=length(v);
 if(params.view.z>0.5){return d*d/dot(v,params.forward.xyz);}
 return d;
}

@compute @workgroup_size(4,4,4)
fn topLevelGridCalculateVoxelSize(@builtin(global_invocation_id) id:vec3u){
 if(any(vec3i(id)>=params.resolution)){return;}
 let bounds=vgBoundsOfCell(vec3f(id));
 let centre=(bounds[0]+bounds[1])*0.5;
 let extent=(bounds[1]-bounds[0])*0.5;
 if(!vgPrimitiveMeetsCell(bounds[0],bounds[1])){return;}
 var voxelSize=params.minSizeOut;
 var shadingRate=params.shadingRateOut;
 if(vgBoxMeetsFrustum(centre,extent)){
  voxelSize=params.minSizeIn;
  shadingRate=params.shadingRateIn;
 }
 if(params.useProjected!=0){
  let halfWidth=params.view.y*0.5/params.downsample;
  let pixelWidth=params.view.x/halfWidth;
  let away=max(vgDistanceToCamera(centre-params.cameraOrigin)-length(extent),0.0);
  voxelSize=max(away*pixelWidth*shadingRate,voxelSize);
 }
 // The size is kept as the cell's word until the bottom level is allocated; an earlier volume's keeps the smaller.
 let index=vgLinearIndex(id,params.resolution);
 if(vgIsAllocated(topLevel[index])){voxelSize=min(voxelSize,vgVoxelSize(topLevel[index]));}
 topLevel[index]=bitcast<u32>(voxelSize);
}`,
  [VG_TYPES_WGSL],
)
