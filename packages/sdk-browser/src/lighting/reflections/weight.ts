import { AMBIENT_SPECULAR_OCCLUSION_WGSL } from '../deferred/ambientOcclusionWgsl.ts'
import { DEFERRED_BINDINGS } from '../deferred/bindings.ts'
import { wgslBlock, wgslStruct, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { DIELECTRIC_F0, envBrdfF90, slabF90 } from '../../../../math/src/wgsl/lighting.ts'
import { SURFACE_F0_WGSL } from '../../materials/surface/surfaceSpecular.ts'
import { BOUNCE_APPLY_WGSL } from '../bounce/applyWgsl.ts'
import { SCREEN_INDIRECT_WGSL } from '../bounce/screen/indirectWgsl.ts'
import { REFLECTION_LOBE_WGSL } from './field.ts'
import { LOBE_AXIS_WGSL, reflectionLobeWgsl } from '../lobeAxisWgsl.ts'
import { ENERGY_TERMS_WGSL } from '../direct/energyTermsWgsl.ts'
import { surfaceReflects } from '../../materials/surface/surfaceModel.ts'
import { loadOnlyTarget } from '../../gpu/core/loadOnlyTarget.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { REFLECTION_FIELD_STAGE_WGSL } from './wgsl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { REFLECTION_SAMPLE_WGSL } from './sampleWgsl.ts'
import { SKY_READ_WGSL } from '../atmosphere/skyReadWgsl.ts'

/** What a surface's lobes reflect: the base lobe's radiance and the clear coat's. */
const REFLECTED_WGSL = wgslStruct('Reflected', [], 'struct Reflected{base:vec3f,coat:vec3f,}')

/** The look of the light an opaque surface reflects (`reflectionLook`): the light raised to the view's contrast about the mid grey, so that the overall exposure does not
 *  change, and multiplied by the view's scale (`View.reflection`). The opaque resolve alone gives it, as the reference does: the front layer's and the water's
 *  reflections have none. A light is never negative: the floor keeps `pow` off a negative base. */
const REFLECTION_LOOK_WGSL = wgslBlock(
  'REFLECTION_LOOK_WGSL',
  [],
  `const REFLECTION_MID_GREY:f32=0.18;
fn reflectionLook(light:vec3f)->vec3f{
 let lit=max(light,vec3f(0.0));
 if(all(view.reflection.xy==vec2f(1.0))){return lit;}
 return pow(lit*(1.0/REFLECTION_MID_GREY),vec3f(view.reflection.x))*REFLECTION_MID_GREY*view.reflection.y;
}`,
)

/**
 * What a lit surface keeps of the radiance it reflects (`reflectionWeighWgsl`). `reflectionWeight`
 * is the energy terms of its GGX lobe at its roughness as it is and N·V held to [0, 1] (`energyTerms`, in every
 * lighting program; the table's own clamp is the only floor, as the reference reads it on every path), on its reflectance `f0`: `surfaceF0` of its colour and metalness, a dielectric's on a coat, the water's own,
 * and its grazing value `f90`, by the rule of the pass (`reflectionF90`): the green channel's for the opaque composite (`envBrdfF90`), the greatest
 * channel's for the forward fragments and the sky's own light (`slabF90`).
 * `Reflected` is what its lobes reflect, the radiance of each: the base lobe's and, where the surface
 * carries a clear coat, the coat's. `reflectionShare` is that radiance weighed on a reflectance, the base's weighed under the coat as the clear coat
 * model's layers combine (`hasCoat`), and the coat's added. A program without lobes has no coat and a round lobe. The opaque resolve weighs each
 * pixel here, on its own reflectance, its lobes given their look first (`resolvedWeighed`); the forward programs the front layer's blend, with no
 * look (`forward.ts`).
 */
const REFLECTION_WEIGHT_WGSL = wgslBlock(
  'REFLECTION_WEIGHT_WGSL',
  [ENERGY_TERMS_WGSL],
  `fn reflectionWeight(f0:vec3f,f90:f32,rough:f32,N:vec3f,V:vec3f)->vec3f{
 return energyTerms(f0,f90,rough,saturate(dot(N,V)));
}`,
)
export const reflectionWeighWgsl = (lobes: boolean, f90: 'green' | 'slab' = 'green') =>
  wgslBlock(
    `reflectionWeighWgsl(${lobes}, ${f90})`,
    [REFLECTED_WGSL, REFLECTION_WEIGHT_WGSL, DIELECTRIC_F0, f90 === 'green' ? envBrdfF90 : slabF90],
    `fn reflectionF90(f0:vec3f)->f32{return ${f90 === 'green' ? 'envBrdfF90' : 'slabF90'}(f0);}
${
  lobes
    ? `fn reflectionBaseShare(traced:Reflected,f0:vec3f,rough:f32,N:vec3f,V:vec3f)->vec3f{
 if(!hasCoat()){return traced.base*reflectionWeight(f0,reflectionF90(f0),rough,N,V);}
 // The coat's layers combined: the base's reflection weighed on the coat's reflectance, the grazing part of
 // its energy terms scaled by what the coat leaves, and what the coat lets through (one minus its own).
 let base=energyTerms(f0,reflectionF90(f0)*(1.0-lobes.coat),rough,saturate(dot(N,V)));
 let F=lobes.coat*reflectionWeight(DIELECTRIC_F0,reflectionF90(DIELECTRIC_F0),lobes.coatRough,lobes.coatN,V).x;
 return traced.base*base*(1.0-F);
}
fn reflectionCoatShare(traced:Reflected,V:vec3f)->vec3f{
 if(!hasCoat()){return vec3f(0.0);}
 return traced.coat*lobes.coat*reflectionWeight(DIELECTRIC_F0,reflectionF90(DIELECTRIC_F0),lobes.coatRough,lobes.coatN,V).x;
}`
    : `fn reflectionBaseShare(traced:Reflected,f0:vec3f,rough:f32,N:vec3f,V:vec3f)->vec3f{
 return traced.base*reflectionWeight(f0,reflectionF90(f0),rough,N,V);
}
fn reflectionCoatShare(traced:Reflected,V:vec3f)->vec3f{return vec3f(0.0);}`
}
fn reflectionShare(traced:Reflected,f0:vec3f,rough:f32,N:vec3f,V:vec3f)->vec3f{
 return reflectionBaseShare(traced,f0,rough,N,V)+reflectionCoatShare(traced,V);
}`,
  )

/** The base lobe a surface of normal `N` and roughness `rough` seen from `V` reflects through
 *  (`reflectionBaseLobe`): around its mirror direction, at the narrower width the lights read
 *  (`reflectionAcross`, which its host lists in its lobes' variant). */
const REFLECTION_BASE_LOBE_WGSL = wgslBlock(
  'REFLECTION_BASE_LOBE_WGSL',
  [REFLECTION_LOBE_WGSL, LOBE_AXIS_WGSL],
  `fn reflectionBaseLobe(N:vec3f,V:vec3f,rough:f32)->ReflectionLobe{
 return reflectionLobeOf(reflect(-V,N),reflectionAcross(rough));
}`,
)

/** The lobe a surface traces, laid out (`reflectionTopLobe`): `lobe` its axis in `xyz` (none for a round lobe) and its width along it in `w`,
 *  `across` its width across it. The coat's where the surface carries a clear coat, round but for the material's anisotropy, which stretches it as the base's; the base lobe's elsewhere, anisotropic where the
 *  material is, at the roughness `rough` of the lobe traced. */
export const REFLECTION_TOP_LOBE_WGSL = wgslBlock(
  'REFLECTION_TOP_LOBE_WGSL',
  [reflectionLobeWgsl(true), LOBE_AXIS_WGSL],
  `struct ReflectionTopLobe{lobe:vec4f,across:f32,coated:bool,}
fn reflectionTopLobe(rough:f32)->ReflectionTopLobe{
 if(lobes.on&&lobes.coat>0.0){
  let alpha=lobeAlpha(lobes.coatRough);
  // The material's anisotropy stretches the coat's lobe as it stretches the base's, along the same axis, from the coat's own width.
  if(lobes.skewed){
   let strength=(lobes.at-lobes.ab)/max(lobes.at+lobes.ab,0.002);
   return ReflectionTopLobe(vec4f(lobes.T,max(alpha*(1.0+strength),0.001)),max(alpha*(1.0-strength),0.001),true);
  }
  return ReflectionTopLobe(vec4f(0.0,0.0,0.0,alpha),alpha,true);
 }
 return ReflectionTopLobe(reflectionLobe(rough),reflectionAcross(rough),false);
}`,
)

/**
 * The ray a surface casts, sampled by `u` (`sampleWgsl.ts`): one a pixel, of the lobe it traces — its
 * top layer, the sharpest lobe it shows —: where the surface carries a clear coat (`lobes.coat`), the coat's own dielectric lobe on
 * its normal and roughness; elsewhere the base lobe, along the lobe the lights read (`reflectionLobe`): `reflectionTopLobe`
 * picks it, `reflectionTopRay` casts it. The lobe under a coat
 * casts no ray of its own: the coat's ray answers the coat whole and this lobe not at all, its rough light being the screen probes' or the environment's (`bilateralWgsl.ts`).
 */
export const REFLECTION_LOBE_RAYS_WGSL = wgslBlock(
  'REFLECTION_LOBE_RAYS_WGSL',
  [REFLECTION_SAMPLE_WGSL, REFLECTION_TOP_LOBE_WGSL],
  `fn reflectionTopRay(N:vec3f,V:vec3f,rough:f32,u:vec2f)->ReflectionLobeRay{
 let top=reflectionTopLobe(rough);
 return reflectionLobeRay(select(N,lobes.coatN,top.coated),V,top.across,top.lobe,u);
}`,
)

/**
 * What a surface's lobes reflect of the environment alone (`reflectionEnvironmentOf`): the radiance around the scene through the base lobe
 * at the narrower width the lights read, held to a ray's ceiling (`reflectionField`), for the base lobe and for the clear coat, whose rough light
 * is the base lobe's. What the front surface reads where its lobe traces nothing in the trace's last pass (`bilateralWgsl.ts`), the rest of each lobe a ray answers in part, and what a forward fragment that is not the front surface of its pixel reflects: the layers behind the front are
 * seen through it, and the traced front is the only one worth a ray.
 */
export const reflectionEnvironmentLobesWgsl = (lobes: boolean) =>
  wgslBlock(
    `reflectionEnvironmentLobesWgsl(${lobes})`,
    [
      REFLECTED_WGSL,
      reflectionLobeWgsl(lobes),
      REFLECTION_BASE_LOBE_WGSL,
      REFLECTION_FIELD_STAGE_WGSL,
      LOBE_AXIS_WGSL,
    ],
    `fn reflectionEnvironmentOf(N:vec3f,V:vec3f,rough:f32)->Reflected{
 let environment=reflectionField(reflectionBaseLobe(N,V,rough));
 return Reflected(environment,environment);
}`,
  )

/** The layers of the reflection target: the rays' answer with the base lobe's share, and the environment through the base lobe with the coat's rough share. */
export const REFLECTION_TARGET_LAYERS = 2
/** The reflection target, read by load alone by the opaque resolve, before any weight or look. Its layer 0 holds what the rays answer, the
 *  radiance of the lobe the ray serves — a bare pixel's base lobe by its share, a coated pixel's coat whole —, with the base lobe's
 *  share in its alpha; its layer 1 the environment through the base lobe, the rough light both lobes share, with the share of the
 *  coat's lobe the rays leave to it in its alpha, written only where the surface has a coat (the one reader, `resolvedCoatLeft`, reads it under `hasCoat`). The rough light, where the screen probes read nothing, is the environment of layer 1
 *  (`resolvedReflectionRough`); the screen probes' replaces it where they read the pixel, each lobe
 *  taking the share of it its own is left (`resolvedIndirect`). The resolve weighs all of it (`resolvedWeighed`). */
export const REFLECTION_TARGET = loadOnlyTarget(
  DEFERRED_BINDINGS.reflection,
  HDR_FORMAT,
  'reflectionTarget',
  REFLECTION_TARGET_LAYERS,
)

/** The reflection target's alpha where the trace's last pass traced no ray for the opaque pixel's base lobe
 *  (`bilateralWgsl.ts`): the whole of the lobe is then the rough light, which the resolve takes from the screen probes where they read the
 *  pixel (`resolvedIndirect`). A pixel whose base lobe a ray answers in part
 *  writes that share, in (0, 1]: the rest is the rough light (`reflectionLeftShare`), the
 *  screen probes' or the environment's through the base lobe (`resolvedReflectionRough`); a target never written, or a pixel that reflects nothing, reads zero. The
 *  colour holds the rays' share of both lobes whatever the alpha. */
const REFLECTION_PROBES_LEFT = -1
export const REFLECTION_PROBES_LEFT_WGSL = wgslBlock(
  'REFLECTION_PROBES_LEFT_WGSL',
  [],
  `const REFLECTION_PROBES_LEFT:f32=${wgslF32(REFLECTION_PROBES_LEFT)};
/** The share of a pixel's base lobe left to the screen probes, from the alpha \`alpha\` of its texel: all of it where flagged, what a
 *  ray did not answer where the texel holds the share that did, none where it holds none. */
fn reflectionLeftShare(alpha:f32)->f32{
 if(alpha==REFLECTION_PROBES_LEFT){return 1.0;}
 return select(0.0,1.0-alpha,alpha>0.0);
}`,
)

/**
 * THE OPAQUE RESOLVE'S REFLECTION WORDS over the local light a pass reads (`local`, a block that defines
 * `resolvedLocalLight(sky, N, V, rough)`): the environment the last pass wrote, the sky, which the local light
 * (`NO_LOCAL_LIGHT_WGSL`: none; the reflection captures', `capturedLocalLightWgsl`) lays itself over before the lobes are weighed.
 */
export const reflectionResolveWgsl = (local: WgslDecl) => {
  /** The opaque resolve's reflection: what the rays answer of the surface's lobes, as the compute pass accumulated it for its pixel — its texel with its alpha in
   *  `resolvedReflectionTexel`, zero where the surface reflects nothing —, and the rest of each lobe, the one rough light the lobes share (the environment's through
   *  the base lobe, `resolvedReflectionRough`) times the share each lobe is left (`reflectionLeftShare` for the base lobe, `resolvedCoatLeft` for the coat), under
   *  the occlusion `occluded` (`ambientSpecularOcclusion`, `resolvedReflection`). `resolvedLobes` gives each lobe its light — the rays' answer to the lobe they serve:
   *  a bare pixel's base lobe, a coated pixel's coat, the base lobe under a coat having the rough light alone — and `resolvedWeighed` its look
   *  and its weight, on the pixel's own reflectance (`reflectionShare`): the rays' answer and the rough light blended, given a look, then
   *  weighed. The host lists the lobes' variant of `reflectionWeighWgsl` and of `indirectF0`. */
  const resolvedReflectionWgsl = wgslBlock(
    `resolvedReflectionWgsl(${local.name})`,
    [
      surfaceReflects,
      REFLECTED_WGSL,
      REFLECTION_LOOK_WGSL,
      REFLECTION_PROBES_LEFT_WGSL,
      AMBIENT_SPECULAR_OCCLUSION_WGSL,
      SURFACE_F0_WGSL,
      local,
    ],
    `${REFLECTION_TARGET.wgsl}
fn resolvedReflectionTexel(coord:vec2i)->vec4f{
 if(!surfaceReflects(surfaceModel)){return vec4f(0.0);}
 return textureLoad(reflectionTarget,coord,0);
}
/** The share of the coat's lobe the rays leave to the rough light: none without a coat. */
fn resolvedCoatLeft(coord:vec2i)->f32{
 if(!hasCoat()||!surfaceReflects(surfaceModel)){return 0.0;}
 return textureLoad(reflectionTarget,coord,1).a;
}
/** The environment through the base lobe, the rough light the lobes share. */
fn resolvedReflectionRough(coord:vec2i,N:vec3f,V:vec3f,rough:f32)->vec3f{return resolvedLocalLight(textureLoad(reflectionTarget,coord,1).rgb,N,V,rough);}
fn resolvedLobes(ray:vec3f,base:vec3f,coat:vec3f)->Reflected{
 let coated=hasCoat();
 return Reflected(select(ray,vec3f(0.0),coated)+base,select(vec3f(0.0),ray,coated)+coat);
}
fn resolvedWeighed(ray:vec3f,base:vec3f,coat:vec3f,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f)->vec3f{
 let lit=resolvedLobes(ray,base,coat);
 var looked=Reflected(reflectionLook(lit.base),vec3f(0.0));
 if(hasCoat()){looked.coat=reflectionLook(lit.coat);}
 return reflectionShare(looked,indirectF0(rgb,metal),rough,N,V);
}
fn resolvedReflection(coord:vec2i,rgb:vec3f,metal:f32,occluded:f32,N:vec3f,V:vec3f,rough:f32)->vec3f{
 if(!surfaceReflects(surfaceModel)){return vec3f(0.0);}
 let traced=resolvedReflectionTexel(coord);
 let coatLeft=resolvedCoatLeft(coord);
 let left=reflectionLeftShare(traced.a);
 if(left==0.0&&coatLeft==0.0){return resolvedWeighed(traced.rgb,vec3f(0.0),vec3f(0.0),rgb,metal,rough,N,V);}
 let light=resolvedReflectionRough(coord,N,V,rough)*ambientSpecularOcclusion(occluded,N,V,rough);
 return resolvedWeighed(traced.rgb,left*light,coatLeft*light,rgb,metal,rough,N,V);
}`,
  )

  /**
   * The same under the sky light's distance-field occlusion (`resolvedReflectionOccluded`): what the field alone answers — the
   * environment through the base lobe (`reflectionEnvironment`, the sky light's cube) — is the sky light's specular light, which the bent normal
   * occludes (`skySpecular`, and `skyAdd` the occlusion's tint times what it lost, weighed on the pixel's reflectance as the
   * light it stands for, `reflectionWeight`); what the screen and the trace of the scene answered, hits of the
   * scene and not the sky, is left as it is. Both go under the occlusion of the material and the screen (`ambientSpecularOcclusion`).
   * The coat's rough share is the same, under the coat's own pair (`coatSpecular`, `coatAdd`): the reference gathers the coat's sky light with the coat's reflection
   * direction and roughness, so its sky occlusion and tint are another pair than the base lobe's, the tint weighed by the coat's share of the layers (one minus `coatLayerKeep`).
   * The tints are added after the look and the weight of the lights: they stand for light the weight has already been applied to.
   */
  const resolvedReflectionOccludedWgsl = wgslBlock(
    `resolvedReflectionOccludedWgsl(${local.name})`,
    [resolvedReflectionWgsl, REFLECTION_WEIGHT_WGSL, slabF90],
    `fn resolvedReflectionOccluded(coord:vec2i,rgb:vec3f,metal:f32,occluded:f32,N:vec3f,V:vec3f,rough:f32,skySpecular:f32,skyAdd:vec3f,coatSpecular:f32,coatAdd:vec3f)->vec3f{
 if(!surfaceReflects(surfaceModel)){return vec3f(0.0);}
 let traced=resolvedReflectionTexel(coord);
 let coatLeft=resolvedCoatLeft(coord);
 let left=reflectionLeftShare(traced.a);
 if(left==0.0&&coatLeft==0.0){return resolvedWeighed(traced.rgb,vec3f(0.0),vec3f(0.0),rgb,metal,rough,N,V);}
 let occlusion=ambientSpecularOcclusion(occluded,N,V,rough);
 let keep=coatLayerKeep();
 let f0=indirectF0(rgb,metal);
 let tint=skyAdd*reflectionWeight(f0,slabF90(f0),rough,N,V)*keep;
 let light=resolvedReflectionRough(coord,N,V,rough)*occlusion;
 let lights=resolvedWeighed(traced.rgb,left*skySpecular*light,coatLeft*coatSpecular*light,rgb,metal,rough,N,V);
 return lights+(left*tint+coatLeft*coatAdd*(1.0-keep))*occlusion;
}`,
  )

  /**
   * The bounce program's indirect light at the pixel `coord` (`resolvedIndirect`): its bounce and its reflection, a column
   * each. The bounce is the screen probes' light where they read the pixel (`screenDiffuse`), none where they gather light and did not read it, and
   * the sky light's (`bounceLighting`) under the screen probes' occlusion alone (`screenShortRange`) where the level gathers none or they did not run. The reflection is the
   * reference's composition of a pixel's specular light: what the rays answer of its lobes (`resolvedReflectionTexel`, the
   * trace's, whole under a roughness of 0.3 and none past 0.4, `reflectionTraceShare`, for a bare lobe; the whole of a clear coat's and none of the base lobe's under it), plus the rest of each lobe
   * (`reflectionLeftShare` for the base lobe, `resolvedCoatLeft` for the coat: the whole of the base
   * lobe where flagged `REFLECTION_PROBES_LEFT`, no ray being traced for it) times the one rough light the lobes share — the screen probes' where they
   * read the pixel (`screenRoughAt`, four points of its lobe in their radiance) under the specular occlusion their bent normal gives
   * (`screenSpecularOcclusion`); the
   * environment the last pass wrote (`resolvedReflectionRough`) where they gather none (`screenOcclusionOnly`) — none at all where they gather and left the pixel unread, as the diffuse —, and, where the probes hold the sky (a sky light shines), the
   * environment's sky giving way to them. Each lobe's light, blended so, is given its look and weighed on its own reflectance, the base lobe's under its coat
   * (`resolvedWeighed`). What the environment gives goes under the occlusion `occluded` (`ambientSpecularOcclusion`);
   * what the probes give is under their own specular occlusion alone. The host lists the lobes' variant of `reflectionWeighWgsl` and of `coatLayerKeep`.
   */
  const RESOLVED_INDIRECT_WGSL = wgslBlock(
    `RESOLVED_INDIRECT_WGSL(${local.name})`,
    [
      resolvedReflectionWgsl,
      SKY_READ_WGSL,
      REFLECTION_PROBES_LEFT_WGSL,
      AMBIENT_SPECULAR_OCCLUSION_WGSL,
      BOUNCE_APPLY_WGSL,
      SCREEN_INDIRECT_WGSL,
    ],
    `fn resolvedIndirect(coord:vec2i,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,occluded:f32,foliage:bool)->mat2x3f{
 let traced=resolvedReflectionTexel(coord);
 let coatLeft=resolvedCoatLeft(coord);
 // The pixel the screen probes read takes their light; where they left none it has none while they gather light, as in the reference, and the
 // sky light's, under their occlusion alone (screenShortRange), where the level gathers none or they did not run (screenOcclusionOnly).
 let seen=screenIndirectAt(coord);
 let screened=screenLights(seen);
 // A cloth's fuzz joins its diffuse colour (\`clothDiffuse\`); the multi-bounce occlusion reads the base colour \`rgb\`.
 let colour=clothDiffuse(rgb,metal);
 var diffuse=vec3f(0.0);
 // The material's occlusion is the screen probes' integration's (\`spDiffuse\`): it is not taken again here.
 if(screened){diffuse=screenDiffuse(rgb,colour,seen,foliage)+lambertDiffuse(colour.rgb,colour.w,screenShortRangeGiAt(coord),1.0);}
 else if(screenOcclusionOnly()){diffuse=bounceLighting(colour.rgb,colour.w,N,P,ao)*screenShortRange(rgb,seen,foliage);}
 let left=reflectionLeftShare(traced.a);
 // The rays' answer alone: no ray answered no share of the lobes, or a pixel the probes did not read while they gather has no rough light either, as its diffuse.
 if((left==0.0&&coatLeft==0.0)||(!screened&&!screenOcclusionOnly())){
  return mat2x3f(diffuse,resolvedWeighed(traced.rgb,vec3f(0.0),vec3f(0.0),rgb,metal,rough,N,V));
 }
 // No ray answered a share of this pixel's lobes: the rest is their one rough light, the environment the last pass wrote beside the rays' answer,
 // and the screen probes' where they read the pixel, which holds the sky where a sky light shines, so the environment's sky gives way to it.
 var light=resolvedReflectionRough(coord,N,V,rough)*ambientSpecularOcclusion(occluded,N,V,rough);
 if(screened){
  // The probes' rough specular is under their own specular occlusion alone (\`screenSpecularOcclusion\`), never under the material's too.
  light=select(light,vec3f(0.0),skyLit())+screenRoughAt(coord)*screenSpecularOcclusion(coord,N,V,rough);
 }
 return mat2x3f(diffuse,resolvedWeighed(traced.rgb,left*light,coatLeft*light,rgb,metal,rough,N,V));
}`,
  )
  return { resolvedReflectionWgsl, resolvedReflectionOccludedWgsl, RESOLVED_INDIRECT_WGSL }
}

/** The local light of a pass that reads none: the environment as it is. */
export const NO_LOCAL_LIGHT_WGSL = wgslBlock(
  'NO_LOCAL_LIGHT_WGSL',
  [],
  `fn resolvedLocalLight(sky:vec3f,N:vec3f,V:vec3f,rough:f32)->vec3f{return sky;}`,
)

export const { resolvedReflectionWgsl, resolvedReflectionOccludedWgsl, RESOLVED_INDIRECT_WGSL } =
  reflectionResolveWgsl(NO_LOCAL_LIGHT_WGSL)
