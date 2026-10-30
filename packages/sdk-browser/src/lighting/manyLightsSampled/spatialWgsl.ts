/**
 * THE SPATIAL FILTER OF THE FILTERED LIGHT, and its composition: each pixel's diffuse and specular light (`temporalWgsl.ts`) is filtered over a few neighbours of a disk
 * where the history leaves it noisy, then given back the detail the shading took out (the diffuse colour, the specular share of the environment), and written as the
 * light to add to the lit image (`composite`), its alpha the luminance of the diffuse light for the subsurface scattering where the pixel's model is scattered.
 * - the variance: the temporal one (the moments of the luminance), or, while the history is short (a disocclusion, boosted for `sampledLightsSpatialDisocclusionFrames`
 *   images and scaled), the spatial one, the moments of the 5 by 5 pixels about it weighed by a gaussian; the filter runs where the deviation over the mean luminance is
 *   above 0.5 (0.2 on a disocclusion), or where the history's own deviation (of its confidence) says it was noisy (`sampledLightsSpatialHistoryDeviation`), and only
 *   once the history can be trusted to be long (the shading confidence allows 8 images) or noisy;
 * - the neighbours: `sampledLightsSpatialSamples` points of a scrambled Hammersley set on the disk of `sampledLightsSpatialRadius` pixels (twice as many on a disocclusion),
 *   weighed by the depth against the pixel's plane, the angle of their normals (the specular within its lobe's half angle) and the difference of their luminances over the
 *   deviation. Every pixel of the reference allows the filter: only a glint closure of the reference turns it off, a material the engine has not;
 * - the composition: the pixel is read as the lit passes read it (`litPixelStatements`, every class's cut), so its base colour, its model and its checkerboard are the
 *   shading's; the filtered light times the demodulation factors, the diffuse's the colour itself where the pixel scatters (the scattering takes the colour out
 *   by itself), diffuse and specular summed. A pixel with no history adds nothing (zero).
 */
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { octEncode } from '../../../../math/src/wgsl/octahedral.ts'
import {
  hammersley16,
  rand3dPcg16,
  uniformDiskConcentric,
} from '../../../../math/src/wgsl/sampling.ts'
import { SURFACE_COLOUR_LAYERS } from '../../materials/surface/surfaceOutputs.ts'
import { scattersPixelModel } from '../../materials/surface/pixelModel.ts'
import { LIGHTS_BINDING_WGSL } from '../deferred/lightPassWgsl.ts'
import {
  CLASS_CUTS,
  LIT_PIXEL_WGSL,
  SUBSURFACE_BINDING_WGSL,
  litPixelStatements,
} from '../deferred/litSurfaceWgsl.ts'
import { FULL_CONTRACT, type ContractKey } from '../deferred/contractCuts.ts'
import { TILE_CLASS } from '../deferred/tileClass.ts'
import { lightingBase } from '../direct/lightingWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../direct/lightWgsl.ts'
import { ENVIRONMENT_BRDF_WGSL } from '../direct/environmentBrdfWgsl.ts'
import { LOBES_TARGET_WGSL } from '../direct/lobesWgsl.ts'
import { SAMPLED_BINDINGS } from './bindings.ts'
import { SAMPLED_GROUP } from './layout.ts'
import { SAMPLED_PARAMS_WGSL } from './paramsWgsl.ts'
import { CLOSURE_TONE_WGSL, SAMPLED_CLOSURE_WGSL, closureStatements } from './closurePickWgsl.ts'
import { SAMPLING_BINDINGS } from './samplingWgsl.ts'
import { DEBUG_EMPTY, withDebugPixels } from './spatialDebugWgsl.ts'

const B = SAMPLED_BINDINGS
const SIDE = SAMPLED_GROUP + 4

export const SPATIAL_ENTRY = 'denoiseSpatialMain'

/** The program the pixels are read through: every class's cut, no light evaluated (unshadowed, no rectangle code, no profile, no channel). */
const SPATIAL_KEY: ContractKey = {
  ...FULL_CONTRACT,
  unshadowed: true,
  rectless: true,
  contactless: true,
  channelless: true,
  profileless: true,
  cubeless: true,
  captureless: true,
}

