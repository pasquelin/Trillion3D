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
 *
 * The view block (`FOG_VIEW_SLOT`, all zero for the defaults) holds the switches of the fog as a
 * whole: none is drawn (`fogDrawn`); the atmosphere's light is left out of it (`fogSkyShown`: the
 * sky's colour, the sun's and the second light's on the ground, and the division of the lobe over the
 * sphere); it is made to match the volume (`fogMatches`: the volume's glow for its colour, the
 * volume's phase function from the start for its lobe, the volume's particle colour on its light);
 * and an orthographic view measures the fog from its own height (`fogOriginHeight`, the observer's
 * lane).
 */
import { INVERSE_FOUR_PI } from '../../../math/src/wgsl/constants.ts'
import { hgPhase } from '../../../math/src/wgsl/lighting.ts'
import { ATMOSPHERE_SLOT } from '../../../sdk-core/src/scene/core/atmospherePack.ts'
import { FOG_MODE, FOG_SLOT } from '../../../sdk-core/src/scene/core/fog.ts'
import { wgslBlock, type WgslDecl } from '../../../math/src/wgsl/decl.ts'
import { HAZE_READ_WGSL } from './atmosphere/hazeReadWgsl.ts'
import { VIEW_SLOT } from './atmosphere/layout.ts'
import { FOG_DEPTH_FUDGE } from './fog/layout.ts'
import { FOG_VIEW_SLOT } from './fog/viewSlots.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'

const fog = (slot: number) => `directLights.fog[${slot}]`
const air = (slot: number) => `directLights.atmosphere[${slot}]`
const view = (slot: number) => `directLights.fogView[${slot}]`
/** The sky's mean radiance at the fog's altitude, the GPU writes each image. */
const SKY_MEAN = `directLights.atmosphereView[${VIEW_SLOT.haze}].xyz`
/** Whether an atmosphere shows: its planet's block is written. */
const AIR_SHOWN = `${air(ATMOSPHERE_SLOT.planet)}.x!=0.0`
/** What the atmosphere gives the fog of the sky: its mean radiance, the atmosphere's contribution
 *  and the fog's own factor — a fog made to match the volume takes it times the volume's particle
 *  colour (\`fogSkyAmbient\`). */
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
 *  then the transmittance from the eye to `P`; no fog adds nothing and keeps everything —
 *  `fogOverNoHaze`: the same without the haze of the air, for a layer that lays the haze itself — and
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
/** The depth the depth buffer's far value converts to: one over the tiny fudge added to its
 *  reciprocal (\`FOG_DEPTH_FUDGE\`), 10¹¹ metres. */
const FOG_FAR_DEPTH:f32=${wgslF32(1 / FOG_DEPTH_FUDGE)};
/** The least cosine between a ray and the view's forward at which the volume's end is projected
 *  along the ray (a 32-bit float's epsilon): a ray at or behind the view's plane has no fog excluded. */
const FOG_MIN_COSINE:f32=${wgslF32(2 ** -23)};
/** The line integral's expansion is taken where \`|F|\` is under this. */
const FOG_TAYLOR_BELOW:f32=0.01;
/** The fog's switches, of the view block (\`FOG_VIEW_SLOT.options\`; all zero for the defaults): whether any
 *  fog is drawn; whether the atmosphere's light adds to it, an atmosphere shown; whether it is made to
 *  match the volume. */
fn fogDrawn()->bool{return ${view(FOG_VIEW_SLOT.options)}.x==0.0;}
fn fogSkyShown()->bool{return ${AIR_SHOWN}&&${view(FOG_VIEW_SLOT.options)}.y==0.0;}
fn fogMatches()->bool{return ${view(FOG_VIEW_SLOT.options)}.z!=0.0;}
/** The sky's light on the fog's colour: the atmosphere's, times the volume's particle colour where the
 *  fog is made to match the volume. */
fn fogSkyAmbient()->vec3f{
 return ${SKY_AMBIENT}*select(vec3f(1.0),${view(FOG_VIEW_SLOT.albedo)}.rgb,fogMatches());
}
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
 var colour=select(${fog(FOG_SLOT.color)}.rgb,${view(FOG_VIEW_SLOT.match)}.rgb,fogMatches());
 if(${fog(FOG_SLOT.cubemap)}.w>0.5){colour*=fogCubeColour(ray,d);}
 if(withSky){colour+=fogSkyAmbient();}
 return colour;
}
/** The height the observer may not rise above: the least, over the layers that have a density, of 655 m
 *  above their base — an orthographic view that measures the fog from its position (the view block's
 *  observer lane) rises by its own height instead —; huge where no layer has one. */
