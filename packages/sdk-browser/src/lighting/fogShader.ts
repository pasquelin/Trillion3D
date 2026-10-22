/**
 * The fog laws of `packages/sdk-core/src/scene/core/fog.ts` in the shader, on the fog block of the
 * contract buffer (`DirectLights.fog`, slots `FOG_SLOT`): the linear ramp, and the height fog of
 * `fogHeight.ts` — the density `baseDensity · 2^(−falloff · (y − baseHeight))`, the transmittance
 * `2^(−X)` with `X` the density where the ray starts times the ray's length times `(1 − 2^(−F)) / F`,
 * `F` the falloff times the rise (`ln 2` where `F` is nearly nil, by its first-order expansion),
 * never below `1 − maxOpacity`.
 *
 * Steps of the height fog, in order: the ray is cut short where it passes the horizontal limit; the
 * eye's height is held to 655 m above the base height of the layers that have a density, the ray's
 * rise compensated, so that no exponent leaves what a 32-bit float holds; beyond the cutoff
 * distance there is no fog; a start distance — and where a volume covers the near air, the distance
 * it covers along this ray — moves the ray's origin along it, the layers' densities taken where
 * the ray then starts; the two layers' integrals sum, shared with the sun's lobe, which crosses
 * the fog from its own start distance on; the colour is the fog's, or the cubemap's by the ray's
 * direction, blended by its length. A pixel no surface drew is fogged at the far depth the depth
 * buffer holds there, along its ray.
 */
import { INVERSE_FOUR_PI } from '../../../math/src/wgsl/constants.ts'
import { ATMOSPHERE_SLOT } from '../../../sdk-core/src/scene/core/atmospherePack.ts'
import { FOG_MODE, FOG_SLOT } from '../../../sdk-core/src/scene/core/fog.ts'
import { wgslBlock, type WgslDecl } from '../../../math/src/wgsl/decl.ts'
import { HAZE_READ_WGSL } from './atmosphere/hazeReadWgsl.ts'
import { VIEW_SLOT } from './atmosphere/layout.ts'

const fog = (slot: number) => `directLights.fog[${slot}]`
const air = (slot: number) => `directLights.atmosphere[${slot}]`
/** The sky's mean radiance at the fog's altitude, the GPU writes each image. */
const SKY_MEAN = `directLights.atmosphereView[${VIEW_SLOT.haze}].xyz`
/** Whether an atmosphere shows: its planet's block is written. */
const AIR_SHOWN = `${air(ATMOSPHERE_SLOT.planet)}.x!=0.0`
/** What the atmosphere gives the fog of the sky: its mean radiance, the atmosphere's contribution
 *  and the fog's own factor. */
const SKY_AMBIENT = `${fog(FOG_SLOT.sky)}.rgb*${SKY_MEAN}*${air(ATMOSPHERE_SLOT.sunTransmittance)}.w`
/** What the atmosphere gives the sun's lobe: the sun's illuminance on the ground, through the
 *  air, times the atmosphere's contribution. */
const SUN_ON_GROUND = `${air(ATMOSPHERE_SLOT.sunIlluminance)}.rgb*${air(ATMOSPHERE_SLOT.sunTransmittance)}.rgb*${air(ATMOSPHERE_SLOT.sunTransmittance)}.w`

/** What the atmosphere gives the sun's lobe from the air's second light, where there is one: its
 *  illuminance on the ground, through the air toward it, times the atmosphere's contribution. */
const SECOND_ON_GROUND = `${air(ATMOSPHERE_SLOT.secondIlluminance)}.rgb*${air(ATMOSPHERE_SLOT.secondTransmittance)}.rgb*${air(ATMOSPHERE_SLOT.sunTransmittance)}.w`
/** Whether the air holds a second light. */
const SECOND_SHOWN = `${air(ATMOSPHERE_SLOT.secondDisk)}.w>0.0`

