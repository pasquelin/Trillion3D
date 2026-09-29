import { FLAG_HAS_MAP, FLAG_HAS_UV, FLAG_SAMPLED } from '../../visibility/types.ts';

/** KHR_materials_volume's raster approximation applies the declared mesh-space path at
 * the entrance, once per closed volume. The exit is not a second sheet of absorption.
 * https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_volume
 * Thin materials keep both independent sheets. A mirrored world reverses raster winding.
 * This uses the declared thickness, not a second geometry/intersection representation. */
export const BLEND_TRANSMITTANCE_WGSL = `
fn volumeBoundary(page:PageInfo,front:bool)->bool{
 let mirrored=dot(page.world[0].xyz,cross(page.world[1].xyz,page.world[2].xyz))<0.0;
 return page.transmission<=0.0||page.thickness<=0.0||(front!=mirrored);
}
/** Convert the declared local ray length to world units, including nonuniform scale/shear.
 * The adjugate avoids an inverse matrix and defines a collapsed transform's path as zero. */
fn volumeWorldThickness(page:PageInfo,ray:vec3f)->f32{
 let a=page.world[0].xyz;let b=page.world[1].xyz;let c=page.world[2].xyz;
 let determinant=dot(a,cross(b,c));
 let local=vec3f(dot(cross(b,c),ray),dot(cross(c,a),ray),dot(cross(a,b),ray));
 let size=length(local);
 if(size==0.0){return 0.0;}
 return max(page.thickness,0.0)*abs(determinant)*length(ray)/size;
}
fn blendTransmittance(page:PageInfo,uv:vec2f,ddx:vec2f,ddy:vec2f,ray:vec3f)->vec4f{
 var coverage=page.blendCoverage;
 let mapped=(page.flags&${FLAG_HAS_UV | FLAG_HAS_MAP}u)==${FLAG_HAS_UV | FLAG_HAS_MAP}u;
 let sampled=(page.flags&${FLAG_SAMPLED}u)!=0u;
 if(mapped){coverage*=maskAlpha(page.mapIndex,uv,ddx,ddy,sampled);}
 if(page.transmission<=0.0){return vec4f(1.0-coverage);}
 var tint=page.baseColor.rgb;
 if(mapped){tint*=colorSample(page.mapIndex,uv,ddx,ddy,sampled).rgb;}
 if(page.attenuationDistance>0.0){
  let path=volumeWorldThickness(page,ray);
  if(path>0.0){tint*=pow(clamp(vec3f(page.attenuationRG,page.attenuationB),vec3f(0.0),vec3f(1.0)),vec3f(path/page.attenuationDistance));}
 }
 return vec4f(mix(vec3f(1.0),tint*clamp(page.transmission,0.0,1.0),coverage),1.0-coverage);
}`;
