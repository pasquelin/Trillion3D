import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { PI } from '../../../../../math/src/wgsl/constants.ts'
import { fastAcos } from '../../../../../math/src/wgsl/geometry.ts'
import { makeFinite3 } from '../../../../../math/src/wgsl/integer.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { frameAround, outOfFrame } from '../../../../../math/src/wgsl/basis.ts'
import {
  fourRooksJitter,
  interleavedGradientNoise,
  sampleCosineHemisphere,
} from '../../../../../math/src/wgsl/sampling.ts'
import { screenTraceDepthThresholdScale } from '../../distanceField/representationWgsl.ts'
import { computeStorageTextureEntry } from '../../../gpu/core/computeBindings.ts'
import { blueNoiseWgsl } from '../../../gpu/noise/blueNoiseWgsl.ts'
import { spCommon, spParams } from './commonWgsl.ts'
import { SP_FIXED_CAST, SP_HIT_HISTORY } from './traceWgsl.ts'
import { SP_BENT_WGSL, spHistoryDepth } from './historyWgsl.ts'
import { spVectors } from './vectorsWgsl.ts'
import { spSurface } from './probesWgsl.ts'
import { SCREEN_PROBE_FORMATS as F, bindingTable } from './screenProbeLayout.ts'

/** The occlusion's bindings: the image's normals and flags beside its depth, the occlusion written (as `F.occlusion` says; with the
 *  bent normal, `occlusionEntries` binds it as `F.bentOcclusion`). */
export const OCCLUSION_BINDINGS = bindingTable({
  params: [0, 'uniform'],
  normals: [1, 'float'],
  flags: [2, 'uint'],
  occlusion: [3, { store: F.occlusion }],
  blue: [4, 'float'],
  vectors: [5, 'uint'],
  keptDepth: [6, 'float'],
  shortRangeGi: [7, { store: F.shortRangeGi }],
})

const B = OCCLUSION_BINDINGS.at

/** The layout of the occlusion's group: its amount alone, or, with the bent normal, the word that holds the direction of the open sky too; with the short-range global illumination, the surfaces'
 *  vectors, the depth the last image kept and the colour written. */
export const occlusionEntries = (bentNormal: boolean, shortRangeGi: boolean) =>
  OCCLUSION_BINDINGS.entries
    .filter((entry) => shortRangeGi || entry.binding < B.vectors)
    .map((entry) =>
      entry.binding === B.occlusion && bentNormal
        ? computeStorageTextureEntry(B.occlusion, F.bentOcclusion)
        : entry,
    )

/** What a level sets of the occlusion, beside the constants it shares. */
export interface OcclusionShape {
  /** Pixels a thread stands for along an axis: 1, or 2 where the occlusion is half the image's size. */
  downsample: number
  /** Whether the horizon search reads the depth pyramid's first level rather than the depth. */
  pyramid: boolean
  /** The power the foreground occluders' share is raised to. */
  power: number
  /** Whether the pass keeps the direction of the open sky, the bent normal, beside the amount of it. */
  bentNormal: boolean
  /** Whether the horizon search keeps a bitmask of the sectors of the slice the samples occlude (`screenProbeOcclusionVisibilityBitmask`), not the highest horizon of each side. */
  bitmask: boolean
  /** The rays a pixel casts over the furthest depth where the occlusion is the stochastic hemisphere's (`screenProbeOcclusionHorizonSearch` off), none for the horizon search. */
  rays: number
  /** Whether the pass also gathers the light of the near surfaces of the last image (`screenProbeShortRangeGI`). */
  gi: boolean
  /** The scale of the slope tolerance of those rays (`screenProbeOcclusionSlopeCompareToleranceScale`). */
  slope: number
}