fn fogObserverLimit()->f32{
 var limit=3.0e38;
 let reach=FOG_EYE_CEILING+${view(FOG_VIEW_SLOT.observer)}.x;
 if(${fog(FOG_SLOT.law)}.x>0.0){limit=min(limit,${fog(FOG_SLOT.law)}.z+reach);}
 if(${fog(FOG_SLOT.second)}.x>0.0){limit=min(limit,${fog(FOG_SLOT.second)}.z+reach);}
 return limit;
}
/** The height the eye is held to: that of the observer's limit. */
fn fogHeldEye(eyeHeight:f32)->f32{return min(eyeHeight,fogObserverLimit());}
/** The height the layers' densities are taken at where the ray starts at the eye: the held eye's — for an
 *  orthographic view that measures the fog from its position, the observer's limit, where a layer
 *  has a density. */
fn fogOriginHeight(held:f32)->f32{
 let limit=fogObserverLimit();
 return select(held,limit,${view(FOG_VIEW_SLOT.options)}.w!=0.0&&limit<3.0e37);
}
/** The phase of the sun's lobe along \`direction\`, a unit vector from the eye, toward the light \`toLight\`: a
 *  power of the cosine, the phase function of the volume where the fog is made to match it. */
fn fogLobePhase(direction:vec3f,toLight:vec3f)->f32{
 if(fogMatches()){return hgPhase(${view(FOG_VIEW_SLOT.match)}.w,dot(-direction,toLight));}
 return pow(saturate(dot(direction,toLight)),${fog(FOG_SLOT.range)}.z);
}
/** The light the sun scatters in the fog along a ray of \`rayLength\` and \`direction\`, \`thickness\` the line
 *  integral per metre: the fog's lobe colour and, where the atmosphere adds to it, the sun's light on
 *  the ground — and the air's second light's, a second lobe — over the sphere, none where a cubemap
 *  colours the fog or no sun lights it. Where the atmosphere does not add to the fog, or the fog is made
 *  to match the volume, the light is not divided over the sphere; the volume's own phase function and
 *  no start distance, a lobe of no colour of its own and its light times the volume's particle colour
 *  are the match's. */
