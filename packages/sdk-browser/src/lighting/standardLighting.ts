import { INVERSE_TRANSPOSE_WGSL } from '../math/inverseTransposeWgsl.ts'
import { PI } from './shaderConstants.ts'

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
const GGX_DISTRIBUTION_WGSL = `
fn ggxDistribution(alpha2:f32,cosine:f32,sine2:f32)->f32{
 let q=sine2+cosine*cosine*alpha2;
 return alpha2/(${PI}*q*q);
}`

/** Shared opaque/forward lighting of one punctual light: the standard material's GGX lobe and its
 *  Lambert diffuse. The environment's irradiance is added apart (\`environmentLighting\`). Carries
 *  \`ggxDistribution\` for every program that shades with it. \`DIELECTRIC_F0\` is a dielectric's
 *  reflectance at normal incidence, \`fresnelSchlick\` the engine's one Fresnel term: the standard
 *  lobe's, the anisotropic lobe's and the coat's, its fifth power two products of the square (no
 *  \`exp2\`/\`log2\` of a \`pow\`): the bytes \`pow\` displayed, over a sweep of lit pixels
 *  (\`standardLighting.test.ts\`); \`fresnelScalar\` one lane of it, the same operations.
 *
 *  What a pixel's lights share of its surface — its reflectance, its diffuse albedo, α², 1 − α²,
 *  N·V and the view's half of the visibility — is taken once a pixel (\`lobeSurface\`), before its
 *  light loop (\`sliceLighting\`), never once a light: the very operations in the very order, so
 *  every light's term keeps its bits. \`surfaceLight\` is one light on such a surface,
 *  \`standardLighting\` the same on a surface given whole. \`standardLobe\` is the light's term
 *  past its direction \`L\`, the half-vector \`H\` and \`NdotL\` above zero: what a clear coat
 *  (\`direct/lobesWgsl.ts\`) runs on its own normal with the base's \`L\` and \`H\`. */
export const STANDARD_LIGHTING_WGSL = `${GGX_DISTRIBUTION_WGSL}
const DIELECTRIC_F0=vec3f(0.04);
fn fresnelSchlick(f0:vec3f,cosine:f32)->vec3f{let x=clamp(1.0-cosine,0.0,1.0);let x2=x*x;return f0+(vec3f(1.0)-f0)*(x2*x2*x);}
fn fresnelScalar(f0:f32,cosine:f32)->f32{let x=clamp(1.0-cosine,0.0,1.0);let x2=x*x;return f0+(1.0-f0)*(x2*x2*x);}
struct LobeSurface{f0:vec3f,diffuse:vec3f,alpha2:f32,rest:f32,NdotV:f32,viewG:f32,}
fn lobeSurface(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f)->LobeSurface{
 var s:LobeSurface;
 let alpha=rough*rough;
 s.alpha2=alpha*alpha;
 s.rest=1.0-s.alpha2;
 s.NdotV=max(dot(N,V),1e-4);
 s.viewG=sqrt(s.NdotV*s.NdotV*s.rest+s.alpha2);
 s.f0=mix(DIELECTRIC_F0,rgb,metal);
 s.diffuse=rgb*(1.0-metal)/${PI};
 return s;
}
fn standardLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,light:vec4f)->vec3f{
 return surfaceLight(lobeSurface(rgb,metal,rough,N,V),N,V,light);
}
fn surfaceLight(s:LobeSurface,N:vec3f,V:vec3f,light:vec4f)->vec3f{
 let L=normalize(light.xyz);
 let NdotL=max(dot(N,L),0.0);
 // Facing away, both lobes are finite numbers times direct = light.w·0: a zero, which the light's
 // sum keeps as it is. Returned before the half-vector, the distribution and Fresnel are paid.
 if(NdotL==0.0){return vec3f(0.0);}
 return standardLobe(s,N,V,normalize(L+V),NdotL,light.w);
}
fn standardLobe(s:LobeSurface,N:vec3f,V:vec3f,H:vec3f,NdotL:f32,energy:f32)->vec3f{
 let direct=energy*NdotL;
 let NdotH=max(dot(N,H),0.0);
 let VdotH=max(dot(V,H),0.0);
 // A half-vector behind the normal (a view below the surface) is clamped to its rim, sine 1.
 let NxH=cross(N,H);
 let D=ggxDistribution(s.alpha2,NdotH,select(dot(NxH,NxH),1.0,NdotH==0.0));
 let gV=NdotL*s.viewG;
 let gL=s.NdotV*sqrt(NdotL*NdotL*s.rest+s.alpha2);
 let Vis=0.5/(gV+gL+1e-7);
 let F=fresnelSchlick(s.f0,VdotH);
 return s.diffuse*direct+D*Vis*F*direct;
}`

/**
 * WORLD normal of a local normal under a world pose: the inverse-transpose of the 3×3 when
 * it is regular, the transformed face normal when the pose flattens the primitive onto a
 * plane, the zero vector when it collapses it onto a line or a point — the whole convention is
 * written in `../math/inverseTransposeWgsl.ts`. `uniteOuZero` rather than `normalize`: `normalize` of the
 * zero vector yields NaN, and a shading NaN spreads through screen derivatives to neighbouring
 * pixels. On a non-zero vector, `uniteOuZero` returns `normalize(v)`: the regular case does not
 * move by a bit.
 */
export const NORMAL_TRANSFORM_WGSL = `
${INVERSE_TRANSPOSE_WGSL}
fn xformNormal(world:mat4x4f,n:vec3f)->vec3f{
 return uniteOuZero(inverseTranspose3(mat3x3f(world[0].xyz,world[1].xyz,world[2].xyz),n));
}`
