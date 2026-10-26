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
 * lane). Its height-fog slot (`FOG_VIEW_SLOT.heightFog`) says whether the view shows the height fog
 * (`heightFogShown`) and the sky light that lights it (`fogSkyLightStrength`, answered by the
 * program's resources like the cubemap): the in-scattering colour mixes toward the cube read along
 * the ray by the strength, the sun's lobe fades by it, and the fog's own cubemap is not read.
 */
import { INVERSE_FOUR_PI } from '../../../math/src/wgsl/constants.ts'
import { hgPhase } from '../../../math/src/wgsl/lighting.ts'
import { ATMOSPHERE_SLOT } from '../../../sdk-core/src/scene/core/atmospherePack.ts'
import { FOG_SLOT } from '../../../sdk-core/src/scene/core/fog.ts'
import { wgslBlock, type WgslDecl } from '../../../math/src/wgsl/decl.ts'
import { HAZE_READ_WGSL } from './atmosphere/hazeReadWgsl.ts'
import { VIEW_SLOT } from './atmosphere/layout.ts'
import { FOG_DEPTH_FUDGE } from './fog/layout.ts'
import { FOG_LAW_WGSL } from './fog/lawWgsl.ts'
import { AIR_SHOWN, air, fog, view } from './fogBlockAccess.ts'
import { fogComposeWgsl } from './fogCompose.ts'
import { FOG_OBSERVER_REACH, FOG_VIEW_SLOT } from './fog/viewSlots.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'

/** The sky's mean radiance at the fog's altitude, the GPU writes each image. */
const SKY_MEAN = `directLights.atmosphereView[${VIEW_SLOT.haze}].xyz`
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

/** The analytic fog: the linear ramp and the height fog along a ray (`heightFogAlong`), with the
 *  colour it scatters — its own, the cubemap's, the atmosphere's sky — and the sun's lobe. How it is
 *  laid over a point, under the haze of the air, the local fog volumes and the fog's volume, is
 *  `./fogCompose.ts`.
 *
 *  With an atmosphere the sky's mean radiance, times the fog's factor and the atmosphere's
 *  contribution, adds to the fog's colour, the sun's light on the ground to the lobe's — and where
 *  the air holds a second light, a second lobe toward it, of the fog's own colour and its light on
 *  the ground, through the same density as the first. Without one, nothing of it is read.
 *
 *  What the fog reads past the light buffer — the cubemap, the volume — is the program's
 *  (`fogWgsl`): the text it lists answers `fogCubeSharp`, `fogCubeAverage`, `fogVolumeExclude`,
 *  `fogVolumeLookup`, `fogSkyLightStrength` and `fogSkyLightColour`; a program that binds none gets
 *  the answers of no cubemap, no volume and no sky light on the fog (`fogResourcesWgsl`). */
const FOG_TEXT = `
const FOG_EYE_CEILING:f32=${wgslF32(FOG_OBSERVER_REACH)};
/** The depth the depth buffer's far value converts to: one over the tiny fudge added to its
 *  reciprocal (\`FOG_DEPTH_FUDGE\`), 10¹¹ metres. */
const FOG_FAR_DEPTH:f32=${wgslF32(1 / FOG_DEPTH_FUDGE)};
/** The least cosine between a ray and the view's forward at which the volume's end is projected
 *  along the ray (a thousandth): a ray within it of the view's plane, or behind it, has no fog excluded. */
const FOG_MIN_COSINE:f32=${wgslF32(1e-3)};
/** The line integral's expansion is taken where \`|F|\` is under this. */
const FOG_TAYLOR_BELOW:f32=0.01;
/** The fog's switches, of the view block (\`FOG_VIEW_SLOT.options\`; all zero for the defaults): whether any
 *  fog is drawn; whether the atmosphere's light adds to it, an atmosphere shown; whether it is made to
 *  match the volume. */
fn fogDrawn()->bool{return ${view(FOG_VIEW_SLOT.options)}.x==0.0;}
/** Whether the view shows the height fog (\`FOG_VIEW_SLOT.heightFog\`): not so where its \`inMainView\`, or
 *  its \`inReflectionCaptures\` in a capture of the scene, is off. */
fn heightFogShown()->bool{return ${view(FOG_VIEW_SLOT.heightFog)}.x==0.0;}
/** Whether the height fog holds its light out (\`FOG_VIEW_SLOT.holdout\`): its inscattering is then nothing
 *  and its coverage alone is left, which punches a hole in the image's alpha (\`fogHeld\`). */
fn fogHoldout()->bool{return ${view(FOG_VIEW_SLOT.holdout)}.x!=0.0;}
fn fogHeld(over:vec4f)->vec4f{return select(over,vec4f(0.0,0.0,0.0,over.a),fogHoldout());}
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
/** The density of a layer (\`fogLayerDensity\`, the law the volume's cells read too) where a ray starts, at
 *  the height \`z\`. Where the ray starts at the held eye, the exponent is held to [−125, 126], so that a
 *  layer never reads an infinity; where it starts past a distance of the eye, to its floor of −127. */
fn fogOriginTerms(layer:vec4f,z:f32,moved:bool)->f32{
 if(moved){return fogLayerDensity(layer,z,-FOG_NO_BOUND,127.0);}
 return fogLayerDensity(layer,z,-125.0,126.0);
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
 *  cubemap's tint times what the cubemap holds there, where \`own\` reads it — and, where an atmosphere
 *  shows, the sky's radiance times the fog's factor. */
fn fogInscatteringOf(ray:vec3f,d:f32,withSky:bool,own:bool)->vec3f{
 var colour=select(${fog(FOG_SLOT.color)}.rgb,${view(FOG_VIEW_SLOT.match)}.rgb,fogMatches());
 if(own&&${fog(FOG_SLOT.cubemap)}.w>0.5){colour*=fogCubeColour(ray,d);}
 if(withSky){colour+=fogSkyAmbient();}
 return colour;
}
/** The same with the fog's own cubemap read: what the volume lights its medium with where the fog's
 *  colours are asked for (\`./fog/scatterWgsl.ts\`). */
fn fogInscattering(ray:vec3f,d:f32,withSky:bool)->vec3f{return fogInscatteringOf(ray,d,withSky,true);}
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
 *  colours the fog (\`own\`: it is read) or no sun lights it. Where the atmosphere does not add to the
 *  fog, or the fog is made to match the volume, the light is not divided over the sphere; the
 *  volume's own phase function and no start distance, a lobe of no colour of its own and its light
 *  times the volume's particle colour are the match's. */
fn fogDirectional(direction:vec3f,thickness:f32,rayLength:f32,withSky:bool,own:bool)->vec3f{
 let sun=${fog(FOG_SLOT.sun)};
 let matches=fogMatches();
 let fogLobe=select(${fog(FOG_SLOT.lobe)}.rgb*sun.w,vec3f(0.0),matches);
 let second=withSky&&${SECOND_SHOWN};
 let lobeColour=fogLobe+select(vec3f(0.0),${SUN_ON_GROUND},withSky);
 let secondColour=select(vec3f(0.0),fogLobe+${SECOND_ON_GROUND},second);
 // The lobes lie where a sun exists, a light of the air or the fog's own, and the fog has no cubemap read.
 if((own&&${fog(FOG_SLOT.cubemap)}.w>=0.5)||dot(sun.xyz,sun.xyz)<=0.0||dot(lobeColour+secondColour,vec3f(1.0))<=0.0){return vec3f(0.0);}
 let start=select(${fog(FOG_SLOT.range)}.w,0.0,matches);
 let through=saturate(exp2(-thickness*max(rayLength-start,0.0)));
 let scattered=(1.0-through)*select(INVERSE_FOUR_PI,1.0,matches||${view(FOG_VIEW_SLOT.options)}.y!=0.0);
 var lobe=lobeColour*(fogLobePhase(direction,sun.xyz)*scattered);
 if(second){lobe+=secondColour*(fogLobePhase(direction,${air(ATMOSPHERE_SLOT.secondDirection)}.xyz)*scattered);}
 return lobe*select(vec3f(1.0),${view(FOG_VIEW_SLOT.albedo)}.rgb,matches);
}
/** The height fog's law along \`toP\`, the vector from the eye, at the eye's height \`eyeHeight\`, whether
 *  the view shows it or not (\`heightFogAlong\`). \`skyLit\` lets the sky light light it: with a strength
 *  above 0 (\`fogSkyLightStrength\`) the in-scattering colour is mixed toward the sky light's cube read
 *  along the ray by that share, the sun's lobe is faded by it, and the fog's own cubemap is not read. */
fn heightFogLaw(toP:vec3f,eyeHeight:f32,withSky:bool,skyLit:bool)->vec4f{
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
 let strength=select(0.0,fogSkyLightStrength(),skyLit);
 let own=strength<=0.0;
 var colour=fogInscatteringOf(ray,d,withSky,own);
 var lobe=fogDirectional(ray*invLength,thickness,rayLength,withSky,own);
 if(!own){
  colour=mix(colour,fogSkyLightColour(ray),strength);
  lobe*=1.0-strength;
 }
 return vec4f(colour*(1.0-kept)+lobe,kept);
}
/** The height fog along \`toP\` as the view shows it: none, \`(0, 0, 0, 1)\`, where the view hides it. */
fn heightFogAlong(toP:vec3f,eyeHeight:f32,withSky:bool)->vec4f{
 if(!heightFogShown()){return vec4f(0.0,0.0,0.0,1.0);}
 return fogHeld(heightFogLaw(toP,eyeHeight,withSky,true));
}
fn heightFog(P:vec3f,eye:vec3f,withSky:bool)->vec4f{
 return heightFogAlong(P-eye,eye.y,withSky);
}`

/** The fog's shader text over the program's own resources: `resources` answers the cubemap and the
 *  volume (`fogResourcesWgsl`, `./fog/readWgsl.ts`, which answers as none would what the program
 *  does not bind). It lays the local fog volumes (`./fog/localWgsl.ts`) unless `local` is false, the
 *  project switch `localFogVolumeSupport` off: the program then holds none of their code. The haze of
 *  the air is read by `haze`: from the light buffer's region, unless the program gives the read of a
 *  texture (`hazeSampledWgsl`, `./atmosphere/hazeReadWgsl.ts`). */
export const fogWgsl = (resources: WgslDecl, local = true, haze: WgslDecl = HAZE_READ_WGSL) =>
  wgslBlock(
    `fogWgsl(${resources.name}${local ? '' : ', no local fog volumes'}${haze === HAZE_READ_WGSL ? '' : `, ${haze.name}`})`,
    [haze, INVERSE_FOUR_PI, hgPhase, FOG_LAW_WGSL, fogComposeWgsl(local), resources],
    FOG_TEXT,
  )
