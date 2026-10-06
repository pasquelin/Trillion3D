import { INVERSE_TRANSPOSE_WGSL } from '../math/inverseTransposeWgsl.ts'

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
 return alpha2/(3.14159265*q*q);
}`

/** Shared opaque/forward lighting of one punctual light: the standard material's GGX lobe and its
 *  Lambert diffuse. The environment's irradiance is added apart (\`environmentLighting\`). Carries
 *  \`ggxDistribution\` for every program that shades with it. */
export const STANDARD_LIGHTING_WGSL = `${GGX_DISTRIBUTION_WGSL}
fn standardLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,light:vec4f)->vec3f{
 let L=normalize(light.xyz);
 let NdotL=max(dot(N,L),0.0);
 // Facing away, both lobes are finite numbers times direct = light.w·0: a zero, which the light's
 // sum keeps as it is. Returned before the half-vector, the distribution and Fresnel are paid.
 if(NdotL==0.0){return vec3f(0.0);}
 let NdotV=max(dot(N,V),1e-4);
 let direct=light.w*NdotL;
 let H=normalize(L+V);
 let NdotH=max(dot(N,H),0.0);
 let VdotH=max(dot(V,H),0.0);
 let alpha=rough*rough;let alpha2=alpha*alpha;
 // A half-vector behind the normal (a view below the surface) is clamped to its rim, sine 1.
 let NxH=cross(N,H);
 let D=ggxDistribution(alpha2,NdotH,select(dot(NxH,NxH),1.0,NdotH==0.0));
 let gV=NdotL*sqrt(NdotV*NdotV*(1.0-alpha2)+alpha2);
 let gL=NdotV*sqrt(NdotL*NdotL*(1.0-alpha2)+alpha2);
 let Vis=0.5/(gV+gL+1e-7);
 let f0=mix(vec3f(0.04),rgb,metal);
 let F=f0+(vec3f(1.0)-f0)*pow(clamp(1.0-VdotH,0.0,1.0),5.0);
 let diffuse=rgb*(1.0-metal)/3.14159265;
 return diffuse*direct+D*Vis*F*direct;
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
