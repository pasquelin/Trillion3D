import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { PIXEL_MODEL, pixelModelOf } from '../../../materials/surface/pixelModel.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { lightTraits } from '../../direct/lightReachWgsl.ts'
import { DENOISE_COMMON_WGSL } from '../../screenSpaceTracing/denoise/signalWgsl.ts'
import { SCREEN_SPACE_GROUP } from '../../screenSpaceTracing/screenSpaceView.ts'

/** The shadow denoiser's bindings beside the screen-space group's and the denoiser's (`DENOISE_BINDINGS`): the light buffer. */
export const SHADOW_DENOISE_BINDINGS = { lights: 27 } as const

/** The distance a trace stores for a pixel where no ray was cast, and where no ray was blocked (shared by the trace and the denoiser's injestion). */
export const SHADOW_HIT_INVALID = -2
export const SHADOW_HIT_MISS = -1

/** The farthest radius a sample blurs by when its rays all arrived, in metres (a hundred thousand centimetres). */
const SHADOW_RADIUS_MISS = 1000

/** The signal a denoiser run filters: a light's ray-traced shadow, or the ray-traced ambient occlusion. */
export type DenoiseSignalKind = 'shadow' | 'occlusion'

/**
 * THE PARTS EVERY SIGNAL SHARES: the sample a texel holds, the surface of a pixel of this image or of the one before, and the accumulator of a kernel in descending ring order.
 *
 * - A texel of the signal is four floats: the share of the rays that arrived, the number of samples, the radius the sample blurs by (in metres: `-1` for none, `SHADOW_RADIUS_MISS`
 *   where every ray arrived) and a fourth that stays zero. A texel the trace cast no ray for has no sample.
 * - The accumulator takes the samples ring by ring from the outside in; a ring whose samples blur by less than the next ring's (a blocker nearer the pixel) covers it by its opacity.
 *   Its output is the sum it ended with, the least radius met.
 *
 * What differs by signal is declared beside it (`SHADOW_SIGNAL_WGSL`, `OCCLUSION_SIGNAL_WGSL`), under the same names: `SdLight` and `sdLight()` (what the run knows beyond the pixels), `sdSpatialWeight`
 * (the weight of a tap of the spatial passes) and `sdHistoryWeight` (the weight of a tap of the last image's history, and of the temporal passes' neighbourhood).
 */
const SHARED_WGSL = wgslBlock(
  'SD_SHARED_WGSL',
  [DENOISE_COMMON_WGSL],
  `const SD_RADIUS_INVALID:f32=-1.0;
const SD_RADIUS_MISS:f32=${SHADOW_RADIUS_MISS}.0;
/** The flags of a surface that has no place in the world (the last image's point behind its eye). */
const SD_SURFACE_LOST:u32=0xffffffffu;
/** A sample: its count and the count of its rays that arrived. */
struct SdSample{n:f32,m:f32,r:f32,}
/** The sample of a texel of the signal (the share, the count, the radius). */
fn sdTap(texel:vec2i)->SdSample{
 let t=clamp(texel,vec2i(dnParams.rect.xy),vec2i(dnParams.rect.zw)-vec2i(1));
 let v=textureLoad(sourceA,t,0);
 return SdSample(v.g,v.r*v.g,v.b);
}
/** Whether a position lies where the pass does not read, past the centres of the first and last texels of the rect it works over (the light's screen rect). */
fn sdOutside(pos:vec2f)->bool{return any(pos<dnParams.rect.xy+vec2f(0.5))||any(pos>dnParams.rect.zw-vec2f(0.5));}
/** The pixel of a thread of the pass, its cell counted from the rect's first texel. */
fn sdPixelOf(cell:vec2u)->vec2u{return cell+vec2u(dnParams.rect.xy);}
fn sdEncode(n:f32,m:f32,r:f32)->vec4f{return vec4f(m*safeRcp(n),n,r,0.0);}
/** The surface of a pixel of this image (the world point, the view depth, the normal, the surface flags). */
struct SdSurface{P:vec3f,depth:f32,N:vec3f,flags:u32,}
fn sdSurfaceAt(p:vec2i)->SdSurface{
 let pixel=clampToExtent(p,vec2i(ssView.size.xy));
 let z=max(hizOpaqueDepth(pixel),1e-8);
 let normal=textureLoad(surfaceNormals,pixel,0);
 return SdSurface(ssWorldAt(ssScreenOfPixel(vec2f(pixel)+vec2f(0.5)),z),ssSceneDepth(z),normalize(normal.xyz),textureLoad(surfaceFlags,pixel,0).r);
}
/** The distance the world blurs by at a pixel of the view depth depth, twice its radius times the root of two (the furthest pixel of a three by three). */
fn sdAmend(radius:f32)->f32{return radius*2.8284271;}
/** A kernel's accumulator in descending ring order: the ring being taken (n, m, the radius sum, the translucency sum), what the rings after hold (previous), the width of a ring and the
 *  least radius met. */
struct SdRings{cn:f32,cm:f32,cr:f32,ct:f32,pn:f32,pm:f32,pr:f32,border:f32,highest:f32,least:f32,}
fn sdRingsNew()->SdRings{return SdRings(0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,SD_RADIUS_MISS);}
/** Starts a ring of outer boundary outer pixels: its border is that many pixels' width (and one) of the surface. */
fn sdRingStart(a:ptr<function,SdRings>,base:SdSurface,outer:f32){
 (*a).border=sdAmend(ssPixelRadius(base.depth))*(outer+1.0);
 (*a).highest=(*a).border*2.0;
 (*a).cn=0.0;(*a).cm=0.0;(*a).cr=0.0;(*a).ct=0.0;
}
/** A sample of weight w and radius r into the ring being taken or the ones before it, by which side of the border its radius falls. */
fn sdRingAdd(a:ptr<function,SdRings>,s:SdSample,w:f32){
 if(w>0.0&&s.r!=SD_RADIUS_INVALID){(*a).least=min((*a).least,s.r);}
 let clamped=min(s.r,(*a).highest);
 let later=saturate(clamped-(*a).border+0.5);
 let wc=w*(1.0-later);
 (*a).cn+=s.n*wc;(*a).cm+=s.m*wc;(*a).cr+=s.n*clamped*wc;
 (*a).ct+=mix(s.m*safeRcp(s.n),1.0,saturate(clamped-(*a).border));
 let wp=w*later;
 (*a).pn+=s.n*wp;(*a).pm+=s.m*wp;(*a).pr+=s.n*clamped*wp;
}
/** Ends the ring: it covers what the rings after it hold by its opacity where its radius is the smaller (a blocker nearer the pixel), and joins it. */
fn sdRingEnd(a:ptr<function,SdRings>,count:u32){
 if((*a).cn==0.0){return;}
 let opacity=saturate(1.0-(*a).ct/f32(count));
 let later=(*a).pr*safeRcp((*a).pn);
 let current=(*a).cr/(*a).cn;
 let covering=saturate((later-current)/(*a).border);
 let keep=select(1.0-opacity*covering,0.0,(*a).pn==0.0);
 (*a).pn=(*a).pn*keep+(*a).cn;
 (*a).pm=(*a).pm*keep+(*a).cm;
 (*a).pr=(*a).pr*keep+(*a).cr;
}`,
)

