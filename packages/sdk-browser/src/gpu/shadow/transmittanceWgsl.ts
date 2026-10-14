import { FLAG_HAS_MAP, FLAG_HAS_UV, FLAG_SAMPLED } from '../../visibility/types.ts'
import { type WgslDecl, wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { matrixWindingCwTriple } from '../../../../math/src/wgsl/matrix.ts'
import { VOLUME_LAW_WGSL } from '../../webgpu/transparent/volumeLaw.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../../visibility/shader/pageWgsl.ts'
import { VIS_BINDINGS } from '../../webgpu/core/bindLayout.ts'
import { materialTableWgsl } from '../../webgpu/material/materialWgsl.ts'

/** KHR_materials_volume's raster approximation applies the declared mesh-space path at
 * the entrance, once per closed volume. The exit is not a second sheet of absorption.
 * https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_volume
 * Thin materials keep both independent sheets. A mirrored world reverses raster winding.
 * This uses the declared thickness, not a second geometry/intersection representation, in the
 * mesh's units, taken to the world by the one rule the water's path follows (`volumeWorldPath`).
 * A mapped page reads its cutout through `maskAlpha` and its tint through `colorSample`, the
 * host's material reads (`maskAlphaWgsl`, `colorSampleWgsl`, on the host's pool); its factors are
 * its surface's record's (`materialAt`), the host binding the material table at the visibility
 * raster's number, as the shadow raster's page group does. */
export const blendTransmittanceWgsl = (maskAlpha: WgslDecl, colorSample: WgslDecl) =>
  wgslBlock(
    'blendTransmittanceWgsl',
    [
      PAGE_INFO_STRUCT_WGSL,
      matrixWindingCwTriple,
      VOLUME_LAW_WGSL,
      materialTableWgsl(VIS_BINDINGS.material),
      maskAlpha,
      colorSample,
    ],
    `fn volumeBoundary(page:PageInfo,front:bool)->bool{
 let mirrored=matrixWindingCwTriple(page.world);
 let m=materialAt(page.material);
 return m.transmission<=0.0||m.thickness<=0.0||(front!=mirrored);
}
/** The light a page lets through along \`ray\`: its coverage, and through what it covers its tint
 *  times the volume law (\`volumeTransmittance\`) along its world path, at the constant \`k\` its
 *  record holds — zero on every channel of a surface that declares no volume, or absorbs none. */
fn blendTransmittance(page:PageInfo,uv:vec2f,ddx:vec2f,ddy:vec2f,ray:vec3f)->vec4f{
 let m=materialAt(page.material);
 var coverage=saturate(m.opacity);
 let mapped=(page.flags&${FLAG_HAS_UV | FLAG_HAS_MAP}u)==${FLAG_HAS_UV | FLAG_HAS_MAP}u;
 let sampled=(page.flags&${FLAG_SAMPLED}u)!=0u;
 if(mapped){coverage*=maskAlpha(m.mapIndex,uv,ddx,ddy,sampled);}
 if(m.transmission<=0.0){return vec4f(1.0-coverage);}
 var tint=m.baseColor;
 if(mapped){tint*=colorSample(m.mapIndex,uv,ddx,ddy,sampled).rgb;}
 if(any(m.attenuation!=vec3f(0.0))){
  let path=volumeWorldPath(page.world,m.thickness,ray);
  if(path>0.0){tint*=volumeTransmittance(m.attenuation,path);}
 }
 return vec4f(mix(vec3f(1.0),tint*clamp(m.transmission,0.0,1.0),coverage),1.0-coverage);
}`,
  )