fn fogDirectional(direction:vec3f,thickness:f32,rayLength:f32,withSky:bool)->vec3f{
 let sun=${fog(FOG_SLOT.sun)};
 let matches=fogMatches();
 let fogLobe=select(${fog(FOG_SLOT.lobe)}.rgb*sun.w,vec3f(0.0),matches);
 let second=withSky&&${SECOND_SHOWN};
 let lobeColour=fogLobe+select(vec3f(0.0),${SUN_ON_GROUND},withSky);
 let secondColour=select(vec3f(0.0),fogLobe+${SECOND_ON_GROUND},second);
 // The lobes lie where a sun exists, a light of the air or the fog's own, and the fog has no cubemap.
 if(${fog(FOG_SLOT.cubemap)}.w>=0.5||dot(sun.xyz,sun.xyz)<=0.0||dot(lobeColour+secondColour,vec3f(1.0))<=0.0){return vec3f(0.0);}
 let start=select(${fog(FOG_SLOT.range)}.w,0.0,matches);
 let through=saturate(exp2(-thickness*max(rayLength-start,0.0)));
 let scattered=(1.0-through)*select(INVERSE_FOUR_PI,1.0,matches||${view(FOG_VIEW_SLOT.options)}.y!=0.0);
 var lobe=lobeColour*(fogLobePhase(direction,sun.xyz)*scattered);
 if(second){lobe+=secondColour*(fogLobePhase(direction,${air(ATMOSPHERE_SLOT.secondDirection)}.xyz)*scattered);}
 return lobe*select(vec3f(1.0),${view(FOG_VIEW_SLOT.albedo)}.rgb,matches);
}
/** The height fog along \`toP\`, the vector from the eye, at the eye's height \`eyeHeight\`. */
fn heightFogAlong(toP:vec3f,eyeHeight:f32,withSky:bool)->vec4f{
 let law=${fog(FOG_SLOT.law)};
 let range=${fog(FOG_SLOT.range)};
 let reach=${fog(FOG_SLOT.reach)};
 let second=${fog(FOG_SLOT.second)};
 let eye=fogHeldEye(eyeHeight);
 var ray=toP;
 if(reach.x>0.0){
  let horizontal=dot(ray.xz,ray.xz);
  if(horizontal>reach.x*reach.x){ray*=reach.x/sqrt(max(horizontal,1e-4));}
 }
 ray.y+=eyeHeight-eye;
 let invLength=inverseSqrt(max(dot(ray,ray),1e-12));
 let d=dot(ray,ray)*invLength;
 if(range.y>0.0&&d>range.y){return vec4f(0.0,0.0,0.0,1.0);}
 // Where the ray starts: at the eye, or past the distance the start and the volume exclude, and the
 // view's clip plane where it lies between the eye and the point. The plane is held relative to the
 // eye (\`w\` the plane's offset at the eye, \`FOG_VIEW_SLOT.clipPlane\`), so that the held observer is at
 // \`w + normal.y * (eye - eyeHeight)\`; a view without a plane, all zero, leaves the fog as it is.
 var excluded=max(fogVolumeExclude(toP),range.x);
 let plane=directLights.fogView[${FOG_VIEW_SLOT.clipPlane}];
 if(any(plane.xyz!=vec3f(0.0))){
  let time=-(plane.w+plane.y*(eye-eyeHeight))/dot(ray,plane.xyz);
  if(time>0.0&&time<1.0){excluded=max(excluded,time*d);}
 }
 var rayLength=d;
 var rise=ray.y;
 var startHeight=fogOriginHeight(eye);
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
 let lobe=fogDirectional(ray*invLength,thickness,rayLength,withSky);
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
 if(!fogDrawn()||${fog(FOG_SLOT.color)}.w<${FOG_MODE.exponential - 0.5}){return vec4f(0.0,0.0,0.0,1.0);}
 let toward=dir*FOG_FAR_DEPTH;
 let over=heightFogAlong(toward,eye.y,fogSkyShown());
 return fogStack(fogVolumeLookup(toward),over);
}
fn fogsBackground()->bool{return fogDrawn()&&${fog(FOG_SLOT.color)}.w>${FOG_MODE.exponential - 0.5}&&!(${AIR_SHOWN});}
fn fogOver(P:vec3f,eye:vec3f)->vec4f{return fogLaid(P,eye,true);}
fn fogOverNoHaze(P:vec3f,eye:vec3f)->vec4f{return fogLaid(P,eye,false);}
fn fogLaid(P:vec3f,eye:vec3f,haze:bool)->vec4f{
 var over=vec4f(0.0,0.0,0.0,1.0);
 if(!fogDrawn()){return over;}
 let withSky=fogSkyShown();
 let mode=${fog(FOG_SLOT.color)}.w;
 if(mode>${FOG_MODE.exponential - 0.5}){over=heightFog(P,eye,withSky);}
 else if(mode>${FOG_MODE.none}.5){over=linearFog(P,eye,withSky);}
 if(haze&&${AIR_SHOWN}){over=fogStack(over,aerialPerspective(P,eye));}
 if(mode>${FOG_MODE.exponential - 0.5}){over=fogStack(fogVolumeLookup(P-eye),over);}
 return over;
}
/** The fog \`over\` seen at the pixel \`pixel\` of the scene, its inscattering multiplied by the light
 *  shafts' occlusion mask there (\`lightShaftMask\`, \`./fog/readWgsl.ts\`): the whole fog's — the
 *  height fog, the volume and the haze laid with them —, its transmittance as it is; and
 *  \`fogBeyondAt\`, the same over the sky's pixels. */
fn fogShafted(over:vec4f,pixel:vec2f)->vec4f{return vec4f(over.rgb*lightShaftMask(pixel),over.a);}
fn fogBeyondAt(dir:vec3f,eye:vec3f,pixel:vec2f)->vec4f{return fogShafted(fogBeyond(dir,eye),pixel);}
/** \`fogged\` for an opaque surface at the pixel \`pixel\`: the haze is left out where it is marched for
 *  each pixel instead. */
fn foggedOpaque(rgb:vec3f,P:vec3f,eye:vec3f,pixel:vec2f)->vec3f{
 if(${fog(FOG_SLOT.color)}.w==${FOG_MODE.none}.0&&!(${AIR_SHOWN})){return rgb;}
 let over=fogShafted(fogLaid(P,eye,!opaqueHazeMarched()),pixel);
 return rgb*over.a+over.rgb;
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
  wgslBlock(
    `fogWgsl(${resources.name})`,
    [HAZE_READ_WGSL, INVERSE_FOUR_PI, hgPhase, resources],
    FOG_TEXT,
  )