/**
 * THE HORIZON OF A SIDE after a sample (`spHorizonCos`): the cosine of its angle from the view vector, held to `low` by the share
 * the sample is in front — a sample nearer the eye than the foreground fraction of the pixel's depth, whose horizon falls to the
 * lowest one the normal allows, raised to the foreground power (a wall in front of the search is not what occludes the
 * surface behind it) —, the higher of it and the horizon so far.
 */
const SP_HORIZON = (shape: OcclusionShape) =>
  wgslBlock(
    `SP_HORIZON(${shape.pyramid}, ${shape.power})`,
    [],
    `const SP_FOREGROUND_POWER:f32=${shape.power};
fn spOcclusionDepth(pix:vec2i)->f32{
 ${shape.pyramid ? 'return hizCellCullFarthest(pix/vec2i(2),1);' : 'return hizOpaqueDepth(pix);'}
}
fn spHorizonCos(at:vec2f,P:vec3f,V:vec3f,depth:f32,invForeground:f32,low:f32,current:f32)->f32{
 if(any(at<=vec2f(0.0))||any(at>=vec2f(sp.size.xy))){return current;}
 let z=spOcclusionDepth(vec2i(floor(at)));
 if(z<=0.0){return current;}
 let Q=worldAt(at,z);
 let delta=Q-P;
 let cosine=dot(delta/max(length(delta),1e-6),V);
 let held=mix(cosine,low,saturate(pow(abs(spDepthOf(Q)-depth)*invForeground,SP_FOREGROUND_POWER)));
 return max(current,held);
}`,
  )

/**
 * THE LIGHT A SAMPLE GIVES (`spHorizonLight`), the short-range global illumination's step (`UpdateOccludedHorizonForStep`): a sample of the depth at \`at\`, its point \`Q\`, raises the light's horizon
 * (`lit`, the cosine of its angle from the view vector `V`) when its direction \`toSample\` is above it; the share of the horizon it raises (the angles' difference over pi), the cosine of the
 * pixel's normal with the direction, a fade for the samples in front of the search (twice the foreground distance) and the search's own (`fade`) weigh the colour the last image lit it with
 * (`spSampleColor`) by the cosine of the sample's normal with the way back; the colour joins the light in \`xyz\`, the horizon so far in \`w\`.
 */
const SP_HORIZON_LIGHT = wgslBlock(
  'SP_HORIZON_LIGHT',
  [PI, fastAcos, SP_HIT_HISTORY, interleavedGradientNoise, makeFinite3],
  `/** The colour of the last image at the sample: the light it lit it with, taken out of its pre-exposure, kept where the sample is in view of both images, the last image agrees with the depth
 *  it expects there (the history thickness of the light, widened or narrowed by the noise), and held to the most a sample adds. */
fn spSampleColor(at:vec2f,Q:vec3f,z:f32)->vec3f{
 let noise=interleavedGradientNoise(at,f32(sp.frames.x%8u));
 let previous=spHitHistory(vec3f(at,z),Q,noise);
 if(!previous.kept){return vec3f(0.0);}
 if(spDeviceGap(spKeptDepth(previous.texel),previous.expected)>=sp.gi.w*mix(0.5,2.0,noise)){return vec3f(0.0);}
 var colour=max(makeFinite3(textureLoad(reflectionImage,previous.texel,0).rgb),vec3f(0.0))*reflectionView.radiance.w;
 let strongest=max(colour.x,max(colour.y,colour.z));
 if(strongest>sp.gi.z){colour*=sp.gi.z/strongest;}
 return colour;
}
fn spHorizonLight(at:vec2f,s:SpSurface,V:vec3f,depth:f32,invForeground:f32,fade:f32,lit:f32)->vec4f{
 if(any(at<=vec2f(0.0))||any(at>=vec2f(sp.size.xy))){return vec4f(0.0,0.0,0.0,lit);}
 let z=spOcclusionDepth(vec2i(floor(at)));
 if(z<=0.0){return vec4f(0.0,0.0,0.0,lit);}
 let Q=worldAt(at,z);
 let delta=Q-s.P;
 let toSample=delta/max(length(delta),1e-6);
 let cosine=dot(toSample,V);
 var light=vec3f(0.0);
 if(cosine>lit){
  let visibility=abs(fastAcos(cosine)-fastAcos(lit))/PI*saturate(dot(s.N,toSample))*(1.0-saturate(abs(spDepthOf(Q)-depth)*invForeground*2.0-1.0));
  if(visibility>0.0){
   let cosineBack=saturate(dot(spSurfaceAt(vec2u(floor(at))).N,-toSample));
   if(cosineBack>0.0){light=spSampleColor(at,Q,z)*(cosineBack*visibility*fade);}
  }
 }
 return vec4f(light,max(lit,cosine));
}`,
)

