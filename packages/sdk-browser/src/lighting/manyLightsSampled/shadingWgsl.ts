/**
 * THE SHADING OF THE SAMPLES: for each pixel of the tiles of a mode (the view's lists, `tileListsWgsl`), the samples of the downsampled pixel it stands in are
 * gathered by light, and each light that a visible sample drew is lit on the pixel by the engine's one light term (`declaredLightSplit`, its diffuse and its
 * specular light apart; the light function and the profile in it, the shadow none — the samples are the shadow). A light's weight is the sum of its visible samples'
 * weights (one held to `sampledLightsMaxShadingWeight`, or `…Hidden` where its light was hidden last image and was drawn as visible), the merged identical rays counted,
 * over the samples of a pixel, then faded under the least weight (`smoothFalloffMask`). The sums are pre-exposed and divided by the pixel's diffuse colour and its
 * specular share of the environment (`demodulateFactors`), so that the filters after keep the texture's detail: the diffuse in `rgb` of `resolvedDiffuse`, the
 * shading confidence (the share of the draw that sampled the pixel well) in its alpha, the specular in `resolvedSpecular`. A pixel that is no lit surface keeps `-1`.
 * A light the pixel does not share a lighting channel with is left out.
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { LOBES_TARGET_WGSL } from '../direct/lobesWgsl.ts'
import { blueNoiseWgsl } from '../../gpu/noise/blueNoiseWgsl.ts'
import { SURFACE_COLOUR_LAYERS, SURFACE_WORDS } from '../../materials/surface/surfaceOutputs.ts'
import { lightingBase, pixelCellWgsl } from '../direct/lightingWgsl.ts'
import { lightChannelsOf } from '../direct/lightReachWgsl.ts'
import { declaredLightWgsl } from '../direct/lightLoopWgsl.ts'
import { ENVIRONMENT_BRDF_WGSL } from '../direct/environmentBrdfWgsl.ts'
import { LIGHTS_BINDING_WGSL } from '../deferred/lightPassWgsl.ts'
import {
  LIT_CHANNELS_WGSL,
  LIT_PIXEL_WGSL,
  SUBSURFACE_BINDING_WGSL,
  litCutOf,
  litPixelStatements,
} from '../deferred/litSurfaceWgsl.ts'
import type { ContractKey } from '../deferred/contractCuts.ts'
import type { TileClass } from '../deferred/tileClass.ts'
import { SAMPLED_BINDINGS } from './bindings.ts'
import { SAMPLED_GROUP } from './layout.ts'
import {
  NO_LIGHT_INDEX,
  lightSampleGuided,
  lightSampleIndex,
  lightSampleVisible,
  lightSampleWeight,
  smoothFalloffMask,
  unpackTile,
} from './lightSamplerWgsl.ts'
import { RESOLVED_INVALID } from './clearResolvedWgsl.ts'
import { SAMPLED_PARAMS_WGSL } from './paramsWgsl.ts'
import {
  JITTER_WGSL,
  samplingBindingsOf,
  TILES_BINDING_WGSL,
  sampledClassOf,
} from './samplingWgsl.ts'

const B = SAMPLED_BINDINGS

export const SHADING_ENTRY = 'shadeSamplesMain'

const SHADING_RESOURCES_WGSL = wgslBlock(
  'SHADING_RESOURCES_WGSL',
  [SAMPLED_PARAMS_WGSL],
  `override TILE_MODE:u32=0u;
@group(0) @binding(${B.tileAllocator}) var<storage,read> tileAllocator:array<u32>;
@group(0) @binding(${B.tileData}) var<storage,read> tileData:array<u32>;
@group(0) @binding(${B.samples}) var samples:texture_2d<u32>;
@group(0) @binding(${B.resolvedDiffuse}) var resolvedDiffuse:texture_storage_2d<rgba16float,write>;
@group(0) @binding(${B.resolvedSpecular}) var resolvedSpecular:texture_storage_2d<rgba16float,write>;`,
)

/**
 * THE DOWNSAMPLED PIXEL A PIXEL READS: where nothing is downsampled, the pixel itself. Otherwise the pixel reads one of the four downsampled pixels around it, picked
 * at random by the weights a bilinear read would give them: the triangle filter of the distance between the pixel and each sample's full-resolution pixel (the 2 by 2
 * jitter), times a weight of the plane distance of the sample from the pixel's tangent plane, relative to the pixel's depth, times a weight of the angle between
 * the normals. For 2 by 1, the pixel and then the pixels beside and above and under it are the four, the pixel alone where its own sample is on it, else all four
 * equal. A sample that is out of the view or no surface weighs nothing. The result is the downsampled coordinate in `xy` and in `z` whether
 * the pixel can be reconstructed from the samples (the weights sum to at least 0.01).
 */