/**
 * THE SHADOW SIGNAL: the light of the run and what it blurs by, and the bilateral weight between two surfaces.
 *
 * - The radius a hit gives a sample: the light's size seen from the pixel at the distance of the nearest blocker (a sun's disk times the distance, a lamp's radius (a tube's, with its half length across the view), a rectangle's
 *   smaller side, each over the distance from the blocker to the light); the penumbra there.
 * - The bilateral weight keeps what is near the pixel in the plane of the light's tangent, within the sample's radius, and near its plane, and agrees with its normal.
 */
const SHADOW_SIGNAL_WGSL = wgslBlock(
  'SD_SHADOW_SIGNAL_WGSL',
  [SHARED_WGSL, DIRECT_LIGHT_WGSL, lightTraits, pixelModelOf],
  `@group(${SCREEN_SPACE_GROUP}) @binding(${SHADOW_DENOISE_BINDINGS.lights}) var<storage,read> directLights:DirectLights;
const SD_HIT_INVALID:f32=${SHADOW_HIT_INVALID}.0;
const SD_HIT_MISS:f32=${SHADOW_HIT_MISS}.0;
const SD_PROFILE:u32=${PIXEL_MODEL.profile}u;
/** The light of the run (its rank is the parameters' time z), what of it the denoiser reads. */
struct SdLight{sun:bool,position:vec3f,axis:vec3f,radius:f32,tangent:f32,tubeHalf:f32,}
fn sdLight()->SdLight{
 let light=directLights.items[u32(dnParams.time.z)];
 if(isSun(light)){
  let s=sourceTermOf(light);
  return SdLight(true,vec3f(0.0),-light.directionCone.xyz,s,s*inverseSqrt(max(1.0-s*s,1e-12)),0.0);
 }
 if(isRect(light)){
  return SdLight(false,light.positionRange.xyz,light.directionCone.xyz,2.0*min(length(light.shape.xyz),light.shape.w),0.0,0.0);
 }
 return SdLight(false,light.positionRange.xyz,emitterAxisOf(light),light.shape.x,0.0,tubeHalfLengthOf(light));
}
/** The unit direction from a point to the light. */
fn sdToward(light:SdLight,P:vec3f)->vec3f{return select(normalize(light.position-P),light.axis,light.sun);}
/** The radius a sample at P blurs by, from the distance of the nearest blocker hit: none for a texel with no ray, the greatest where all arrived. */
fn sdBlurRadius(light:SdLight,P:vec3f,hit:f32)->f32{
 if(hit==SD_HIT_INVALID){return SD_RADIUS_INVALID;}
 if(hit==SD_HIT_MISS){return SD_RADIUS_MISS;}
 if(light.sun){return min(light.tangent*hit,SD_RADIUS_MISS);}
 // A tube is seen as wide as its radius and the part of its half length across the view from the pixel.
 let size=light.radius+light.tubeHalf*length(cross(light.axis,normalize(light.position-P)));
 // A blocker nearly at the light would blur without bound (past what the history's half floats hold): it blurs no wider than a ray that arrived.
 return min(size*hit/max(distance(light.position,P)-hit,0.001),SD_RADIUS_MISS);
}
/** The weight of a neighbour nb of the surface base within dist (the sample's radius): the light-tangent distance, the plane distance and the normals' agreement. A negative
 *  distance (a reference with no sample) stands for the reach of the reference pixel itself, so that the plane and the depth still reject across edges. */
fn sdBilateral(light:SdLight,dist:f32,base:SdSurface,nb:SdSurface)->f32{
 let reach=select(dist,sdAmend(ssPixelRadius(base.depth)),dist<0.0);
 let reciprocal=1.0/select(reach,1e-6,reach==0.0);
 let toRef=base.P-nb.P;
 let toLight=sdToward(light,nb.P);
 let across=toRef-toLight*dot(toLight,toRef);
 let tangential=saturate(1.0-dot(across,across)*reciprocal*reciprocal);
 let penalised=(pixelModelOf(base.flags)==SD_PROFILE)&&light.radius>0.0;
 let error=select(-0.25,light.radius,penalised);
 let height=dot(base.N,-toRef);
 let planar=length(-toRef-height*base.N)*error;
 let plane=saturate(1.0-6.0*(abs(height)+planar)*reciprocal);
 return tangential*plane*pow(max(dot(base.N,nb.N),0.0),4.0);
}
/** The weight of a tap of the spatial passes, the bilateral weight within the least of the sample's radius and the pixel's own. */
fn sdSpatialWeight(light:SdLight,s:SdSample,least:f32,base:SdSurface,nb:SdSurface)->f32{return sdBilateral(light,min(s.r,least),base,nb);}
/** The weight of a tap of the history, within dist. */
fn sdHistoryWeight(light:SdLight,dist:f32,base:SdSurface,nb:SdSurface)->f32{return sdBilateral(light,dist,base,nb);}`,
)