/**
 * THE OCCLUDED SECTORS OF A SAMPLE (\`spOccludedSectors\`), the visibility bitmask's step: the sample's surface is given a thickness (\`thickness\`, behind it along the view vector), the angles
 * from the view vector of its front and its back, turned into the slice's angle fractions (the side \`direction\`, ±1, and the normal's angle \`angle\`), and the sectors of the 32 the slice
 * is cut in that lie between the two set: a mask the caller ors over the samples, so that a thin occluder leaves the sectors beside it open.
 */
const SP_SECTORS = wgslBlock(
  'SP_SECTORS',
  [PI, fastAcos],
  `const SP_SECTOR_COUNT:u32=32u;
fn spSectorMask(low:f32,high:f32)->u32{
 let start=u32(low*f32(SP_SECTOR_COUNT));
 let width=u32(ceil((high-low)*f32(SP_SECTOR_COUNT)));
 if(width==0u||start>=SP_SECTOR_COUNT){return 0u;}
 return (0xFFFFFFFFu>>(SP_SECTOR_COUNT-min(width,SP_SECTOR_COUNT)))<<start;
}
fn spOccludedSectors(at:vec2f,P:vec3f,V:vec3f,thickness:f32,direction:f32,angle:f32)->u32{
 if(any(at<=vec2f(0.0))||any(at>=vec2f(sp.size.xy))){return 0u;}
 let z=spOcclusionDepth(vec2i(floor(at)));
 if(z<=0.0){return 0u;}
 let delta=worldAt(at,z)-P;
 let front=fastAcos(dot(normalize(delta),V));
 let back=fastAcos(dot(normalize(delta-V*thickness),V));
 let fractions=saturate((direction*-vec2f(front,back)+angle+0.5*PI)/PI);
 let ordered=select(fractions,fractions.yx,direction>0.0);
 return spSectorMask(ordered.x,ordered.y);
}`,
)

/**
 * THE STOCHASTIC HEMISPHERE (\`spStochasticAo\`), the occlusion without a horizon search: \`SP_RAYS\` rays from the pixel's point, cosine distributed over its hemisphere by the pixel's blue noise
 * (the polar map of the unit square, `sampleCosineHemisphere`), each cast over the furthest depth in four steps from the pyramid's first level (\`ssCast\`, a rough surface of 0.2, stopping at the first sample behind a
 * surface, the step offset the noise of the ray less 0.9) for at most two tiles of pixels of the image's width at the pixel's depth; a ray that meets a surface is blocked. The amount is the share of
 * the rays left open, the direction of the open sky their mean, as long as the amount (\`xyz\`, the amount in \`w\`).
 */
