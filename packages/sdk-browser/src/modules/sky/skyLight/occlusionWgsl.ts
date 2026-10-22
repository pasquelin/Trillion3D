import { wgslBlock, type WgslDecl } from '../../../../../math/src/wgsl/decl.ts'
import { PI } from '../../../../../math/src/wgsl/constants.ts'
import { skyLightReadWgsl, type SkyLightBindings } from './read.ts'

/**
 * THE DISTANCE-FIELD OCCLUSION APPLIED TO THE SKY LIGHT, over the light's read (`skyLightReadWgsl`) and the bent normal a
 * pixel reads (`dfaoBentNormal`, `lighting/distanceField/ao/readWgsl.ts`, whose block `dfaoRead` the program lists too):
 *
 * - `skyLightVisibility(lookupNormal, normal, materialAo, screenAo, bent)`: the diffuse light's visibility. With a bent normal
 *   applied (`skyLight.mode.y`) its length is the share of the sky the surface sees and its direction the way the sky is most
 *   open: the diffuse light is read along the normal turned toward it by the visibility's loss (`mix(bentDirection,
 *   normal, visibility)`), scaled by `mix(dot(bentDirection, normal), 1, visibility)`; the visibility goes through the
 *   contrast curve (a logistic of `contrast · (10 · visibility - 5)`, brought back to 0 .. 1), is raised to the
 *   exponent and lifted toward 1 by the least occlusion. It is then combined with the material's occlusion and the
 *   screen's, by the least of the three or their product. The result keeps the scale to the light read, the occlusion's
 *   tint times what the visibility lost (`(1 - visibility) · tint`) to add, and the normal to read it along;
 * - `skyLightDiffuseOccluded(visibility, diffuseColour)`: `(scale · diffuse light(normal) + add) · diffuseColour`;
 * - `skyLightSpecularOcclusion(bent, reflection, roughness, twoSided)`: the specular occlusion, with a bent normal applied:
 *   the length of the bent normal in mode 0, else the intersection of the reflection cone (half angle `max(roughness, 0.1) ·
 *   π`) with the unoccluded one (`length · π` over the strength), smoothed, and shadowed outright as the unoccluded angle
 *   falls under 0.1 .. 0.3; lifted toward 1 by the least occlusion; with the tint times what it lost as light to add and the
 *   diffuse occlusion (the length lifted the same). A twosided foliage takes the length in either mode;
 * - `skyLightReflectionOccluded(reflection, roughness, occlusion)`: the specular light of the sky, scaled by the occlusion
 *   plus the tint's share.
 */
const OCCLUSION = (read: WgslDecl) =>
  wgslBlock(
    'SKY_LIGHT_OCCLUSION_WGSL',
    [read, PI],
    `struct SkyVisibility{scale:f32,add:vec3f,normal:vec3f,}
struct SkySpecularOcclusion{specular:f32,add:vec3f,diffuse:f32,}
fn skyLightVisibility(lookup:vec3f,normal:vec3f,materialAo:f32,screenAo:f32,bent:vec3f)->SkyVisibility{
 var visibility=1.0;
 var factor=1.0;
 var along=lookup;
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
 let others=min(materialAo,screenAo);
 visibility=select(visibility*others,min(visibility,others),skyLight.mode.x==0.0);
 return SkyVisibility(visibility*factor,(1.0-visibility)*skyLight.tint.xyz,along);
}
fn skyLightDiffuseOccluded(v:SkyVisibility,diffuseColour:vec3f)->vec3f{
 return (v.scale*skyLightDiffuse(v.normal)+v.add)*diffuseColour;
}
fn skyConeIntersection(first:f32,second:f32,between:f32)->f32{
 let difference=abs(first-second);
 return smoothstep(0.0,1.0,1.0-saturate((between-difference)/(first+second-difference)));
}
fn skyLightSpecularOcclusion(bent:vec3f,reflection:vec3f,roughness:f32,twoSided:bool)->SkySpecularOcclusion{
 if(skyLight.mode.y<=0.0){return SkySpecularOcclusion(1.0,vec3f(0.0),1.0);}
 let extent=length(bent);
 var specular=extent;
 if(skyLight.mode.w!=0.0&&!twoSided){
  let reflected=max(roughness,0.1)*PI;
  let unoccluded=extent*PI*skyLight.mode.z;
  let between=acos(dot(bent,reflection)/max(extent,0.001));
  specular=skyConeIntersection(reflected,unoccluded,between);
  specular=mix(0.0,specular,saturate((unoccluded-0.1)/0.2));
 }
 specular=mix(specular,1.0,skyLight.tint.w);
 return SkySpecularOcclusion(specular,(1.0-specular)*skyLight.tint.xyz,mix(extent,1.0,skyLight.tint.w));
}
fn skyLightReflectionOccluded(reflection:vec3f,roughness:f32,o:SkySpecularOcclusion)->vec3f{
 return skyLightReflection(reflection,roughness)*o.specular+o.add;
}`,
  )

/** The block over the light read of `bindings`, listing `dfaoRead` (`dfaoReadWgsl`) beside it. */
export const skyLightOcclusionWgsl = (bindings: SkyLightBindings, dfaoRead: WgslDecl) =>
  wgslBlock('SKY_LIGHT_OCCLUSION_HOST_WGSL', [dfaoRead, OCCLUSION(skyLightReadWgsl(bindings))], '')