const SHADING_PART_1 = `fn pointDepth(P:vec3f)->f32{
 return select(viewEyeDistance(P),dot(P-view.camera.xyz,view.contact.xyz),view.camera.w!=0.0);
}
fn stochasticDown(screen:vec2u,P:vec3f,N:vec3f)->vec3i{
 let own=vec2i(screen);
 if(params.factor.x==1u){return vec3i(own,1);}
 let factor=vec2i(params.factor);
 let wide=params.factor.y==1u;
 var offsets=array<vec2i,4>(vec2i(0,0),vec2i(1,0),vec2i(0,1),vec2i(1,1));
 var first=vec2i(floor((vec2f(own)+vec2f(0.5))/vec2f(factor)-vec2f(0.5)));
 if(wide){
  first=own/factor;
  offsets[1]=vec2i(select(1,-1,own.x%2==0),0);
  offsets[2]=vec2i(0,-1);
  offsets[3]=vec2i(0,1);
 }
 let local=own-first*factor;
 let centred=vec2i(downsampleJitter(vec2u(max(first,vec2i(0)))))-local;
 let depth0=pointDepth(P);
 let plane=dot(P,N);
 var weights=array<f32,4>(0.0,0.0,0.0,0.0);
 for(var i=0;i<4;i++){
  let corner=first+offsets[i];
  if(any(corner<vec2i(0))||any(corner>=vec2i(params.downView))){continue;}
  let jitter=vec2i(downsampleJitter(vec2u(corner)));
`
const SHADING_PART_2 = `  let at=corner*factor+jitter;
  if(any(at>=vec2i(view.viewport.xy))){continue;}
  if(pixelTileClass(textureLoad(words,at,${SURFACE_WORDS.flags},0).r)==0u){continue;}
  let Pc=worldAt(vec2f(at)+vec2f(0.5),textureLoad(depth,at,0));
  let gap=abs(dot(Pc,N)-plane)/depth0;
  let Nc=normalize(textureLoad(colours,at,${SURFACE_COLOUR_LAYERS.normal},0).xyz);
  let angle=1.0-saturate(acos(saturate(dot(Nc,N))));
  let apart=abs(vec2f(jitter+offsets[i]*factor-local));
  var triangle=(2.0-apart.x)*(2.0-apart.y);
  if(wide){triangle=select(0.25,select(0.0,1.0,i==0),centred.x==0);}
  weights[i]=triangle*exp2(-5000.0*gap*gap)*angle*angle;
 }
 let sum=weights[0]+weights[1]+weights[2]+weights[3];
 let pick=blueNoiseScalar(screen,params.frame)*sum;
 var chosen=3;
 if(pick<=weights[0]&&weights[0]>0.0){chosen=0;}
 else if(pick<=weights[0]+weights[1]&&weights[1]>0.0){chosen=1;}
 else if(pick<=weights[0]+weights[1]+weights[2]&&weights[2]>0.0){chosen=2;}
 let down=clamp(first+offsets[chosen],vec2i(0),vec2i(params.downView)-vec2i(1));
 return vec3i(down,select(0,1,sum>=0.01));
}`