const SPATIAL_B_PART_1 = `
@group(0) @binding(${B.resolvedDiffuse}) var shadingConfidence:texture_2d<f32>;
@group(0) @binding(${B.filteredDiffuse}) var filteredDiffuse:texture_2d<f32>;
@group(0) @binding(${B.filteredSpecular}) var filteredSpecular:texture_2d<f32>;
@group(0) @binding(${B.filteredMoments}) var filteredMoments:texture_2d<f32>;
@group(0) @binding(${B.filteredFrames}) var filteredFrames:texture_2d<u32>;
@group(0) @binding(${B.composite}) var composite:texture_storage_2d<rgba16float,write>;
const SIDE:u32=${SIDE}u;
/** The moments of the pixels about the group's, then the history's confidence in the same pixels. */
var<workgroup> moments:array<vec4f,${SIDE * SIDE}>;
var<workgroup> confidences:array<vec2f,${SIDE * SIDE}>;
const LUMA:vec3f=vec3f(0.3,0.59,0.11);
fn lum(c:vec3f)->f32{return dot(c,LUMA);}
/** The deviation of the confidence of the pixel's neighbours (the corners and the pixel left out). */
fn historyDeviation(lx:u32,ly:u32)->vec2f{
 var sum=vec2f(0.0);
 var squares=vec2f(0.0);
 var count=0.0;
 for(var oy=-2;oy<=2;oy++){
  for(var ox=-2;ox<=2;ox++){
   if((ox==0&&oy==0)||(abs(ox)==2&&abs(oy)==2)){continue;}
   let n=confidences[u32(i32(ly+2u)+oy)*SIDE+u32(i32(lx+2u)+ox)];
   sum+=n;
   squares+=n*n;
   count+=1.0;
`
const SPATIAL_B_PART_2 = `  }
 }
 let mean=sum/count;
 return sqrt(max(squares/count-mean*mean,vec2f(0.0)));
}
fn lobeHalfAngle(rough:f32)->f32{return atan((rough*rough*0.75)/0.25);}
@compute @workgroup_size(${SAMPLED_GROUP},${SAMPLED_GROUP},1)
fn ${SPATIAL_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) lane:vec3u,@builtin(local_invocation_index) linear:u32){
 let size=vec2i(view.viewport.xy);
 let origin=vec2i(group.xy*${SAMPLED_GROUP}u)-vec2i(2);
 for(var k=linear;k<SIDE*SIDE;k+=${SAMPLED_GROUP * SAMPLED_GROUP}u){
  let c=clamp(origin+vec2i(i32(k%SIDE),i32(k/SIDE)),vec2i(0),size-vec2i(1));
  moments[k]=textureLoad(filteredMoments,c,0);
  confidences[k]=vec2f(textureLoad(filteredDiffuse,c,0).a,textureLoad(filteredSpecular,c,0).a);
 }
 workgroupBarrier();
 let screen=group.xy*${SAMPLED_GROUP}u+lane.xy;
 if(any(screen>=vec2u(view.viewport.xy))){return;}
 let lx=lane.x;let ly=lane.y;
 let frames=f32(textureLoad(filteredFrames,vec2i(screen),0).x&0x7FFFFFFFu)/8.0;
`