const SP_STOCHASTIC_AO = (shape: OcclusionShape) =>
  wgslBlock(
    `SP_STOCHASTIC_AO(${shape.rays}, ${shape.slope})`,
    [
      SP_FIXED_CAST,
      frameAround,
      outOfFrame,
      sampleCosineHemisphere,
      interleavedGradientNoise,
      screenTraceDepthThresholdScale,
    ],
    `const SP_RAYS:u32=${shape.rays}u;
fn spStochasticAo(pixel:vec2u,s:SpSurface)->vec4f{
 let frame=frameAround(s.N);
 let slope=${wgslF32(shape.slope)}*screenTraceDepthThresholdScale(textureLoad(sceneFlags,vec2i(pixel),0).r,sp.trace.x)*4.0*sp.projection.x;
 let reach=spFixedWide(s.P,2.0*f32(sp.size.z));
 var open=0.0;
 var bent=vec3f(0.0);
 for(var n=0u;n<SP_RAYS;n++){
  let d=outOfFrame(sampleCosineHemisphere(blueNoiseVec2(pixel,sp.frames.x*SP_RAYS+n)),frame);
  let traced=ssCast(spFixedRay(s.P,d,reach,slope),0.2,4u,interleavedGradientNoise(vec2f(pixel*vec2u(SP_RAYS,1u)+vec2u(n,0u))+vec2f(0.5),0.0)-0.9,0.0);
  if(!(traced.found&&!traced.uncertain)){
   open+=1.0;
   bent+=d;
  }
 }
 let amount=open/f32(SP_RAYS);
 let norm=length(bent);
 return vec4f(select(vec3f(0.0),bent*(amount/norm),norm>0.0),amount);
}`,
  )

/** The slice's amount by sectors: the sectors of the slice the samples occlude, both ways from the pixel. */
const SP_SLICE_BITMASK_WGSL = ` // The sectors of the slice the samples occlude, both ways from the pixel: a sample's surface is half the foreground fraction of the pixel's depth thick.
 var occluded=0u;
 let thickness=depth*sp.occlusion.z*0.5;
 for(var n=0u;n<u32(sp.occlusion.y);n++){
  let fraction=(f32(n)+noise.y)/sp.occlusion.y;
  let offset=vec2f(cs,-sn)*(fraction*fraction*f32(sp.size.z)*2.0+1.0);
  occluded|=spOccludedSectors(centre+offset,s.P,V,thickness,1.0,angle);
  occluded|=spOccludedSectors(centre-offset,s.P,V,thickness,-1.0,angle);
 }
 // The slice's visibility is the share of its sectors left open, one a slice in the weights; the direction of its open sky is not found.
 return SpSlice(vec2f(1.0-f32(countOneBits(occluded))/f32(SP_SECTOR_COUNT),1.0),vec3f(0.0),vec3f(0.0));
}`

/** The slice's amount by horizons: the highest horizon each way along the slice (and, with the global illumination, the light gathered up to the screen fraction), integrated analytically. */
const spSliceHorizons = (shape: OcclusionShape) => ` let low0=cos(angle+0.5*PI);
 let low1=cos(angle-0.5*PI);
 var horizon0=low0;
 var horizon1=low1;
 let invForeground=1.0/(depth*sp.occlusion.z);
${
  shape.gi
    ? ` // With the global illumination the samples go on past the occlusion's reach, up to the screen fraction the light is gathered from: the horizon of the occlusion is updated by the first
 // steps alone, the light's by all of them; the light fades toward the end of the search.
 var light=vec3f(0.0);
 var lit0=low0;
 var lit1=low1;
 let stepsAo=u32(sp.occlusion.y);
 for(var n=0u;n<u32(sp.gi.y);n++){
  let fraction=(f32(n)+noise.y)/sp.occlusion.y;
  let radius=fraction*fraction*f32(sp.size.z)*2.0;
  let offset=vec2f(cs,-sn)*(radius+1.0);
  let fade=1.0-saturate(radius/f32(sp.size.x)*5.0/sp.gi.x-4.0);
  let up0=spHorizonLight(centre+offset,s,V,depth,invForeground,fade,lit0);
  let up1=spHorizonLight(centre-offset,s,V,depth,invForeground,fade,lit1);
  light+=up0.xyz+up1.xyz;
  lit0=up0.w;
  lit1=up1.w;
  if(n<stepsAo){
   horizon0=spHorizonCos(centre+offset,s.P,V,depth,invForeground,low0,horizon0);
   horizon1=spHorizonCos(centre-offset,s.P,V,depth,invForeground,low1,horizon1);
  }
 }`
    : ` var light=vec3f(0.0);
 for(var n=0u;n<u32(sp.occlusion.y);n++){
  let fraction=(f32(n)+noise.y)/sp.occlusion.y;
  let offset=vec2f(cs,-sn)*(fraction*fraction*f32(sp.size.z)*2.0+1.0);
  horizon0=spHorizonCos(centre+offset,s.P,V,depth,invForeground,low0,horizon0);
  horizon1=spHorizonCos(centre-offset,s.P,V,depth,invForeground,low1,horizon1);
 }`
}
 let h0=-fastAcos(horizon1);
 let h1=fastAcos(horizon0);
 let arc0=(cosNormal+2.0*h0*sinNormal-cos(2.0*h0-angle))/4.0;
 let arc1=(cosNormal+2.0*h1*sinNormal-cos(2.0*h1-angle))/4.0;
 let arcs=span*vec2f(arc0+arc1,angle*sinNormal+cosNormal);
 ${shape.bentNormal ? 'return SpSlice(arcs,spBentSlice(h0,h1,angle,sinNormal,cs,sn,span,V,right,up,back),light);' : 'return SpSlice(arcs,vec3f(0.0),light);'}
}`

