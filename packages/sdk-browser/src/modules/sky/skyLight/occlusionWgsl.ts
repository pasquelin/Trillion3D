import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { PI } from '../../../../../math/src/wgsl/constants.ts'
import { skyLightReadWgsl, type SkyLightBindings } from './read.ts'

/**
 * THE DISTANCE-FIELD OCCLUSION APPLIED TO THE SKY LIGHT, over the light's read (`skyLightReadWgsl`) and the bent normal a
 * pixel reads (`dfaoBentNormal`, `lighting/distanceField/ao/readWgsl.ts`, listed by the program beside this block). What
 * the occlusion applies is the uniform's (`writeSkyLightRead`): the tint and the least occlusion, the contrast curve and the
 * exponent, how the occlusions combine (`mode.x`, 0 the least of them, 1 their product), whether a bent normal is applied
 * (`mode.y`), the reciprocal of the specular strength (`mode.z`) and the specular mode (`mode.w`).
 *
 * - `skyLightVisibility(normal, others, bent)`: the diffuse light's visibility. With a bent normal applied its length is
 *   the share of the sky the surface sees and its direction the way the sky is most open: the diffuse light is read
 *   along the normal turned toward it by the visibility's loss (`mix(bentDirection, normal, visibility)`), scaled by
 *   `mix(dot(bentDirection, normal), 1, visibility)`; the visibility goes through the contrast curve (a logistic of
 *   `contrast · (10 · visibility - 5)`, brought back to 0 .. 1), is raised to the exponent and lifted toward 1 by
 *   the least occlusion. It is then combined with `others`, the occlusion of the material and of the screen together,
 *   by the least of the two or their product. The result keeps the scale to the light read, the occlusion's tint times
 *   what the visibility lost (`(1 - visibility) · tint`) to add, and the normal to read it along;
 * - `skyLightDiffuseOccluded(visibility)`: `scale · diffuse light(normal) + add`, what the surface's diffuse colour
 *   multiplies;
 * - `skyLightBackOccluded(visibility, normal)`: a two-sided surface's back, `scale · diffuse light(-normal)` with the SAME scale as the
 *   front's (the distance-field occlusion included) and no `add`: the tint belongs to the front's diffuse colour alone;
 * - `skyLightSpecularOcclusion(bent, reflection, roughness, twoSided)`: the specular occlusion, with a bent normal
 *   applied: the length of the bent normal in mode 0, else the intersection of the reflection cone (half angle
 *   `max(roughness, 0.1) · π`) with the unoccluded one (`length · π` over the strength), smoothed, and shadowed outright
 *   as the unoccluded angle falls under 0.1 .. 0.3; lifted toward 1 by the least occlusion, with the tint times what it
 *   lost as light to add. A two-sided surface takes the length in either mode. One and nothing without a bent normal.
 *   The cosine is held to -1 .. 1: a product rounded past one would make the angle undefined.
 */
const DIFFUSE_OCCLUSION = wgslBlock(
  'SKY_LIGHT_DIFFUSE_OCCLUSION_WGSL',
  [],
  `struct SkyVisibility{scale:f32,add:vec3f,normal:vec3f,}
fn skyLightVisibility(normal:vec3f,others:f32,bent:vec3f)->SkyVisibility{
 var visibility=1.0;
 var factor=1.0;
 var along=normal;
 if(skyLight.mode.y>0.0){
  visibility=length(bent);
  let direction=bent/max(visibility,0.00001);
  along=mix(direction,normal,visibility);
  factor=mix(dot(direction,normal),1.0,visibility);
  let curve=1.0/(1.0+exp(-skyLight.contrast.x*(visibility*10.0-5.0)));
  visibility=saturate(curve*skyLight.contrast.y+skyLight.contrast.z);
  visibility=pow(visibility,skyLight.contrast.w);
  visibility=mix(visibility,1.0,skyLight.tint.w);
 }
 visibility=select(visibility*others,min(visibility,others),skyLight.mode.x==0.0);
 return SkyVisibility(visibility*factor,(1.0-visibility)*skyLight.tint.xyz,along);
}
fn skyLightDiffuseOccluded(v:SkyVisibility)->vec3f{
 if(!skyLightApplied()){return vec3f(0.0);}
 return v.scale*skyLightDiffuse(v.normal)+v.add;
}
fn skyLightBackOccluded(v:SkyVisibility,normal:vec3f)->vec3f{
 if(!skyLightApplied()){return vec3f(0.0);}
 return v.scale*skyLightDiffuse(-normal);
}`,
)

/** The specular half of the block: what only a program that applies the occlusion to the sky's reflection holds. */
const SPECULAR_OCCLUSION = wgslBlock(
  'SKY_LIGHT_SPECULAR_OCCLUSION_WGSL',
  [PI],
  `struct SkySpecularOcclusion{specular:f32,add:vec3f,}
fn skyConeIntersection(first:f32,second:f32,between:f32)->f32{
 let difference=abs(first-second);
 return smoothstep(0.0,1.0,1.0-saturate((between-difference)/(first+second-difference)));
}
fn skyLightSpecularOcclusion(bent:vec3f,reflection:vec3f,roughness:f32,twoSided:bool)->SkySpecularOcclusion{
 if(skyLight.mode.y<=0.0){return SkySpecularOcclusion(1.0,vec3f(0.0));}
 let extent=length(bent);
 var specular=extent;
 if(skyLight.mode.w!=0.0&&!twoSided){
  let reflected=max(roughness,0.1)*PI;
  let unoccluded=extent*PI*skyLight.mode.z;
  let between=acos(clamp(dot(bent,reflection)/max(extent,0.001),-1.0,1.0));
  specular=skyConeIntersection(reflected,unoccluded,between);
  specular=mix(0.0,specular,saturate((unoccluded-0.1)/0.2));
 }
 specular=mix(specular,1.0,skyLight.tint.w);
 return SkySpecularOcclusion(specular,(1.0-specular)*skyLight.tint.xyz);
}`,
)

/** The diffuse half over the light read of `bindings` (`skyLightApplied`, `skyLightDiffuse` and the uniform `skyLight` are its): the visibility and the diffuse light under it, the front's and the back's. A program that lights the diffuse alone lists this. */
export const skyLightDiffuseOcclusionWgsl = (bindings: SkyLightBindings) =>
  wgslBlock(
    `SKY_LIGHT_DIFFUSE_OCCLUSION_HOST_WGSL(${bindings.group}, ${bindings.params})`,
    [skyLightReadWgsl(bindings), DIFFUSE_OCCLUSION],
    '',
  )

/** The whole block over the light read of `bindings`: the diffuse half and the specular occlusion (`skyLightSpecularOcclusion`). */
export const skyLightOcclusionWgsl = (bindings: SkyLightBindings) =>
  wgslBlock(
    `SKY_LIGHT_OCCLUSION_HOST_WGSL(${bindings.group}, ${bindings.params})`,
    [skyLightDiffuseOcclusionWgsl(bindings), SPECULAR_OCCLUSION],
    '',
  )
