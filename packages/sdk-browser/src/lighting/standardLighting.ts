import { PI } from '../../../math/src/wgsl/constants.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { inverseTranspose3, unitOrZero } from '../../../math/src/wgsl/inverseTranspose.ts'
import {
  fresnelSchlick,
  lambertAlbedoMul,
  ndotvClamped,
  specularF90,
} from '../../../math/src/wgsl/lighting.ts'
import { SURFACE_F0_WGSL } from '../materials/surface/surfaceSpecular.ts'
import { worldMatrix3 } from '../../../math/src/wgsl/matrix.ts'

/**
 * The engine's one GGX normal distribution, for \`alpha2\` = roughness⁴, of a
 * half-vector at \`cosine\` to the normal and \`sine2\` its squared sine, |N×H|², given apart:
 * D = α² / (π (sin² + α² cos²)²), the usual (cos²(α² − 1) + 1) with its 1 − cos² written as
 * |N×H|². In the core of the
 * sharpest lobe, cos lies within 4e-6 of 1 and 1 − cos² in f32 keeps a few of its bits: at the
 * roughness floor the usual form lit 5 000 directions of that core with 2 685 values (stair rings
 * in a sharp highlight), 9 % off at worst. The cross product keeps the sine whole
 * (\`standardLighting.test.ts\`).
 */
export const GGX_DISTRIBUTION_WGSL = wgslBlock(
  'GGX_DISTRIBUTION_WGSL',
  [PI],
  `
fn ggxDistribution(alpha2:f32,cosine:f32,sine2:f32)->f32{
 let q=sine2+cosine*cosine*alpha2;
 return alpha2/(PI*q*q);
}`,
)

/** Shared opaque/forward lighting of one punctual light: the standard material's GGX lobe and its
 *  Lambert diffuse. The environment's irradiance is added apart (\`environmentLighting\`). Carries
 *  \`ggxDistribution\` for every program that shades with it. \`surfaceF0\` is a surface's
 *  reflectance at normal incidence (a dielectric's 0.08 × the pixel's specular, 0.04 where none
 *  was given; a coat's is \`DIELECTRIC_F0\` whatever it is), \`fresnelSchlick\` the engine's one Fresnel term: the
 *  standard lobe's, the anisotropic lobe's and the coat's, its fifth power two products of the
 *  square (no \`exp2\`/\`log2\` of a \`pow\`): the bytes \`pow\` displayed, over a sweep of lit pixels
 *  (\`standardLighting.test.ts\`).
 *
 *  What a pixel's lights share of its surface — its reflectance and the grazing value of it, its diffuse albedo, α, α², N·V
 *  and the view's half of the visibility — is taken once a pixel (\`lobeSurface\`), before its
 *  light loop (\`sliceLighting\`), never once a light: the very operations in the very order, so
 *  every light's term keeps its bits; one light on such a surface is \`surfaceLight\`
 *  (\`SURFACE_LIGHT_WGSL\`). \`standardLobe\` is the light's term
 *  past its direction \`L\`, the half-vector \`H\` and \`NdotL\` above zero: what a clear coat
 *  (\`direct/lobesWgsl.ts\`) runs on its own normal with the base's \`L\` and \`H\`. */