const SPATIAL_PART_1 = `${SPATIAL_B_PART_1}${SPATIAL_B_PART_2}`
const SPATIAL_B_PART_3 = `   let allow=(maxByConfidence>=8.0||any(noisy))&&maxFrames>1.0;
   if(allow){
    filterDiffuse=stdDiffuse/max(centreMoments.x,0.1)>0.5||noisy.x;
    filterSpecular=stdSpecular/max(centreMoments.z,0.1)>0.5||noisy.y;
   }
  }
  var diffuseSum=diffuse;
  var specularSum=specular;
  var diffuseWeights=1.0;
  var specularWeights=1.0;
  let samples=u32(mix(f32(params.spatialU.y),2.0*f32(params.spatialU.y),disocclusion)+0.5);
  if(params.spatial.y>0.0&&(filterDiffuse||filterSpecular)){
   let plane=vec4f(N,dot(P,N));
   let seed=rand3dPcg16(vec3i(vec2i(screen%vec2u(2u)),i32(params.frame))).xy;
   var halfAngle=(lobeHalfAngle(normal.a)+0.01)*mix(1.0,2.0,disocclusion);
   halfAngle=clamp(halfAngle,0.01,1.5707963);
   let eyeDistance=max(viewEyeDistance(P),1e-6);
   for(var i=0u;i<samples;i++){
    let offset=uniformDiskConcentric(hammersley16(i,samples,seed))*params.spatial.y;
    let c=vec2i(vec2f(screen)+offset+vec2f(0.5));
    if(all(c>=vec2i(0))&&all(c<size)){
     let np=worldAt(vec2f(c)+vec2f(0.5),textureLoad(depth,c,0));
     let nn=normalize(textureLoad(colours,c,${SURFACE_COLOUR_LAYERS.normal},0).xyz);
     let planeDistance=abs(dot(vec4f(np,-1.0),plane));
     let relative=planeDistance/eyeDistance;
`
const SPATIAL_B_PART_4 = `     let depthWeight=exp2(-params.spatial.x*relative*relative);
     let angle=acos(saturate(dot(plane.xyz,nn)));
     if(filterDiffuse){
      let n=textureLoad(filteredDiffuse,c,0);
      if(n.a>=0.0){
       let w=depthWeight*(1.0-saturate(angle))*exp2(-(abs(lum(centreDiffuse.rgb)-lum(n.rgb))/max(stdDiffuse,0.001)));
       diffuseSum+=n.rgb*w;
       diffuseWeights+=w;
      }
     }
     if(filterSpecular){
      let n=textureLoad(filteredSpecular,c,0);
      if(n.a>=0.0){
       let w=depthWeight*(1.0-saturate(angle/halfAngle))*exp2(-(abs(lum(centreSpecular.rgb)-lum(n.rgb))/max(stdSpecular,0.001)));
       specularSum+=n.rgb*w;
       specularWeights+=w;
      }
     }
    }
   }
`

const SPATIAL_PART_2 = `${SPATIAL_B_PART_3}${SPATIAL_B_PART_4}`
const SPATIAL_PART_3 = `  }
  diffuse=diffuseSum/diffuseWeights;
  specular=specularSum/specularWeights;
 }
 // The pixel's detail put back: the diffuse colour (the scattering's pixels take it out by themselves), and the specular share of the environment.
 let NoV=saturate(dot(N,V));
 let diffuseColour=base.rgb*(1.0-base.a);
 let f0=mix(vec3f(0.08*surfaceSpecular),base.rgb,base.a);
 let environment=environmentBrdf(f0,saturate(50.0*f0.g),normal.a,NoV);
 let scattered=${scattersPixelModel('pixelModelId')}&&sssLitPostprocess(modelBits);
 diffuse*=select(mix(vec3f(0.04),vec3f(1.0),diffuseColour),diffuseColour,scattered);
 specular*=mix(vec3f(0.02),vec3f(1.0),environment);
 diffuse=max(diffuse,vec3f(0.0));
 // The luminance of the diffuse light the scattering spreads, where it runs and the checkerboard does not take it away.
 let scatterable=select(0.0,lum(diffuse),scattered&&!sssLitCheckerboard(modelBits));
 textureStore(composite,vec2i(screen),vec4f(diffuse+max(specular,vec3f(0.0)),scatterable));
}`

const SPATIAL_B_PART_5 = `     centreMoments+=moments[u32(i32(ly+2u)+oy)*SIDE+u32(i32(lx+2u)+ox)]*w;
     weightSum+=w;
    }
   }
   centreMoments/=weightSum;
  }else{
   centreMoments=moments[(ly+2u)*SIDE+lx+2u];
  }
  var stdDiffuse=sqrt(max(centreMoments.y-centreMoments.x*centreMoments.x,0.0));
  var stdSpecular=sqrt(max(centreMoments.w-centreMoments.z*centreMoments.z,0.0));
  var filterDiffuse=false;
  var filterSpecular=false;
  if(disocclusion>0.01){
   stdDiffuse*=params.spatialMore.x;
   stdSpecular*=params.spatialMore.y;
   filterDiffuse=stdDiffuse/max(centreMoments.x,0.1)>0.2;
   filterSpecular=stdSpecular/max(centreMoments.z,0.1)>0.2&&maxByConfidence>=4.0;
  }else{
   var noisy=vec2<bool>(false,false);
   if(params.spatialU.z!=0u){noisy=historyDeviation(lx,ly)>vec2f(params.spatial.w);}
${SPATIAL_PART_2}${SPATIAL_PART_3}`