/**
 * THE BENT NORMAL of a slice, the direction of the open sky it finds: with the horizons `h0` and `h1` the slice found and the angle
 * `angle` (sine `sinNormal`) of the pixel's projected normal, the sky's mean direction in the slice's plane — `t0` along the slice,
 * `t1` toward the eye, the analytic integrals of the visible arc (Jimenez et al. 2016, "Practical Real-Time Strategies for Accurate
 * Indirect Occlusion", algorithm 2) — is carried by the slice's directions (`right` and `up` of the pixel's plane by the slice's angle
 * `cs`, `sn`, `back` toward the eye) to the pixel's view vector `V` by the shortest turn from the axis `back` (`spRotateOnto`: none
 * where the two nearly agree), and weighed by the length of the projected normal `span`.
 */
const SP_BENT_SLICE = wgslBlock(
  'SP_BENT_SLICE',
  [],
  `/** The unit \`v\` turned as the shortest turn takes the unit \`source\` onto the unit \`goal\`; unturned where they nearly agree or oppose. */
fn spRotateOnto(source:vec3f,goal:vec3f,v:vec3f)->vec3f{
 let e=dot(source,goal);
 if(abs(e)>1.0-0.0003){return v;}
 let c=cross(source,goal);
 return e*v+cross(c,v)+(1.0/(1.0+e))*dot(c,v)*c;
}
fn spBentSlice(h0:f32,h1:f32,angle:f32,sinNormal:f32,cs:f32,sn:f32,span:f32,V:vec3f,right:vec3f,up:vec3f,back:vec3f)->vec3f{
 let t0=(6.0*sin(h0-angle)-sin(3.0*h0-angle)+6.0*sin(h1-angle)-sin(3.0*h1-angle)+16.0*sinNormal-3.0*(sin(h0+angle)+sin(h1+angle)))/12.0;
 let t1=(-cos(3.0*h0-angle)-cos(3.0*h1-angle)+8.0*cos(angle)-3.0*(cos(h0+angle)+cos(h1+angle)))/12.0;
 return spRotateOnto(back,V,right*(cs*t0)+up*(sn*t0)+back*t1)*span;
}`,
)

