import { wgslBlock, wgslFn } from '../../../math/src/wgsl/decl.ts'
import { MODEL_SWITCH, PIXEL_MODEL } from '../materials/surface/pixelModel.ts'
import { variantLabel, type ContractKey } from '../lighting/deferred/contractCuts.ts'
import { LIT_PIXEL_WGSL } from '../lighting/deferred/litSurfaceWgsl.ts'
import {
  HAIR_LIGHT_BINDINGS,
  LIGHTS_BINDING_WGSL,
  TILES_BINDING_WGSL,
} from '../lighting/deferred/lightPassWgsl.ts'
import { indirectModules } from '../lighting/deferred/indirectPassWgsl.ts'
import { lightingBase, pixelCellWgsl } from '../lighting/direct/lightingWgsl.ts'
import { SIMPLE_HEADER } from '../../../sdk-core/src/scene/light/fields.ts'
import { hairScatteringWgsl } from './hairBsdfWgsl.ts'
import { HAIR_SAMPLE_WGSL } from './sampleWgsl.ts'
import { HAIR_NODE_COUNTER_STORED } from './visibilityMath.ts'

/** The bindings of the hair lighting's own group (group 1); group 0 is the lit program's local lights' group, its
 *  masks the strands' (`HAIR_LIGHT_BINDINGS`). */
export const HAIR_LIGHT_GROUP = {
  nodeCoord: 0,
  nodeData: 1,
  nodeCounter: 2,
  transmittance: 3,
  slots: 4,
  params: 5,
  lut: 6,
  lutSampler: 7,
  scene: 8,
  env: 9,
  draws: 10,
} as const
/** The words of the parameters block (`HairLightParams`). */
export const HAIR_LIGHT_PARAM_WORDS = 8
/** The slot a light has none in (`slots`). */
export const HAIR_LIGHT_NO_SLOT = 0xffffffff

const G = HAIR_LIGHT_GROUP

/** The transmittance of the strands toward light `rank` along `L`, read from the mask of the sample and the
 *  light (`transmittance[(slot % perBatch) * samples + sample]`, the reference's index within the batch of lights the pass lights), replacing the neutral one the shading model
 *  holds (`hairTransmittanceFor`, weak there). The sample's colour, roughness and fibre direction are the pass's
 *  (`hairSampleState`); a light with no slot, or a sample the light has no mask for, is the empty mask. */
const hairTransmittanceForWgsl = (sampled: boolean) =>
  wgslFn(
    'hairTransmittanceFor',
    [hairScatteringWgsl(1, G.lut)],
    `fn hairTransmittanceFor(rank:u32,L:vec3f)->HairTransmittanceData{
 var mask=vec2f(0.0,1.0);
 var lit=true;
 let slot=hairSlots[rank];
 ${sampled ? 'if(hairDrawnActive){\n  // A light the sampled lighting drew for this sample: the mask is the one its draw traced.\n  mask=hairDrawnMask;\n }else ' : ''}if(slot==${HAIR_LIGHT_NO_SLOT}u){
  // A light with no mask is lit once, by the first batch.
  lit=hairParams.batch==0u;
 }else if(slot/hairParams.perBatch!=hairParams.batch){
  // A light whose mask lies in another batch is lit by that one.
  lit=false;
 }else{
  let word=hairMasks[(slot%hairParams.perBatch)*hairParams.samples+hairSampleState.x];
  mask=vec2f(f32(word&0x00FFFFFFu)/1000.0,f32(word>>24u)/255.0);
 }
 var td=hairTransmittance(hairSampleView,L,hairSampleColour,hairSampleRoughness,0.0,hairSampleTangent,mask,hairParams.components);
 // No component and no scattering: the light adds nothing in this batch.
 if(!lit){td.components=0u;}
 return td;
}`,
  )

/** The strands' own group 1 declarations and the grid vertex stage, shared by the passes that read a sample
 *  (the lights', the sky's). */