/** `fogOver`: the fog apart, for a layer that multiplies what lies behind it — its inscattering,
 *  then the transmittance from the eye to `P`; no fog adds nothing and keeps everything — and
 *  `fogged`: a lit colour at the world point `P` seen from `eye`, behind the fog; no fog leaves it
 *  as it is.
 *
 *  With an atmosphere the sky's mean radiance, times the fog's factor and the atmosphere's
 *  contribution, adds to the fog's colour, the sun's light on the ground to the lobe's — and where
 *  the air holds a second light, a second lobe toward it, of the fog's own colour and its light on
 *  the ground, through the same density as the first — and the
 *  haze of the air (`aerialPerspective`, `../atmosphere/hazeReadWgsl.ts`) lies over the fog's: the
 *  fog's inscattering and transmittance first, then the haze's light through the fog's
 *  transmittance, the two transmittances multiplied. Without one, nothing of it is read. Nearest
 *  of all lies the volume (`fogVolumeLookup`, `./fog/readWgsl.ts`): its light, and the fog and the
 *  haze through its transmittance.
 *
 *  `fogBeyond`: the same fog over the point a ray that leaves the scene along the unit `dir` reaches
 *  at the far depth (`FOG_FAR_DEPTH`, what the depth buffer's far value converts to), the sky's
 *  pixel, with no haze, for the sky is the air. A ray that rises keeps what the density above the
 *  eye lets through, nothing near the horizon; a level or falling one keeps nothing, so that from
 *  the horizon down the pixel is the fog's colour alone; a cutoff distance leaves the sky as it is.
 *  A distance fog leaves the sky as it is. `fogsBackground`: whether the pixels no surface drew are
 *  fogged by the lighting itself, because no sky is drawn on them — a height fog and no atmosphere.
 *
 *  What the fog reads past the light buffer — the cubemap, the volume — is the program's
 *  (`fogWgsl`): the text it lists answers `fogCubeSharp`, `fogCubeAverage`, `fogVolumeExclude` and
 *  `fogVolumeLookup`; a program that binds none gets the answers of no cubemap and no volume
 *  (`fogResourcesWgsl`). */