const STOCHASTIC_DOWN_WGSL = wgslBlock(
  'SAMPLED_STOCHASTIC_DOWN_WGSL',
  [SAMPLED_PARAMS_WGSL, JITTER_WGSL, blueNoiseWgsl(0, B.blue)],
  `${SHADING_PART_1}${SHADING_PART_2}`,
)

const SHADING_PART_3 = `}`

/** The pieces a shading program is made of, by what the contract's cut keeps. */
function shadingParts(
  key: ContractKey,
  lights: ContractKey,
  cut: ReturnType<typeof litCutOf>,
  textured: boolean,
) {
  return [
    lightingBase(samplingBindingsOf(textured), lights, {
      narrow: key.narrow,
      environment: false,
      cut,
    }),
    declaredLightWgsl(lights, { term: 'split', cut, airTint: false }),
    pixelCellWgsl(),
    LIT_PIXEL_WGSL,
    ...(cut.channels ? [LIT_CHANNELS_WGSL, lightChannelsOf] : []),
    LIGHTS_BINDING_WGSL,
    TILES_BINDING_WGSL,
    SHADING_RESOURCES_WGSL,
    STOCHASTIC_DOWN_WGSL,
    ENVIRONMENT_BRDF_WGSL,
    smoothFalloffMask,
    unpackTile,
    lightSampleGuided,
    lightSampleIndex,
    lightSampleVisible,
    lightSampleWeight,
    ...(cut.thin ? [SUBSURFACE_BINDING_WGSL] : []),
    ...(cut.lobes ? [LOBES_TARGET_WGSL] : []),
  ]
}

const SHADING_PART_4 = ` let reading=stochasticDown(screen,P,N);
 if(reading.z==0){textureStore(resolvedDiffuse,vec2i(screen),vec4f(${RESOLVED_INVALID}.0));textureStore(resolvedSpecular,vec2i(screen),vec4f(${RESOLVED_INVALID}.0));return;}
 let down=vec2u(reading.xy);
 var packed=array<u32,4>(0u,0u,0u,0u);
 for(var i=0u;i<params.count1d;i++){
  packed[i]=textureLoad(samples,vec2i(down*params.samples+vec2u(i%params.samples.x,i/params.samples.x)),0).r;
 }
 var next=${NO_LIGHT_INDEX}u;
 var anyValid=false;
 for(var i=0u;i<params.count1d;i++){
  let index=lightSampleIndex(packed[i]);
  if(index<${NO_LIGHT_INDEX}u){anyValid=true;}
  if(lightSampleVisible(packed[i])){next=min(next,index);}
 }
 // No light affects the pixel: it is as well sampled as can be.
 var ratioSum=select(0.0,f32(params.count1d),!anyValid);
 let shading=clothSurface(lobeSurface(albedo,base.a,normal.a,N,V));lobeView(shading);
 var diffuse=vec3f(0.0);
 var specular=vec3f(0.0);
 while(next<${NO_LIGHT_INDEX}u){
  let rank=next;
  next=${NO_LIGHT_INDEX}u;
  var weight=0.0;
  var merged=1u;
  for(var i=0u;i<params.count1d;i++){
   let index=lightSampleIndex(packed[i]);
   let visible=lightSampleVisible(packed[i]);
   if(index==rank){
    let w=lightSampleWeight(packed[i]);
    // Identical rays were skipped by marking such samples with a weight of 0.
    if(w==0.0){merged++;}
    else if(visible){
     let guided=lightSampleGuided(packed[i]);
     weight+=min(w,select(params.hair.w,params.hair.z,guided))*f32(merged);
     if(guided){ratioSum+=f32(merged)/w;}
     merged=1u;
    }
   }
   if(visible&&index>rank){next=min(next,index);}
  }
  weight/=f32(params.count1d);
`

