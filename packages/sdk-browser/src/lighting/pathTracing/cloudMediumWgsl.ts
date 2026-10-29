import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  CLOUD_MATERIAL_WGSL,
  cloudMaterialBindings,
} from '../../modules/sky/clouds/materialWgsl.ts'

/** The bindings the traced clouds take in the first group of the trace and finish programs: the cloud material (its block, its four textures and its sampler, seven bindings from `material`), the clouds' block and the acceleration map. */
export const PT_CLOUD_BINDINGS = { material: 16, params: 23, map: 24 } as const

/** The bits of the clouds' flags (`PtCloud.options.y`): the clouds are marched, the acceleration map is drawn in their place, the material's approximation of multiple scattering is used. */
export const PT_CLOUD_FLAG = { on: 1, visualize: 2, approximate: 4 } as const

/** The format of the acceleration map: the densest extinction of the column, the least, and the lowest and highest heights (kilometres from the eye's plane) a cloud was found at. */
export const PT_CLOUD_MAP_FORMAT = 'rgba32float' as const

/**
 * What the traced clouds read of the layer, in vec4 words (the structure `PtCloud`): the three axes of the clip frame (the right, the forward and the up at the eye, the eye in the scene's metres in their fourth lanes), the planet's centre in the
 * scene's metres with the time in seconds, the layer (its bottom and top radius and the half side of the clip box in kilometres, the eye's distance from the planet's centre in kilometres), the march (the longest stretch in metres, the width of a
 * texel of the map in metres and its inverse, the roughness cutoff), and the options (the side of the map, the flags `PT_CLOUD_FLAG`, the samples each texel gathers in an image, the sample the run is at).
 */
export const PT_CLOUD_STRUCT =
  'struct PtCloud{clipX:vec4f,clipY:vec4f,clipZ:vec4f,centre:vec4f,layer:vec4f,march:vec4f,options:vec4u,}'
export const PT_CLOUD_BYTES = 7 * 16

/** The declarations of the clouds' bindings in the first group of a program, the map read by loads. */
export const ptCloudDeclarations = (group = 0) => `${PT_CLOUD_STRUCT}
${cloudMaterialBindings(group, PT_CLOUD_BINDINGS.material)}
@group(${group}) @binding(${PT_CLOUD_BINDINGS.params}) var<uniform> ptCloud:PtCloud;
@group(${group}) @binding(${PT_CLOUD_BINDINGS.map}) var ptCloudMap:texture_2d<f32>;`

/**
 * THE CLOUD MATERIAL AT A POINT OF A PATH (`ptCloudSampleAt(rel, hKm)`: `rel` the point in metres from the eye, `hKm` its distance from the planet's centre), the material read as the raster's march reads it
 * (`cloudSiteAt`, `cloudMaterialAt`, the scene's height the material's third axis) with no screen footprint, so that its textures are read at their first level: where the conservative density is not above 0 the
 * point is empty, else the extinction, the albedo and the emission per metre. The point's altitude in the layer is its distance from the centre between the layer's bottom and top.
 * `ptCloudDensityAt` is what the paths read: the material, or, with the acceleration map drawn in the clouds' place, the map's column there: its densest extinction between the heights found, an albedo of 0.85.
 * `ptCloudClip(v)` takes a vector to the clip frame; `ptCloudPhaseData()` is the dual lobe's anisotropies and blend (the map's view has an isotropic lobe).
 */
export const PT_CLOUD_POINT_WGSL = wgslBlock(
  'PT_CLOUD_POINT_WGSL',
  [CLOUD_MATERIAL_WGSL],
  `const PT_CLOUD_VISUALIZE_ALBEDO:f32=0.85;
fn ptCloudClip(v:vec3f)->vec3f{return vec3f(dot(ptCloud.clipX.xyz,v),dot(ptCloud.clipY.xyz,v),dot(ptCloud.clipZ.xyz,v));}
fn ptCloudEye()->vec3f{return vec3f(ptCloud.clipX.w,ptCloud.clipY.w,ptCloud.clipZ.w);}
fn ptCloudVisualizing()->bool{return (ptCloud.options.y&${PT_CLOUD_FLAG.visualize}u)!=0u;}
fn ptCloudPhaseData()->vec3f{
 if(ptCloudVisualizing()){return vec3f(0.0);}
 return vec3f(cloudMaterial.phase.x,cloudMaterial.phase.y,cloudMaterial.phase.z);
}
struct PtCloudSample{extinction:vec3f,albedo:vec3f,emission:vec3f,}
fn ptCloudMapColumn(rel:vec3f)->vec4f{
 let side=i32(ptCloud.options.x);
 let p=ptCloudClip(rel).xy;
 let uv=(p+ptCloud.layer.z*1000.0)/(2.0*ptCloud.layer.z*1000.0);
 return textureLoad(ptCloudMap,clamp(vec2i(floor(uv*f32(side))),vec2i(0),vec2i(side-1)),0);
}
fn ptCloudSampleAt(rel:vec3f,hKm:f32)->PtCloudSample{
 var s:PtCloudSample;
 let at=(rel+ptCloudEye())*CLOUD_M_TO_CM;
 let site=cloudSiteAt(vec3f(at.x,at.z,at.y));
 if(!(cloudConservativeDensity(site)>0.0)){return s;}
 let norm=saturate((hKm-ptCloud.layer.x)/(ptCloud.layer.y-ptCloud.layer.x));
 let m=cloudMaterialAt(norm,rel*CLOUD_M_TO_CM,ptCloud.centre.w,site);
 s.extinction=m.extinction;
 s.albedo=m.albedo;
 s.emission=m.emissive;
 return s;
}
fn ptCloudDensityAt(rel:vec3f,hKm:f32)->PtCloudSample{
 if(!ptCloudVisualizing()){return ptCloudSampleAt(rel,hKm);}
 var s:PtCloudSample;
 let data=ptCloudMapColumn(rel);
 let z=ptCloudClip(rel).z*0.001;
 s.extinction=vec3f(select(0.0,data.x,z>data.z&&z<data.w));
 s.albedo=vec3f(PT_CLOUD_VISUALIZE_ALBEDO);
 return s;
}`,
)