/** The slice's output binding and the amount of one slice of the short-range occlusion. */
const spSliceWgsl = (
  shape: OcclusionShape,
) => `@group(0) @binding(${B.occlusion}) var occlusionOut:texture_storage_2d<${shape.bentNormal ? F.bentOcclusion : F.occlusion},write>;
${shape.gi ? `@group(0) @binding(${B.shortRangeGi}) var giOut:texture_storage_2d<${F.shortRangeGi},write>;\n` : ''}
/** The amount of one slice at angle \`phi\`: the weighted visibility (\`arcs.x\`) and what the normal's projection could have given (\`arcs.y\`), the direction of its open sky (\`bent\`). */
struct SpSlice{arcs:vec2f,bent:vec3f,light:vec3f,}
fn spSliceArcs(phi:f32,centre:vec2f,s:SpSurface,V:vec3f,right:vec3f,up:vec3f,back:vec3f,depth:f32,noise:vec2f)->SpSlice{
 let cs=cos(phi);let sn=sin(phi);
 let direction=right*cs+up*sn;
 let orthogonal=direction-dot(direction,V)*V;
 let axis=normalize(cross(orthogonal,V));
 let projected=s.N-axis*dot(s.N,axis);
 let span=max(length(projected),1e-6);
 let cosNormal=saturate(dot(projected,V)/span);
 let angle=sign(dot(orthogonal,projected))*fastAcos(cosNormal);
 let sinNormal=sin(angle);
${shape.bitmask ? SP_SLICE_BITMASK_WGSL : spSliceHorizons(shape)}`

/**
 * THE PIXEL A TEXEL OF THE OCCLUSION STANDS FOR (`spOcclusionPixel`): where the occlusion is downsampled, the texel is not the
 * image's pixel at a fixed corner of its cell but one of the cell's four, which the probes' gather state frame (`sp.frames.x`) and the
 * cell's place in its two by two block turn (a four-rooks pattern, each of the four pixels of a block taken in turn over four
 * images, `spOcclusionJitter`): the pixel the pass searches the horizon from, and the one the temporal pass weighs the texel by. At
 * the image's size the jitter is none.
 */
export const SP_OCCLUSION_CELLS = wgslBlock(
  'SP_OCCLUSION_CELLS',
  [fourRooksJitter],
  `fn spOcclusionJitter(cell:vec2u)->vec2u{
 if(SP_OCCLUSION_DOWNSAMPLE==1u){return vec2u(0u);}
 return fourRooksJitter(cell,sp.frames.x);
}
fn spOcclusionPixel(cell:vec2u)->vec2u{
 return min(cell*SP_OCCLUSION_DOWNSAMPLE+spOcclusionJitter(cell),sp.size.xy-vec2u(1u));
}`,
)

/** The kernel of the short-range occlusion: the slices of the pixel a texel stands for (`spOcclusionPixel`) summed to its visibility. */
const spOcclusionKernel = (shape: OcclusionShape) => `@compute @workgroup_size(8,8)
fn occlusion(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy*SP_OCCLUSION_DOWNSAMPLE>=sp.size.xy)){return;}
 let pixel=spOcclusionPixel(id.xy);
 let s=spSurfaceAt(pixel);
 var visibility=0.0;
 var stored=vec3f(0.0,0.0,1.0);
 var bent=vec3f(0.0);
 var gathered=vec3f(0.0);
 if(s.lit){
${
  shape.rays > 0
    ? '  let found=spStochasticAo(pixel,s);\n  visibility=found.w;\n  bent=found.xyz;'
    : `  let centre=vec2f(pixel)+vec2f(0.5);
  let depth=spDepthOf(s.P);
  let V=viewToEye(s.P);
  let right=normalize(worldAt(centre+vec2f(1.0,0.0),s.z)-s.P);
  let up=normalize(worldAt(centre-vec2f(0.0,1.0),s.z)-s.P);
  let across=normalize(cross(right,up));
  let back=select(across,-across,dot(across,V)<0.0);
  let noise=blueNoiseVec2(pixel,sp.frames.x);
  var arcs=vec2f(0.0);
  for(var slice=0u;slice<u32(sp.occlusion.x);slice++){
   let found=spSliceArcs((f32(slice)+noise.x)/sp.occlusion.x*PI,centre,s,V,right,up,back,depth,noise);
   arcs+=found.arcs;
   bent+=found.bent;
   gathered+=found.light;
  }
  // A slice whose geometry degenerates (a view vector along the slice) gives no number: that pixel is unoccluded, not black.
  let seen=arcs.x/max(arcs.y,1e-6);
  visibility=select(1.0,max(seen,0.03),(bitcast<u32>(seen)&0x7f800000u)!=0x7f800000u);`
}
  stored=select(s.N,normalize(bent),dot(bent,bent)>1e-12)*visibility;
 }
 ${shape.gi ? 'textureStore(giOut,vec2i(id.xy),vec4f(gathered*(PI/sp.occlusion.x),0.0));\n ' : ''}${shape.bentNormal ? 'textureStore(occlusionOut,vec2i(id.xy),vec4u(spBentPack(stored),0u,0u,0u));' : 'textureStore(occlusionOut,vec2i(id.xy),vec4f(round(saturate(visibility)*255.0)/255.0,0.0,0.0,0.0));'}
}`