const SAMPLE_GRID = `var<private> hairSampleState:vec4u=vec4u(0u);
var<private> hairSampleColour:vec3f=vec3f(0.0);
var<private> hairSampleRoughness:f32=0.0;
var<private> hairSampleTangent:vec3f=vec3f(0.0,0.0,1.0);
var<private> hairSampleView:vec3f=vec3f(0.0,0.0,1.0);
struct HairLightParams{samples:u32,components:u32,side:u32,scatter:u32,batch:u32,perBatch:u32,environment:u32,pad1:u32}
@group(1) @binding(${G.nodeCoord}) var<storage,read> hairCoord:array<u32>;
@group(1) @binding(${G.nodeData}) var<storage,read> hairData:array<u32>;
@group(1) @binding(${G.nodeCounter}) var<storage,read> hairCounter:array<u32>;
@group(1) @binding(${G.transmittance}) var<storage,read> hairMasks:array<u32>;
@group(1) @binding(${G.slots}) var<storage,read> hairSlots:array<u32>;
@group(1) @binding(${G.params}) var<uniform> hairParams:HairLightParams;
@group(1) @binding(${G.scene}) var hairSceneColor:texture_2d<f32>;
@group(1) @binding(${G.env}) var hairEnv:texture_2d<f32>;
struct HairVsOut{@builtin(position) position:vec4f,@location(0) @interpolate(flat) count:u32,@location(1) @interpolate(flat) side:u32}
// The grid of the samples: a square whose side is the root of their count, the triangle covering it alone
// within the largest square (\`hairParams.side\`) the target was made for.
@vertex fn hairLightVs(@builtin(vertex_index) i:u32)->HairVsOut{
 let count=hairCounter[${HAIR_NODE_COUNTER_STORED}];
 let side=u32(ceil(sqrt(f32(count))));
 let clip=((vec2f(f32(side))+vec2f(0.5))/f32(max(hairParams.side,1u)))*2.0;
 let uv=vec2f(f32(i&1u),f32(i>>1u));
 let p=vec2f(-uv.x,uv.y)*4.0+vec2f(-1.0,1.0)+vec2f(clip.x,-clip.y);
 return HairVsOut(vec4f(p,0.5,1.0),count,side);
}
`

/** The draws of the sampled lighting (`manyLightsSampled/hairWgsl.ts`) the sampled form of the pass reads: three words a draw, the rank, the weight, the mask. */
const SAMPLED_DRAWS = `var<private> hairDrawnMask:vec2f=vec2f(0.0,1.0);
var<private> hairDrawnActive:bool=false;
@group(1) @binding(${G.draws}) var<storage,read> hairDraws:array<u32>;
`

/** The light of the sampled form: the suns the draws do not hold and the simple lights the sampled lighting leaves to the classic pass are lit by the walk of the cell as before; the local lights are those the sample drew, each with the mask its ray traced, weighed by its draw's
 *  weight over the draws taken, in the first batch alone. */
const SAMPLED_LIGHT = `var lit=vec3f(0.0);
 let shading=modelLobeSurface(clothSurface(lobeSurface(base.rgb,base.a,roughness,N,V)));lobeView(shading);
 let drawn=hairParams.pad1&7u;
 for(var walk=0u;walk<cell.y;walk++){
  let rank=listedLight(cell,walk);
  if(!listedDrawn(cell,rank)){continue;}
  // The suns the draws do not hold, and the simple lights the sampled lighting leaves to the classic pass (it takes the others).
  if(select(sampledTakes(rank),(hairParams.pad1&8u)!=0u,isSun(directLights.items[rank]))){continue;}
  lit+=declaredLight(rank,base.rgb,base.a,roughness,N,V,P,1.0,shading);
 }
 if(hairParams.batch==0u){
  for(var i=0u;i<drawn;i++){
   let at=(hairSampleState.x*drawn+i)*3u;
   let rank=hairDraws[at];
   if(rank==0xFFFFFFFFu){continue;}
   let word=hairDraws[at+2u];
   hairDrawnMask=vec2f(f32(word&0x00FFFFFFu)/1000.0,f32(word>>24u)/255.0);
   hairDrawnActive=true;
   lit+=declaredLight(rank,base.rgb,base.a,roughness,N,V,P,1.0,shading)*(bitcast<f32>(hairDraws[at+1u])/f32(drawn));
   hairDrawnActive=false;
  }
 }`