/** The reads of the spatial filter that a view of several closures changes: the neighbours' normals are their picked closures', and the colours the light is put back by are the pixel's closure (or the closures' sums, `closureTone`). */
const NEIGHBOUR_NORMAL = `     let nn=normalize(textureLoad(colours,c,${SURFACE_COLOUR_LAYERS.normal},0).xyz);`
const PUT_BACK = ` let NoV=saturate(dot(N,V));
 let diffuseColour=base.rgb*(1.0-base.a);
 let f0=mix(vec3f(0.08*surfaceSpecular),base.rgb,base.a);
 let environment=environmentBrdf(f0,saturate(50.0*f0.g),normal.a,NoV);`

/** The text of the filter for a view of several closures: `body` with the two reads above replaced. */
function withClosures(body: string) {
  if (!body.includes(NEIGHBOUR_NORMAL) || !body.includes(PUT_BACK))
    throw new Error('SPATIAL_CLOSURE_READS_MOVED')
  return body
    .replace(
      NEIGHBOUR_NORMAL,
      '     let nn=normalize(textureLoad(colours,c,pickedNormalLayer(c),0).xyz);',
    )
    .replace(
      PUT_BACK,
      ` let tone=closureTone(coord,base.rgb,base.a,normal.a,N,V,false);
 let diffuseColour=tone.diffuse;
 let f0=surfaceF0(base.rgb,base.a);
 let environment=tone.environment;`,
    )
}

export const spatialWgsl = (debug = false, closures = false) => {
  const cut = { ...CLASS_CUTS[TILE_CLASS.complex], channels: false }
  const lit = litPixelStatements(
    cut,
    `${debug ? DEBUG_EMPTY : ''}textureStore(composite,vec2i(screen),vec4f(0.0));return;`,
  )
  const statements = closures ? closureStatements(lit) : lit
  const body = `${SPATIAL_PART_1} let centreDiffuse=textureLoad(filteredDiffuse,vec2i(screen),0);
 let centreSpecular=textureLoad(filteredSpecular,vec2i(screen),0);
 // A pixel that is no lit surface, or that holds no frames, adds nothing.
 if(frames<=0.0||centreDiffuse.a<0.0){
  ${debug ? DEBUG_EMPTY : ''}textureStore(composite,vec2i(screen),vec4f(0.0));
  return;
 }
 let pixel=vec4f(vec2f(screen)+vec2f(0.5),0.0,1.0);${statements}
 let maxFrames=params.denoise.z;
 let confidence=textureLoad(shadingConfidence,coord,0).a;
 let maxByConfidence=select(maxFrames,1.0/(confidence*0.5),confidence>0.0);
 let quantized=floor(maxByConfidence*8.0+0.5)/8.0;
 let maxDisocclusion=min(params.spatial.z,quantized-1.0);
 var disocclusion=0.0;
 if(maxDisocclusion>0.0){disocclusion=1.0-saturate((frames-1.0)/maxDisocclusion);}
 var diffuse=centreDiffuse.rgb;
 var specular=centreSpecular.rgb;
 if(params.spatialU.x!=0u){
  var centreMoments=vec4f(0.0);
  if(disocclusion>0.01){
   // Not enough history for a variance of its own: the spatial one, a gaussian over the 5 by 5.
   var weightSum=0.0;
   for(var oy=-2;oy<=2;oy++){
    for(var ox=-2;ox<=2;ox++){
     let w=exp2(-2.0*f32(ox*ox+oy*oy)/9.0);
${SPATIAL_B_PART_5}`
  const text = closures ? withClosures(body) : body
  return wgslProgram(debug ? withDebugPixels(text) : text, [
    ...(debug ? [octEncode] : []),
    ...(closures ? [SAMPLED_CLOSURE_WGSL, CLOSURE_TONE_WGSL] : []),
    lightingBase(SAMPLING_BINDINGS, SPATIAL_KEY, { environment: false, slices: false, cut }),
    SAMPLED_PARAMS_WGSL,
    hammersley16,
    rand3dPcg16,
    uniformDiskConcentric,
    LIT_PIXEL_WGSL,
    SUBSURFACE_BINDING_WGSL,
    LOBES_TARGET_WGSL,
    LIGHTS_BINDING_WGSL,
    DIRECT_LIGHT_WGSL,
    ENVIRONMENT_BRDF_WGSL,
  ])
}
