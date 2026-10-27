import { INVERSE_PI, PI } from '../../../math/src/wgsl/constants.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { inverseTranspose3, unitOrZero } from '../../../math/src/wgsl/inverseTranspose.ts'
import {
  fresnelSchlick,
  lambertAlbedoMul,
  ndotvClamped,
  slabF90,
} from '../../../math/src/wgsl/lighting.ts'
import { lobeRoughness } from './lobeAxisWgsl.ts'
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

/** The constants of the rough diffuse (`diffuseEon`): the Oren-Nayar family's energy-preserving fit, in its three numbers, and the
 *  share of the surface's roughness it takes (0.4, where a GGX surface of lambertian microfacets is matched). */
const EON_ALBEDO_INVERSION = 0.189468
const EON_FIRST_ORDER = 0.262048
const EON_ROUGHNESS_SHARE = 0.4
/** `0.5 - 2 / (3 pi)`, the mean of the first-order term, and the slope of its straight-line approximation `1 - 1 / (1 + it)`. */
const EON_FON = 0.5 - 2 / (3 * Math.PI)
const EON_AF_SLOPE = 1 - 1 / (1 + EON_FON)
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
    slabF90,
    SURFACE_F0_WGSL,
    lambertAlbedoMul,
    ndotvClamped,
    GGX_DISTRIBUTION_WGSL,
    INVERSE_PI,
    lobeRoughness,
  ],
  `/** The pixel's lobe surface: its reflectance, diffuse colour, roughness, N·V and the view's half of the visibility, and whether its lobes take the
 *  exact visibility (\`accurate\`, taken once from \`shadingAccurate\`); the N·V the rough diffuse
 *  takes (\`diffuseNdotV\`: the cosine as it is, 0 behind the normal, where the lobes take its magnitude); and, where the pixel takes
 *  the rough diffuse, its terms that no light changes (\`withRoughDiffuse\`): the surface's roughness weighed by 0.4, and the two colours the
 *  light only scales. A surface without diffuse light holds none (\`withoutDiffuse\`). */
struct LobeSurface{f0:vec3f,f90:f32,diffuse:vec3f,alpha:f32,alpha2:f32,NdotV:f32,viewG:f32,diffuseNdotV:f32,eonRough:f32,eonFirst:vec3f,eonMulti:vec3f,accurate:bool,}
/** Whether the pixel's specular lobes take the exact joint visibility (\`jointHalf\`) in place of its approximation: set once a pixel from the
 *  view's switch (\`shadingAccurate\`) by the passes that light a surface, as \`roughDiffuse\` is, and carried by its surface
 *  (\`LobeSurface.accurate\`). */
var<private> shadingAccurate:bool=false;
/** A direction's half of the joint Smith visibility of the GGX lobe of width α (α² the distribution's) for its cosine \`c\`: exactly
 *  √(c (c − c α²) + α²) where the lobe takes the exact visibility (\`accurate\`), else its approximation, \`c\` blended toward 1 by α:
 *  c (1 − α) + α. */
fn jointHalf(c:f32,alpha:f32,accurate:bool)->f32{
 if(accurate){let a2=alpha*alpha;return sqrt(c*(c-c*a2)+a2);}
 return c*(1.0-alpha)+alpha;
}
/** The joint Smith visibility of the GGX lobe whose distribution is \`a2\` (α²), for a view at \`NoV\` and a light at \`NoL\`: the two
 *  halves (\`jointHalf\`) crossed, as the round lobes take them (\`lobeSum\` keeps the view's half apart, once a pixel). */
fn visibility(a2:f32,NoV:f32,NoL:f32,accurate:bool)->f32{
 let a=sqrt(a2);
 return 0.5/(NoL*jointHalf(NoV,a,accurate)+NoV*jointHalf(NoL,a,accurate));
}
fn lobeSurfaceOf(f0:vec3f,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f)->LobeSurface{
 var s:LobeSurface;
 let held=lobeRoughness(rough);
 s.alpha=held*held;
 s.alpha2=s.alpha*s.alpha;
 s.NdotV=ndotvClamped(N,V);
 s.diffuseNdotV=saturate(dot(N,V));
 s.accurate=shadingAccurate;
 s.viewG=jointHalf(s.NdotV,s.alpha,s.accurate);
 s.f0=f0;
 s.f90=slabF90(f0);
 s.diffuse=lambertAlbedoMul(rgb,metal);
 return s;
}
/** The pixel's surface: the one every light of the pixel is lit on. Where the pixel takes the rough diffuse, its terms that no light
 *  changes are taken here, once (\`withRoughDiffuse\`). */
fn lobeSurface(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f)->LobeSurface{
 let s=lobeSurfaceOf(surfaceF0(rgb,metal),rgb,metal,rough,N,V);
 if(roughDiffuse){return withRoughDiffuse(s);}
 return s;
}
/** Whether the pixel's lights take the rough diffuse (\`diffuseEon\`) in place of Lambert's: set once a pixel from the view's switch
 *  (\`shadingRoughDiffuse\`) by the passes that light a surface; a program that sets none, the surface cache's irradiance among them,
 *  keeps Lambert. A cloth keeps Lambert too (\`setCloth\`). */
var<private> roughDiffuse:bool=false;
/** The first-order term of the rough diffuse, \`S / T\` in the paper's: \`S\` the view's direction against the light's past the normal's,
 *  over the greater cosine, whichever is the greater. */
fn eonSlope(NoV:f32,NoL:f32,VoL:f32)->f32{
 let S=VoL-NoV*NoL;
 return max(S*(1.0/max(1e-6,max(NoV,NoL))),S);
}
/** The two colours the energy-preserving rough diffuse of a surface of diffuse colour \`c\` (not divided by pi) and roughness \`rough\`,
 *  seen at \`NoV\`, is made of: the first scaled by one plus the roughness times the light's term (\`eonSlope\`), the second added —
 *  what no light changes. */
fn eonColours(c:vec3f,rough:f32,NoV:f32)->mat2x3f{
 let rho=c*(1.0+(${wgslF32(EON_ALBEDO_INVERSION)}-${wgslF32(EON_ALBEDO_INVERSION)}*c)*rough);
 let AF=1.0-rough*${wgslF32(EON_AF_SLOPE)};
 let fms=1.0-AF*(1.0+rough*(${wgslF32(EON_FIRST_ORDER)}-${wgslF32(EON_FIRST_ORDER)}*NoV));
 return mat2x3f(rho*(AF*INVERSE_PI),rho*(rho*(fms*INVERSE_PI)));
}
/** The rough diffuse from its two colours (\`eonColours\`) and its roughness \`rough\`, seen at \`NoV\` from a light at \`NoL\` and \`VoL\`. */
fn eonApply(first:vec3f,multi:vec3f,rough:f32,NoV:f32,NoL:f32,VoL:f32)->vec3f{
 return first*(1.0+rough*eonSlope(NoV,NoL,VoL))+multi;
}
/** The energy-preserving rough diffuse of a surface of diffuse colour \`c\` (not divided by pi) and roughness \`rough\`, seen at \`NoV\`
 *  from a light at \`NoL\` and \`VoL\`: Lambert at a roughness of 0, brighter against the light and darker at grazing views as it grows. */
fn diffuseEon(c:vec3f,rough:f32,NoV:f32,NoL:f32,VoL:f32)->vec3f{
 let e=eonColours(c,rough,NoV);
 return eonApply(e[0],e[1],rough,NoV,NoL,VoL);
}
/** The surface \`s\` with the terms of its rough diffuse for a source of no size, as far as no light changes them (\`eonColours\`):
 *  the roughness weighed by 0.4, and the two colours the light only scales: \`eonFirst\` times one plus \`eonRough\` times the light's
 *  term (\`eonSlope\`), then \`eonMulti\` added. */
fn withRoughDiffuse(s:LobeSurface)->LobeSurface{
 var t=s;
 let rough=sqrt(s.alpha)*${wgslF32(EON_ROUGHNESS_SHARE)};
 let e=eonColours(s.diffuse*PI,rough,s.diffuseNdotV);
 t.eonRough=rough;
 t.eonFirst=e[0];
 t.eonMulti=e[1];
 return t;
}
/** The surface \`s\` with no diffuse light: its specular alone, the rough diffuse's terms cleared with its colour, so that no light's diffuse
 *  is anything but zero from it. The one copy of a surface that changes its diffuse. */
fn withoutDiffuse(s:LobeSurface)->LobeSurface{
 var t=s;
 t.diffuse=vec3f(0.0);
 t.eonFirst=vec3f(0.0);
 t.eonMulti=vec3f(0.0);
 return t;
}
/** The diffuse colour of a light at cosine \`NoL\` (the one it takes light by) and \`VoL\` with the view, for a source whose weight is \`micro\`
 *  (1 for a point, fading to 0 as the source reaches 20 cm, 0 for a rectangle): Lambert's \`s.diffuse\` where the pixel takes none, else the
 *  rough diffuse at the surface's roughness times \`micro\` and 0.4 and its N·V (\`diffuseNdotV\`). A source of no size takes only what
 *  depends on the light from the terms the surface carries (\`withRoughDiffuse\`); a surface without diffuse light (\`withoutDiffuse\`)
 *  gives none either way. */
fn lobeDiffuse(s:LobeSurface,NoL:f32,VoL:f32,micro:f32)->vec3f{
 if(!roughDiffuse||micro<=0.0){return s.diffuse;}
 if(micro==1.0){return eonApply(s.eonFirst,s.eonMulti,s.eonRough,s.diffuseNdotV,saturate(NoL),VoL);}
 return diffuseEon(s.diffuse*PI,micro*s.eonRough,s.diffuseNdotV,saturate(NoL),VoL);
}
/** \`lobeDiffuse\` of a source of weight \`micro\`, its \`VoL\` taken from the half-vector's \`VoH\` (\`VoL = 2 VoH² - 1\`). */
fn lobeDiffuseH(s:LobeSurface,NoL:f32,VoH:f32,micro:f32)->vec3f{return lobeDiffuse(s,NoL,2.0*VoH*VoH-1.0,micro);}
fn standardLobe(s:LobeSurface,N:vec3f,V:vec3f,H:vec3f,NdotL:f32,energy:f32)->vec3f{
 let direct=energy*NdotL;
 let NdotH=max(dot(N,H),0.0);
 let VdotH=max(dot(V,H),0.0);
 // A half-vector behind the normal (a view below the surface) is clamped to its rim, sine 1.
 let NxH=cross(N,H);
 let D=ggxDistribution(s.alpha2,NdotH,select(dot(NxH,NxH),1.0,NdotH==0.0));
 let gV=NdotL*s.viewG;
 let gL=s.NdotV*jointHalf(NdotL,s.alpha,s.accurate);
 return lobeSum(s,lobeDiffuseH(s,NdotL,VdotH,1.0),D,gV,gL,VdotH,direct);
}
/** A lobe's term from its diffuse colour \`diffuse\` (\`lobeDiffuse\`) and its distribution \`D\` and its two visibility halves \`gV\`, \`gL\`: the
 *  diffuse share and the specular one, the height-correlated visibility and Fresnel at \`VdotH\`,
 *  times \`direct\`. The halves of the round lobes are the joint visibility's blend (\`jointHalf\`, \`visibility\`),
 *  the anisotropic lobe's its exact lengths (\`direct/lobesWgsl.ts\`). */
fn lobeSum(s:LobeSurface,diffuse:vec3f,D:f32,gV:f32,gL:f32,VdotH:f32,direct:f32)->vec3f{
 let Vis=0.5/(gV+gL+1e-7);
 let F=fresnelSchlick(s.f0,s.f90,VdotH);
 return diffuse*direct+D*Vis*F*direct;
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