/** The statements that read sample \`index\` of the grid into the pixel the strands make (`pixel`, `coord`, `z`, `P`, `V`,
 *  `N`, `colour`, `roughness`, `coverage`, `base` — set as the hair model sets it) and the surface state the light terms
 *  read; a sample past the count or off the grid returns nothing. */
const sampleStatements = (channelless: boolean) => `
 let at=vec2u(pos.xy);
 let index=at.x+at.y*side;
 if(at.x>=side||index>=count){return vec4f(0.0);}
 let strand=hairSampleOf(index);
 let pixel=strand.pixel;
${channelless ? '' : ' surfaceChannels=strand.channels;\n'}
 let coverage=strand.coverage;
 let colour=strand.colour;
 let roughness=strand.roughness;
 let specular=strand.specular;
 let scatter=strand.scatter;
 let z=strand.z;
 let coord=vec2i(pixel);
 let P=worldAt(vec2f(pixel)+vec2f(0.5),z);
 let V=viewToEye(P);
 let N=strand.tangent;
 surfaceModel=0u;
 surfaceSpecular=specular;
 let modelBits=modelSwitchBits();
 roughDiffuse=(modelBits&${MODEL_SWITCH.roughDiffuse}u)!=0u;
 shadingAccurate=(modelBits&${MODEL_SWITCH.accurate}u)!=0u;
 modelTransmitDistance=view.preExposure.w;
 let base=setPixelModel(${PIXEL_MODEL.hair}u,vec4f(0.0),vec4f(colour,scatter),N,V,roughness,false);
 hairSampleState=vec4u(index,0u,0u,0u);
 hairSampleColour=colour;
 hairSampleRoughness=roughness;
 hairSampleTangent=N;
 hairSampleView=V;
`

/**
 * THE LIGHT OF THE STRANDS' SAMPLES: for each compacted sample (a pixel of a square grid that holds them
 * in order, as the reference lays them out: its side is the square root of their count, rounded up, the
 * triangle drawn over that grid only), the lights of the sample's cell of the light grid (`sliceLighting`,
 * the engine's one light loop, every light, the suns too) light a pixel the strands make: its point the
 * sample's depth carried into the world, its normal the fibre's direction, its model the hair's
 * (`setPixelModel`) with the sample's colour, roughness, specular and scatter, its lighting channels the
 * sample's, its shadows read at the sample's screen pixel in the strands' own masks (group 0 binds them where
 * the opaque program binds its masks: `HAIR_LIGHT_BINDINGS`), and the transmittance toward each light the
 * mask buffers of the voxels or the deep shadows hold (`hairTransmittanceFor`). The result, multiplied by
 * the sample's coverage and by the exposure (`lightOut`), is the pixel's rgb; its alpha the coverage. Lit
 * with the occlusion of the screen set to 1: the strands' own occlusion is the transmittance's.
 *
 * Reads, in group 1: the samples (`nodeCoord`, `nodeData`, `nodeCounter`), the masks (`transmittance`, a light's
 * block after another, a sample a word) and the slot of each light's block (`slots`, by rank), the parameters
 * (`params`: the samples' count the masks are strided by, the components, the grid's side) and the table of
 * the fibre's scattering (`lut`, `lutSampler`).
 */