const SHADING_PART_5 = `   let lum=dot(split.diffuse+split.specular,LUMA)*view.preExposure.x;
   weight*=smoothFalloffMask(lum,params.minWeight);
   diffuse+=split.diffuse*weight;
   specular+=split.specular*weight;
  }
 }
 // The nearest translucent layer may keep the specular light alone: its diffuse light is the translucency volume's.
 if(params.spatialU.w!=0u){diffuse=vec3f(0.0);}
 diffuse*=view.preExposure.x;
 specular*=view.preExposure.x;
 // The pixel's detail is taken out before the filters and put back after them: the diffuse colour, and the specular share of the environment.
 let NoV=saturate(dot(N,V));
 let diffuseColour=albedo*(1.0-base.a);
 let f0=mix(vec3f(0.08*surfaceSpecular),albedo,base.a);
 let environment=environmentBrdf(f0,saturate(50.0*f0.g),normal.a,NoV);
 diffuse/=mix(vec3f(0.04),vec3f(1.0),diffuseColour);
 specular/=mix(vec3f(0.02),vec3f(1.0),environment);
 let confidence=select(0.0,ratioSum/f32(params.count1d),params.screenTrace.w!=0u);
 textureStore(resolvedDiffuse,vec2i(screen),vec4f(diffuse,confidence));
 textureStore(resolvedSpecular,vec2i(screen),vec4f(specular,0.0));
`

/** The shading's entry: the pixel's lit statements, the samples read back and the lights they name shaded (`cut` what the contract keeps of the surface). */
function shadingText(cut: ReturnType<typeof litCutOf>, statements: string) {
  return `
const LUMA:vec3f=vec3f(0.3,0.59,0.11);
@compute @workgroup_size(${SAMPLED_GROUP},${SAMPLED_GROUP},1)
fn ${SHADING_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) lane:vec3u){
 if(group.x>=tileAllocator[TILE_MODE]){return;}
 let screen=unpackTile(tileData[TILE_MODE*params.stride+group.x])*${SAMPLED_GROUP}u+lane.xy;
 if(any(screen>=vec2u(view.viewport.xy))){return;}
 let pixel=vec4f(vec2f(screen)+vec2f(0.5),0.0,1.0);${statements}
${SHADING_PART_4}  if(weight>0.0&&${cut.channels ? '(surfaceChannels&lightChannelsOf(directLights.items[rank]))!=0u' : 'true'}){
${
  cut.thin
    ? `   // Where the transmission is sampled, a light that does not transmit lets none through. The distance the ray travelled through the surface attenuates it
   // only where the trace writes one; the software and shadow-map traces never do (the ray's distance stays 0, a transmittance of 1).
   let subsurfaceBefore=thinSubsurface;
   if(params.transmission>0.0&&!transmitsLight(directLights.items[rank])){thinSubsurface=vec3f(0.0);}
`
    : ''
}   let split=declaredLightSplit(rank,albedo,base.a,normal.a,N,V,P,shading);
${cut.thin ? '   thinSubsurface=subsurfaceBefore;\n' : ''}${SHADING_PART_5}${SHADING_PART_3}`
}

export function shadingWgsl(
  key: ContractKey,
  tileClass: TileClass,
  rect: boolean,
  textured = true,
) {
  const { lights, cut } = sampledClassOf(key, tileClass, rect)
  const statements = litPixelStatements(cut).replace(
    '{discard;}',
    `{textureStore(resolvedDiffuse,vec2i(screen),vec4f(${RESOLVED_INVALID}.0));textureStore(resolvedSpecular,vec2i(screen),vec4f(${RESOLVED_INVALID}.0));return;}`,
  )
  return wgslBlock(
    `shadingWgsl(${tileClass}, ${rect}, ${key.lobeless}, ${key.profileless}, ${key.channelless}, ${key.narrow}${textured ? '' : ', plain rectangles'})`,
    shadingParts(key, lights, cut, textured),
    shadingText(cut, statements),
  )
}