export const STANDARD_LIGHTING_WGSL = wgslBlock(
  'STANDARD_LIGHTING_WGSL',
  [
    fresnelSchlick,
    specularF90,
    SURFACE_F0_WGSL,
    lambertAlbedoMul,
    ndotvClamped,
    GGX_DISTRIBUTION_WGSL,
  ],
  `struct LobeSurface{f0:vec3f,f90:f32,diffuse:vec3f,alpha:f32,alpha2:f32,NdotV:f32,viewG:f32,}
/** A direction's half of the joint visibility, its cosine \`c\` blended toward 1 by α: c (1 − α) + α. */
fn jointHalf(c:f32,alpha:f32)->f32{return c*(1.0-alpha)+alpha;}
fn lobeSurfaceOf(f0:vec3f,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f)->LobeSurface{
 var s:LobeSurface;
 s.alpha=rough*rough;
 s.alpha2=s.alpha*s.alpha;
 s.NdotV=ndotvClamped(N,V);
 s.viewG=jointHalf(s.NdotV,s.alpha);
 s.f0=f0;
 s.f90=specularF90(f0);
 s.diffuse=lambertAlbedoMul(rgb,metal);
 return s;
}
fn lobeSurface(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f)->LobeSurface{
 return lobeSurfaceOf(surfaceF0(rgb,metal),rgb,metal,rough,N,V);
}
fn standardLobe(s:LobeSurface,N:vec3f,V:vec3f,H:vec3f,NdotL:f32,energy:f32)->vec3f{
 let direct=energy*NdotL;
 let NdotH=max(dot(N,H),0.0);
 let VdotH=max(dot(V,H),0.0);
 // A half-vector behind the normal (a view below the surface) is clamped to its rim, sine 1.
 let NxH=cross(N,H);
 let D=ggxDistribution(s.alpha2,NdotH,select(dot(NxH,NxH),1.0,NdotH==0.0));
 let gV=NdotL*s.viewG;
 let gL=s.NdotV*jointHalf(NdotL,s.alpha);
 return lobeSum(s,D,gV,gL,VdotH,direct);
}
/** A lobe's term from its distribution \`D\` and its two visibility halves \`gV\`, \`gL\`: the
 *  diffuse share and the specular one, the height-correlated visibility and Fresnel at \`VdotH\`,
 *  times \`direct\`. The halves of the round lobes are the joint visibility's blend (\`jointHalf\`),
 *  the anisotropic lobe's its exact lengths (\`direct/lobesWgsl.ts\`). */
fn lobeSum(s:LobeSurface,D:f32,gV:f32,gL:f32,VdotH:f32,direct:f32)->vec3f{
 let Vis=0.5/(gV+gL+1e-7);
 let F=fresnelSchlick(s.f0,s.f90,VdotH);
 return s.diffuse*direct+D*Vis*F*direct;
}`,
)

/** One light on a surface, the one light of every surface (\`surfaceLight\`), its direction \`light.xyz\`
 *  unit as every caller hands it (\`lampSeen\`): the standard block's lobe under the pixel's lobe hooks
 *  — \`baseLobe\`, which the hook blocks that list this one declare (\`direct/lobesWgsl.ts\`: the lobed one, and
 *  the lobeless one's standard lobe) —; a pixel under a clear coat (\`hasCoat\`) is lit by the coat model
 *  whole (\`coatedPoint\`). */
export const SURFACE_LIGHT_WGSL = wgslBlock(
  'SURFACE_LIGHT_WGSL',
  [STANDARD_LIGHTING_WGSL],
  `
fn surfaceLight(s:LobeSurface,N:vec3f,V:vec3f,light:vec4f)->vec3f{
 let L=light.xyz;
 if(hasCoat()){
  let coated=coatedPoint(s,N,V,L,light.w);
  return coated[0]+coated[1];
 }
 let NdotL=max(dot(N,L),0.0);
 // Facing away from the base, every lobe is a finite number times direct = light.w·0: a zero, which
 // the light's sum keeps as it is. Returned before the half-vector, the distribution and Fresnel are paid.
 if(NdotL==0.0){return vec3f(0.0);}
 let H=normalize(L+V);
 return baseLobe(s,N,V,L,H,NdotL,light.w);
}`,
)

/**
 * WORLD normal of a local normal under a world pose: the inverse-transpose of the 3×3 when
 * it is regular, the transformed face normal when the pose flattens the primitive onto a
 * plane, the zero vector when it collapses it onto a line or a point — the whole convention is
 * written in `packages/math/src/wgsl/inverseTranspose.ts`. `unitOrZero` rather than `normalize`: `normalize` of the
 * zero vector yields NaN, and a shading NaN spreads through screen derivatives to neighbouring
 * pixels. On a non-zero vector, `unitOrZero` returns `normalize(v)`: the regular case does not
 * move by a bit.
 */
export const NORMAL_TRANSFORM_WGSL = wgslBlock(
  'NORMAL_TRANSFORM_WGSL',
  [worldMatrix3, inverseTranspose3, unitOrZero],
  `
fn xformNormal(world:mat4x4f,n:vec3f)->vec3f{return linearNormal(worldMatrix3(world),n);}
/** The same under a pose's linear part \`m\`, which a caller holding it hands as it is. */
fn linearNormal(m:mat3x3f,n:vec3f)->vec3f{return unitOrZero(inverseTranspose3(m,n));}`,
)