export const hairLightPassWgsl = (key: ContractKey, sampled = false) => {
  // The strands' pixel wears no lobe and casts no contact shadow of its own.
  const lights: ContractKey = { ...key, lobeless: true, contactless: true }
  const cut = { models: true, thin: false }
  return wgslBlock(
    `hairLightPassWgsl(${variantLabel(lights)}${sampled ? ', sampled' : ''})`,
    [
      lightingBase(HAIR_LIGHT_BINDINGS, lights, {
        narrow: lights.narrow,
        environment: false,
        cut,
      }),
      pixelCellWgsl(),
      LIT_PIXEL_WGSL,
      LIGHTS_BINDING_WGSL,
      TILES_BINDING_WGSL,
      hairTransmittanceForWgsl(sampled),
      HAIR_SAMPLE_WGSL,
    ],
    `${SAMPLE_GRID}${sampled ? SAMPLED_DRAWS : ''}
@fragment fn hairLightMain(@builtin(position) pos:vec4f,@location(0) @interpolate(flat) count:u32,@location(1) @interpolate(flat) side:u32)->@location(0) vec4f{${sampleStatements(!!lights.channelless)}
 simpleLightsSeen=(directLights.simpleBits&${SIMPLE_HEADER.hair}u)!=0u;
 let record=pixelCell(vec2f(pixel)+vec2f(0.5),z);
 let cell=cellSlice(record);
 vsmMaskAt(coord,record);
 ${sampled ? SAMPLED_LIGHT : 'let lit=sliceLighting(base.rgb,base.a,roughness,N,V,P,1.0,cell);'}
 let emitted=lightOut(lit);
 return vec4f(emitted.rgb*coverage,coverage);
}`,
  )
}

/**
 * THE SKY LIGHT OF THE STRANDS' SAMPLES, the reference's default integration (the spherical harmonics one): the
 * sample read as the light pass reads it (`sampleStatements`), the environment's diffuse light (`environmentLighting`,
 * the sky light's, the ambient cube's with `cubed`) taken for the fibre's direction as the normal and weighed by
 * the hair's response to the light from the direction it is seen along (the model's `modelEnvironment`, which
 * `setPixelModel` set), under no occlusion. The result times the coverage and the exposure is the pixel's rgb,
 * its alpha the coverage. Group 0 is the lit program's indirect group. A sample that scatters the scene's light
 * (`HAIR_FLAG.scatterSceneLight`) takes the lit image instead (`hairParams.scatter`, `hairScatterSceneLighting`), none of the sky's. `hairParams.environment` says where its light comes
 * from: 0 the sky light's, 1 the grid of the environment kernels (`hairEnvKernel`), 2 the sky light's with the volumetric lightmap's static light (`hairStaticLightWgsl`) added.
 */
export const hairSkyPassWgsl = (cubed: boolean) => {
  const cut = { models: true, thin: false, lobes: false, channels: false }
  return wgslBlock(
    `hairSkyPassWgsl(${cubed})`,
    [
      ...indirectModules(false, false, cubed, cut),
      LIT_PIXEL_WGSL,
      hairScatteringWgsl(1, G.lut),
      HAIR_SAMPLE_WGSL,
    ],
    `${SAMPLE_GRID}
@fragment fn hairSkyMain(@builtin(position) pos:vec4f,@location(0) @interpolate(flat) count:u32,@location(1) @interpolate(flat) side:u32)->@location(0) vec4f{${sampleStatements(true)}
 // A sample that scatters the scene's light takes the lit image's light of its pixel, weighed by the fibre's average forward
 // scattering, in place of the sky's; where that is off it takes none.
 if(scatter>0.5){
  if(hairParams.scatter==0u){return vec4f(0.0);}
  let average=sampleHairLut(colour,roughness,dot(N,V));
  let scene=textureLoad(hairSceneColor,coord,0).rgb;
  return vec4f(max(average.front*scene,vec3f(0.0))*coverage,coverage);
 }
 // Where the screen probes' pass lit the strands from the radiance cache (\`hairEnvKernel\`), that is their sky light.
 if(hairParams.environment==1u){return textureLoad(hairEnv,vec2i(at),0);}
 // The strands' response to the environment is the fibre's own, with the dual scattering of a mask that holds no hair.
 modelEnvironment=evaluateEnvHair(colour,roughness,specular,scatter,V,N,hairParams.components);
 let emitted=lightOut(environmentLighting(base.rgb,base.a,N,1.0));
 // With the volumetric lightmap's static light (\`hairStaticLightWgsl\`), added to the sky light's.
 let stored=select(vec4f(0.0),textureLoad(hairEnv,vec2i(at),0),hairParams.environment==2u);
 return vec4f(emitted.rgb*coverage+stored.rgb,coverage);
}`,
  )
}