/**
 * THE SHORT-RANGE OCCLUSION: the contact shadow the probes, a probe a tile of pixels, cannot hold. A search of the depth round
 * each pixel for the horizon the nearby surfaces make, along slices of the pixel's view: `sp.occlusion.x` of them, each a plane
 * through the eye and the pixel at an angle the noise turns (the pixel's blue noise, `blueNoiseVec2`), and in each plane, from the pixel along both
 * ways, `sp.occlusion.y` samples of the depth, at a distance that grows as the square of their rank up to two tiles of pixels
 * (`2 · tile`, a pixel further than the self-occlusion of a texel). A slice's visibility is the analytic integral of the cosine
 * between its two horizons (`spSliceArcs`), its projected normal's weight; the pixel's, the slices' sum over what the
 * normal's projections could have given, never under a thirtieth. The planes are the world's: the camera's right and up read as
 * the world's displacement of one pixel at the pixel's own depth, the depth along the view the linear depth. With the bent normal
 * the pass also sums the slices' directions of open sky (`spBentSlice`), and writes the unit direction of the sum,
 * times the visibility, in one word (`spBentPack`): a pixel with no open sky keeps its normal as the direction. A pixel that is no lit surface
 * has no visibility (zero) and, in the word, the direction `(0, 0, 1)` at full length.
 */
const SP_OCCLUSION = (shape: OcclusionShape) =>
  wgslBlock(
    `SP_OCCLUSION(${shape.bentNormal}, ${shape.bitmask}, ${shape.rays}, ${shape.slope})`,
    [
      PI,
      fastAcos,
      SP_OCCLUSION_CELLS,
      ...(shape.bentNormal ? [SP_BENT_SLICE, SP_BENT_WGSL] : []),
      ...(shape.bitmask ? [SP_SECTORS] : []),
      ...(shape.gi ? [SP_HORIZON_LIGHT] : []),
      ...(shape.rays > 0 ? [SP_STOCHASTIC_AO(shape)] : []),
    ],
    [spSliceWgsl(shape), spOcclusionKernel(shape)].join('\n'),
  )

/** The occlusion's program over the level's `shape` and `samples` of a tile. */
export const occlusionShader = (shape: OcclusionShape, samples: readonly [number, number]) =>
  wgslProgram(
    `${spParams(B.params)}
${wgslConsts({ SP_OCCLUSION_DOWNSAMPLE: shape.downsample })}`,
    [
      spCommon(samples),
      spSurface(B.normals, B.flags),
      blueNoiseWgsl(0, B.blue),
      SP_HORIZON(shape),
      ...(shape.gi ? [spVectors(B.vectors), spHistoryDepth(B.keptDepth)] : []),
      SP_OCCLUSION(shape),
    ],
  )
