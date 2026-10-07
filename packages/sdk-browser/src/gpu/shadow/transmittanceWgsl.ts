import { FLAG_HAS_MAP, FLAG_HAS_UV, FLAG_SAMPLED } from '../../visibility/types.ts'
import { type WgslDecl, wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { cofactor3, matrixWindingCwTriple } from '../../../../math/src/wgsl/matrix.ts'
import { VOLUME_LAW_WGSL } from '../../webgpu/transparent/volumeLaw.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../../visibility/shader/pageWgsl.ts'

/** KHR_materials_volume's raster approximation applies the declared mesh-space path at
 * the entrance, once per closed volume. The exit is not a second sheet of absorption.
 * https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_volume
 * Thin materials keep both independent sheets. A mirrored world reverses raster winding.
 * This uses the declared thickness, not a second geometry/intersection representation.
 * A mapped page reads its cutout through `maskAlpha` and its tint through `colorSample`, the
 * host's material reads (`maskAlphaWgsl`, `colorSampleWgsl`, on the host's pool). */
export const blendTransmittanceWgsl = (maskAlpha: WgslDecl, colorSample: WgslDecl) =>
  wgslBlock(
    'blendTransmittanceWgsl',
    [
      PAGE_INFO_STRUCT_WGSL,
      matrixWindingCwTriple,
      cofactor3,
      VOLUME_LAW_WGSL,
      maskAlpha,
      colorSample,
    ],
    `fn volumeBoundary(page:PageInfo,front:bool)->bool{
 let mirrored=matrixWindingCwTriple(page.world);
 return page.transmission<=0.0||page.thickness<=0.0||(front!=mirrored);
}
/** Convert the declared local ray length to world units, including nonuniform scale/shear.
 * The adjugate avoids an inverse matrix and defines a collapsed transform's path as zero. */
fn volumeWorldThickness(page:PageInfo,ray:vec3f)->f32{
 let a=page.world[0].xyz;let b=page.world[1].xyz;let c=page.world[2].xyz;
 let C=cofactor3(a,b,c);
 let determinant=dot(a,C[0]);
 let local=vec3f(dot(C[0],ray),dot(C[1],ray),dot(C[2],ray));
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
  if(path>0.0){tint*=volumeTransmittanceOf(vec3f(page.attenuationRG,page.attenuationB),page.attenuationDistance,path);}
 }
 return vec4f(mix(vec3f(1.0),tint*clamp(page.transmission,0.0,1.0),coverage),1.0-coverage);
}`,
  )