/**
 * THE OCCLUSION SIGNAL: the run knows nothing beyond the pixels, a sample's radius is the distance of the nearest blocker its rays found, and the bilateral weights are a position term
 * and the normals' agreement:
 * - the spatial passes: the squared distance between the two points over the square of the reach, 1 minus it, the reach being the pixel reach of the least of the two pixels' radii;
 * - the history and the neighbourhood of the temporal passes: the distance of the neighbour to the plane of the pixel over the reach, 1 minus it.
 */
const OCCLUSION_SIGNAL_WGSL = wgslBlock(
  'SD_OCCLUSION_SIGNAL_WGSL',
  [SHARED_WGSL],
  `struct SdLight{none:f32,}
fn sdLight()->SdLight{return SdLight(0.0);}
fn sdNormalsAgree(base:SdSurface,nb:SdSurface)->f32{return pow(max(dot(base.N,nb.N),0.0),4.0);}
fn sdSpatialWeight(light:SdLight,s:SdSample,least:f32,base:SdSurface,nb:SdSurface)->f32{
 let reach=sdAmend(min(ssPixelRadius(nb.depth),ssPixelRadius(base.depth)));
 let toRef=base.P-nb.P;
 return saturate(1.0-dot(toRef,toRef)/(reach*reach))*sdNormalsAgree(base,nb);
}
fn sdHistoryWeight(light:SdLight,dist:f32,base:SdSurface,nb:SdSurface)->f32{
 return saturate(1.0-abs(dot(base.N,base.P-nb.P))/dist)*sdNormalsAgree(base,nb);
}`,
)

/** The shared parts of a signal's denoiser passes: what every signal shares and the signal's own. */
export const SHADOW_DENOISE_COMMON_WGSL = wgslBlock(
  'SHADOW_DENOISE_COMMON_WGSL',
  [SHARED_WGSL, SHADOW_SIGNAL_WGSL],
  '',
)
export const OCCLUSION_DENOISE_COMMON_WGSL = wgslBlock(
  'OCCLUSION_DENOISE_COMMON_WGSL',
  [SHARED_WGSL, OCCLUSION_SIGNAL_WGSL],
  '',
)
const COMMONS = {
  shadow: SHADOW_DENOISE_COMMON_WGSL,
  occlusion: OCCLUSION_DENOISE_COMMON_WGSL,
} as const
/** The shared parts of the passes of `signal`. */
export const denoiseCommonOf = (signal: DenoiseSignalKind) => COMMONS[signal]