const FOG_TEXT = `
const FOG_LN2:f32=${Math.LN2};
const FOG_EYE_CEILING:f32=655.36;
/** The depth the depth buffer's far value converts to: the engine's tiny fudge on the far plane's
 *  reciprocal, one over 10⁻⁸. */
const FOG_FAR_DEPTH:f32=1e8;
/** The least cosine between a ray and the view's forward at which the volume's end is projected
 *  along the ray: a ray nearer the view's plane has no fog excluded. */
const FOG_MIN_COSINE:f32=0.001;
/** The line integral's expansion is taken where \`|F|\` is under this. */
const FOG_TAYLOR_BELOW:f32=0.01;
fn linearFog(P:vec3f,eye:vec3f,withSky:bool)->vec4f{
 let law=${fog(FOG_SLOT.law)};
 let kept=clamp((law.y-length(P-eye))/max(law.y-law.x,1e-6),0.0,1.0);
 var colour=${fog(FOG_SLOT.color)}.rgb;
 if(withSky){colour+=${SKY_AMBIENT};}
 return vec4f(colour*(1.0-kept),kept);
}
/** The density of a layer — \`layer\` is its \`baseDensity, falloff, baseHeight\` — where a ray starts, at
 *  the height \`z\`. Where the ray starts at the held eye, the exponent is held to ±126, so that a layer
 *  never reads an infinity; where it starts past a distance of the eye, to its floor of −127. */
fn fogOriginTerms(layer:vec4f,z:f32,moved:bool)->f32{
 let exponent=layer.y*(z-layer.z);
 if(moved){return layer.x*exp2(-max(-127.0,exponent));}
 return layer.x*exp2(clamp(-exponent,-125.0,126.0));
}
/** A layer's line integral along the ray: its density \`terms\` where the ray starts times \`(1 − 2^(−F)) / F\`,
 *  \`F\` the layer's falloff times the ray's \`rise\`, held above −127; the first-order expansion where
 *  \`|F|\` is nearly nil. */
fn fogLineIntegral(falloff:f32,rise:f32,terms:f32)->f32{
 let f=max(-127.0,falloff*rise);
 let whole=(1.0-exp2(-f))/f;
 let expanded=FOG_LN2-0.5*FOG_LN2*FOG_LN2*f;
 return terms*select(expanded,whole,abs(f)>FOG_TAYLOR_BELOW);
}
/** The cubemap's colour along \`v\`, turned about the vertical: its average where the ray is shorter
 *  than the average-colour distance, its sharpest from the direct-use distance, the two blended
 *  between; a level whose weight is nil is not read. */
fn fogCubeColour(v:vec3f,span:f32)->vec3f{
 let cube=${fog(FOG_SLOT.cubemap)};
 let blend=${fog(FOG_SLOT.cubeBlend)};
 let lookup=vec3f(v.x*cube.y-v.z*cube.x,v.y,v.x*cube.x+v.z*cube.y);
 let sharp=saturate(span*blend.x+blend.y);
 if(sharp<=0.0){return fogCubeAverage(lookup);}
 if(sharp>=1.0){return fogCubeSharp(lookup);}
 return mix(fogCubeAverage(lookup),fogCubeSharp(lookup),sharp);
}
/** The colour the fog scatters along \`ray\` of length \`d\`, before its opacity: its own colour — the
 *  cubemap's tint times what the cubemap holds there — and, where an atmosphere shows, the sky's
 *  radiance times the fog's factor. What the volume lights its medium with where the fog's colours
 *  are asked for (\`./fog/scatterWgsl.ts\`). */
fn fogInscattering(ray:vec3f,d:f32,withSky:bool)->vec3f{
 var colour=${fog(FOG_SLOT.color)}.rgb;
 if(${fog(FOG_SLOT.cubemap)}.w>0.5){colour*=fogCubeColour(ray,d);}
 if(withSky){colour+=${SKY_AMBIENT};}
 return colour;
}
/** The height the eye is held to: 655 m above the base of each layer that has a density. */
fn fogHeldEye(eyeHeight:f32)->f32{
 var limit=eyeHeight;
 if(${fog(FOG_SLOT.law)}.x>0.0){limit=min(limit,${fog(FOG_SLOT.law)}.z+FOG_EYE_CEILING);}
 if(${fog(FOG_SLOT.second)}.x>0.0){limit=min(limit,${fog(FOG_SLOT.second)}.z+FOG_EYE_CEILING);}
 return limit;
}
/** The height fog along \`toP\`, the vector from the eye, at the eye's height \`eyeHeight\`. */
fn heightFogAlong(toP:vec3f,eyeHeight:f32,withSky:bool)->vec4f{
 let law=${fog(FOG_SLOT.law)};
 let range=${fog(FOG_SLOT.range)};
 let reach=${fog(FOG_SLOT.reach)};
 let second=${fog(FOG_SLOT.second)};
 let cube=${fog(FOG_SLOT.cubemap)};
 let sun=${fog(FOG_SLOT.sun)};
 let eye=fogHeldEye(eyeHeight);
 var ray=toP;
 if(reach.x>0.0){
  let horizontal=dot(ray.xz,ray.xz);
  if(horizontal>reach.x*reach.x){ray*=reach.x/sqrt(max(horizontal,1e-4));}
 }
 ray.y+=eyeHeight-eye;
 let invLength=inverseSqrt(max(dot(ray,ray),1e-8));
 let d=dot(ray,ray)*invLength;
 if(range.y>0.0&&d>range.y){return vec4f(0.0,0.0,0.0,1.0);}
 // Where the ray starts: at the eye, or past the distance the start and the volume exclude.
 let excluded=max(fogVolumeExclude(toP),range.x);
 var rayLength=d;
 var rise=ray.y;
 var startHeight=eye;
 if(excluded>0.0){
  let along=excluded*invLength;
  startHeight=eye+along*ray.y;
  rise=ray.y-along*ray.y;
  rayLength=(1.0-along)*d;
 }
 var thickness=fogLineIntegral(law.y,rise,fogOriginTerms(law,startHeight,excluded>0.0));
 if(second.x>0.0){thickness+=fogLineIntegral(second.y,rise,fogOriginTerms(second,startHeight,excluded>0.0));}
 let kept=max(saturate(exp2(-thickness*rayLength)),1.0-law.w);
 let colour=fogInscattering(ray,d,withSky);
 let fogLobe=${fog(FOG_SLOT.lobe)}.rgb*sun.w;
 var lobeColour=fogLobe;
 var secondColour=vec3f(0.0);
 if(withSky){
  lobeColour+=${SUN_ON_GROUND};
  if(${SECOND_SHOWN}){secondColour=fogLobe+${SECOND_ON_GROUND};}
 }
 var lobe=vec3f(0.0);
 // The lobes lie where a sun exists, a light of the air or the fog's own, and the fog has no cubemap.
 if(cube.w<0.5&&dot(sun.xyz,sun.xyz)>0.0&&dot(lobeColour+secondColour,vec3f(1.0))>0.0){
  let direction=ray*invLength;
  let through=saturate(exp2(-thickness*max(rayLength-range.w,0.0)));
  let scattered=INVERSE_FOUR_PI*(1.0-through);
  lobe=lobeColour*(pow(saturate(dot(direction,sun.xyz)),range.z)*scattered);
  if(${SECOND_SHOWN}){
   lobe+=secondColour*(pow(saturate(dot(direction,${air(ATMOSPHERE_SLOT.secondDirection)}.xyz)),range.z)*scattered);
  }
 }
 return vec4f(colour*(1.0-kept)+lobe,kept);
}
fn heightFog(P:vec3f,eye:vec3f,withSky:bool)->vec4f{
 return heightFogAlong(P-eye,eye.y,withSky);
}
/** \`near\` over \`behind\`: the light of the nearer, and what it lets through of the other. */
fn fogStack(near:vec4f,behind:vec4f)->vec4f{
 return vec4f(near.rgb+behind.rgb*near.a,near.a*behind.a);
}
fn fogBeyond(dir:vec3f,eye:vec3f)->vec4f{
 if(${fog(FOG_SLOT.color)}.w<${FOG_MODE.exponential - 0.5}){return vec4f(0.0,0.0,0.0,1.0);}
 let toward=dir*FOG_FAR_DEPTH;
 let over=heightFogAlong(toward,eye.y,${AIR_SHOWN});
 return fogStack(fogVolumeLookup(toward),over);
}
fn fogsBackground()->bool{return ${fog(FOG_SLOT.color)}.w>${FOG_MODE.exponential - 0.5}&&!(${AIR_SHOWN});}
fn fogOver(P:vec3f,eye:vec3f)->vec4f{
 let withSky=${AIR_SHOWN};
 let mode=${fog(FOG_SLOT.color)}.w;
 var over=vec4f(0.0,0.0,0.0,1.0);
 if(mode>${FOG_MODE.exponential - 0.5}){over=heightFog(P,eye,withSky);}
 else if(mode>${FOG_MODE.none}.5){over=linearFog(P,eye,withSky);}
 if(withSky){over=fogStack(over,aerialPerspective(P,eye));}
 if(mode>${FOG_MODE.exponential - 0.5}){over=fogStack(fogVolumeLookup(P-eye),over);}
 return over;
}
fn fogged(rgb:vec3f,P:vec3f,eye:vec3f)->vec3f{
 if(${fog(FOG_SLOT.color)}.w==${FOG_MODE.none}.0&&!(${AIR_SHOWN})){return rgb;}
 let over=fogOver(P,eye);
 return rgb*over.a+over.rgb;
}`

/** The fog's shader text over the program's own resources: \`resources\` answers the cubemap and the
 *  volume (\`fogResourcesWgsl\`, \`./fog/readWgsl.ts\`, which answers as none would what the program
 *  does not bind). */
export const fogWgsl = (resources: WgslDecl) =>
  wgslBlock(`fogWgsl(${resources.name})`, [HAZE_READ_WGSL, INVERSE_FOUR_PI, resources], FOG_TEXT)
