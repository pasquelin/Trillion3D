/**
 * THE SAMPLED LIGHTING OF THE VOLUMES (`sampledLightsVolume`): the lights of the fog's cells and of the translucency lighting volume's are drawn by samples, traced, and read by the fog's scatter
 * and by the injection of the translucency volume. The sampling is a pass of its own, before and apart from either (it needs neither the fog nor the translucency volume to be built).
 *
 * - `volumeSampleMain`: one thread a voxel of the downsampled grid, in one of two domains (`flags3.y`): the fog's froxel grid (a pixel size, depth count and law of its own, `volumeGrid`), or the
 *   cells of the translucency volume's two cascades. A fog voxel found hidden behind the surfaces (the depth pyramid) is left with no samples. Else the lights of its cell of the light grid, and the
 *   sun where the directional lights join, are offered to a stratified sampler by the luminance of their light at the voxel's point (unshadowed; the larger of the fog's and the translucency's
 *   where the two share the samples), a light hidden in the image before drawn less (the guide: the tile's visible set of the image before, found through the point's reprojection, and the
 *   ratio of the light's power since); each sample keeps one light by a weighted reservoir. Identical neighbours are merged, and each kept light that casts a shadow is marked to be traced from the voxel's point
 *   through the global distance field, toward the point of the light the sample picks.
 * - `volumeCompactMain` and `volumeTraceMain` (`volumeTraceWgsl.ts`): the marked samples listed, then traced through the global distance field.
 * - `volumeHashMain`: one thread a tile of 4 by 4 by 2 voxels, the lights its samples drew, visible or hidden, as the two sets the next image draws by.
 * - `mlVolumeLight` and the translucency injection read them (`ML_SETS_WGSL`).
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  depthOfLogSlice,
  logSliceOfDepth,
  ndcToUv,
  unprojectPoint,
  uvToNdc,
} from '../../../../math/src/wgsl/projection.ts'
import { rand4dPcg32 } from '../../../../math/src/wgsl/sampling.ts'
import { hgPhase } from '../../../../math/src/wgsl/lighting.ts'
import { CENTIMETRES_PER_METRE } from '../../../../sdk-core/src/page/format.ts'
import { ML_BINDING } from './volumeBindings.ts'
import { globalDistanceFieldReadWgsl } from '../distanceField/globalReadWgsl.ts'
import { globalDistanceFieldTraceWgsl } from '../distanceField/globalTraceWgsl.ts'
import { VOLUME_LAMP_WGSL } from '../direct/lampSeenWgsl.ts'
import { lightStrengthWgsl } from '../direct/lightStrengthWgsl.ts'
import {
  NO_LIGHT_INDEX,
  addLightSample,
  candidateIndex,
  candidateVisible,
  candidateWeight,
  estimateLocalLight,
  hashLightIndex,
  initLightSamplerStratified,
  isLightHidden,
  isLightVisible,
  lightSampleIndex,
  lightSampleVisible,
  lightSampleWeight,
  packLightSample,
  smoothFalloffMask,
} from './lightSamplerWgsl.ts'

const B = ML_BINDING

/** The voxels of a tile of the hash, along each axis. */
export const VOLUME_HASH_TILE = [4, 4, 2] as const
/** The words of a tile of the hash: the visible set's four, then the hidden set's two. */
export const VOLUME_HASH_WORDS = 6
export const VOLUME_SAMPLE_ENTRY = 'volumeSampleMain'
export const VOLUME_HASH_ENTRY = 'volumeHashMain'

/**
 * The uniform of a volume (`mlp`). `grid`: the voxels of the grid along each axis and the pixels of one; `down`: those of the downsampled grid and the shift of the factor;
 * `samples`: the samples of a voxel along x, y, z and in all; `flags`: whether the draw is guided by the image before, whether it holds a history, whether the lights are traced
 * through the distance field, whether the rays are merged; `flags2`: whether the sun joins, the image's number, whether the lights' power ratios are held, whether the depth pyramid
 * culls; `hashTiles`: the tiles of the history along each axis and where the ratios start in their buffer; `flags3`: whether the translucency volume shares the fog's samples, the domain (0 the
 * fog's grid, 1 the translucency volume's cascades), the columns and rows of the light grid; `sliceMap`: the depth law; `weights`: the least a sample's weight, the least estimate, the weight a
 * light hidden before keeps, and on a history miss; `more`: the sun's ratio and clamping weight, the most a sample weighs, and a hidden light's; `jitter`: the place in a voxel the samples are
 * taken at, and the fog's phase function anisotropy; `scales`: the inverse square's bias per cell radius, the edge fade per cell, the sun's rank (-1 none); `prev`: the view-projection of the
 * image before; the camera (`eye`, `forward`, `viewProj`, `inverseViewProj`); `misc`: the view's pixels, whether the view is orthographic, the pre-exposure; `depthMap`: the depth buffer's
 * map to a view depth; `cascades`: the translucency volume's two cascades, each the corner of its box and the size of a cell.
 */
export const VOLUME_PARAMS_WORDS = 128
const ML_PARAMS_WGSL = wgslBlock(
  'ML_PARAMS_WGSL',
  [],
  `struct MlVolume{
 grid:vec4u,down:vec4u,samples:vec4u,flags:vec4u,flags2:vec4u,hashTiles:vec4u,flags3:vec4u,
 sliceMap:vec4f,weights:vec4f,more:vec4f,jitter:vec4f,scales:vec4f,
 prev:mat4x4f,
 eye:vec4f,forward:vec4f,misc:vec4f,depthMap:vec4f,
 viewProj:mat4x4f,inverseViewProj:mat4x4f,
 cascades:array<vec4f,4>,
}
@group(0) @binding(${B.params}) var<uniform> mlp:MlVolume;`,
)

/** The grid's place in the world: the point of a cell, the cell of a point, the voxel a downsampled voxel draws at. */
export const ML_GRID_WGSL = wgslBlock(
  'ML_GRID_WGSL',
  [ML_PARAMS_WGSL, unprojectPoint, ndcToUv, uvToNdc, logSliceOfDepth, depthOfLogSlice, rand4dPcg32],
  `fn mlDepthAtSlice(slice:f32)->f32{return depthOfLogSlice(slice,mlp.sliceMap.xyz);}
/** The point (xyz) and the view depth (w) of the position 'c' of the grid, in voxels: the fog's froxel, or a cell of a cascade of the translucency volume (its cascades stacked along z). */
fn mlPoint(c:vec3f)->vec4f{
 if(mlp.flags3.y!=0u){
  let dim=f32(mlp.grid.x);
  let cascade=u32(clamp(floor(c.z/dim),0.0,1.0));
  let P=mlp.cascades[cascade*2u].xyz+vec3f(c.xy,c.z-f32(cascade)*dim)*mlp.cascades[cascade*2u].w;
  return vec4f(P,dot(P-mlp.eye.xyz,mlp.forward.xyz));
 }
 let depth=mlDepthAtSlice(max(c.z,0.0));
 let near=unprojectPoint(mlp.inverseViewProj,vec3f(uvToNdc(c.xy/vec2f(mlp.grid.xy)),1.0))-mlp.eye.xyz;
 let forward=mlp.forward.xyz;
 if(mlp.misc.z>0.5){return vec4f(mlp.eye.xyz+(near-dot(near,forward)*forward)+depth*forward,depth);}
 return vec4f(mlp.eye.xyz+depth*(near/dot(near,forward)),depth);
}
/** The position in voxels of the grid of the world point 'P'. */
fn mlCoordOf(P:vec3f)->vec3f{
 let clip=mlp.viewProj*vec4f(P,1.0);
 let uv=ndcToUv(clip.xy/clip.w);
 let depth=dot(P-mlp.eye.xyz,mlp.forward.xyz);
 return vec3f(uv*vec2f(mlp.grid.xy),logSliceOfDepth(max(depth,1e-4),mlp.sliceMap.xyz));
}
/** Where, in its 2 by 2 by 2 block, a downsampled voxel draws, by the image: a four-rooks pattern. */
fn mlVoxelJitter(d:vec3u)->vec3u{
 if(mlp.down.w==0u){return vec3u(0u);}
 let c=d%vec3u(2u);
 let li=(c.x+c.y*2u+c.z*4u+mlp.flags2.y)%8u;
 return vec3u(select(1u,0u,(li&4u)!=0u),select(0u,1u,(li&2u)!=0u),select(1u,0u,(li&1u)!=0u));
}
fn mlRandom(c:vec3u,salt:u32)->vec3f{
 let v=rand4dPcg32(vec4i(vec3i(c),i32(mlp.flags2.y+8u*salt)));
 return vec3f(v.xyz)/4294967295.0;
}
fn mlSampleCoord(d:vec3u,i:u32)->vec3u{return d*mlp.samples.xyz+vec3u(i%mlp.samples.x,i/mlp.samples.x,0u);}`,
)

/** The distance field's ray from 'P' toward 'goal' (metres), dithered by the voxel 'cell'; the trace program declares the field's six bindings. */
export const ML_WORLD_BLOCKED_WGSL = (field: number) =>
  wgslBlock(
    `ML_WORLD_BLOCKED_WGSL(${field})`,
    [globalDistanceFieldReadWgsl(0, field), globalDistanceFieldTraceWgsl(0, field)],
    `fn mlWorldBlocked(P:vec3f,goal:vec3f,cell:vec3u)->bool{
 let toward=goal-P;
 let length=max(sqrt(dot(toward,toward)),1e-4);
 var input=gdfTraceInput(gdfTranslated(P*${CENTIMETRES_PER_METRE}.0),toward/length,0.0,max(length-0.01,0.0)*${CENTIMETRES_PER_METRE}.0,1.0,1.0);
 input.rayBias=0.5;
 input.rayEndBias=0.5;
 input.dithered=true;
 input.ditherCoord=vec2f(cell.xy+cell.zz*7u);
 input.turn=f32(mlp.flags2.y&7u);
 return gdfTrace(input).hitTime>=0.0;
}`,
  )

/** The sampling's cull of a program that binds no depth pyramid: no voxel is found hidden. */
export const ML_NO_PYRAMID_WGSL = wgslBlock(
  'ML_NO_PYRAMID_WGSL',
  [],
  `fn fogFurthestOver(uv:vec4f,view:vec2f)->f32{return 0.0;}`,
)

/** The sampling and tracing of the voxels (`volumeSampleMain`); the program declares 'mlSamplesOut', the marks of the rays 'mlRaysOut', the history's sets 'mlHashHistory' and the ratios 'mlRatios', the light grid's lists
 *  'tileLights', the light functions' read and the depth pyramid's 'fogFurthestOver'. */
export const ML_SAMPLE_WGSL = wgslBlock(
  'ML_SAMPLE_WGSL',
  [
    ML_GRID_WGSL,
    VOLUME_LAMP_WGSL,
    hgPhase,
    lightStrengthWgsl('mlp.misc.w'),
    hashLightIndex,
    isLightVisible,
    isLightHidden,
    initLightSamplerStratified,
    addLightSample,
    candidateIndex,
    candidateVisible,
    candidateWeight,
    estimateLocalLight,
    smoothFalloffMask,
    packLightSample,
  ],
  `fn mlRatio(rank:u32)->f32{
 if(mlp.flags2.z==0u){return 1.0;}
 let at=mlp.hashTiles.w+rank;
 if(at>=arrayLength(&mlRatios)){return 1.0;}
 return bitcast<f32>(mlRatios[at]);
}
/** The rank light rank had in the view's image before, -1 for none (or while the ratios are not held): the buffer of ratios holds, after them, the ranks, as many words each. */
fn previousRankOf(rank:u32)->i32{
 if(mlp.flags2.z==0u){return -1;}
 let capacity=arrayLength(&mlRatios)/2u;
 if(rank>=capacity){return -1;}
 return i32(mlRatios[capacity+rank])-1;
}
/** Whether the voxel is not wholly behind the surfaces of its pixels, a margin of 'margin' voxels around it (the fog's grid alone). */
fn mlFroxelVisible(cell:vec3u,margin:f32)->bool{
 if(mlp.flags3.y!=0u||mlp.flags2.w==0u||mlp.misc.z>0.5){return true;}
 let near=mlDepthAtSlice(max(f32(cell.z)-margin,0.0));
 let g=vec2f(mlp.grid.xy);
 let box=saturate(vec4f((vec2f(cell.xy)-margin)/g,(vec2f(cell.xy)+1.0+margin)/g));
 return !(fogFurthestOver(box,mlp.misc.xy)>mlp.depthMap.x+mlp.depthMap.y/near);
}
/** The luminance a light gives the voxel's point, unshadowed, pre-exposed: in the fog's domain its colour times its volumetric scattering intensity, its attenuation as a medium sees it and the
 *  phase function; the translucency volume's its colour over pi times the attenuation; the larger of the two where they share the samples. */
fn mlLightLuminance(rank:u32,light:DirectLight,P:vec3f,toEye:vec3f,bias:f32)->f32{
 let sun=isSun(light);
 var seen=vec4f(-light.directionCone.xyz,1.0);
 if(!sun){seen=volumeLamp(light,P,bias);}
 var colour=dot(light.colorIntensity.rgb*lightFunctionOf(light,P),vec3f(0.3,0.59,0.11))*lightStrength(light)*seen.w;
 // The clouds above the point shade the sun the sampled lighting holds.
 if(sun){colour*=cloudShadowOnSurface(rank,P);}
 let translucent=colour*0.3183099;
 if(mlp.flags3.y!=0u){return translucent*mlp.misc.w;}
 let fog=colour*light.params.z*hgPhase(mlp.jitter.w,dot(seen.xyz,toEye));
 return select(fog,max(fog,translucent),mlp.flags3.x!=0u)*mlp.misc.w;
}
/** Offers the light 'rank' to the sampler of the voxel: the luminance of its light at the point, faded under the least weight; a light hidden in the image before
 *  drawn less, unless its power has fallen so that it could have been dropped. */
fn mlOffer(s:ptr<function,LightSampler>,rank:u32,P:vec3f,toEye:vec3f,bias:f32,visibleSet:vec4u,hasValid:bool){
 let light=directLights.items[rank];
 let sun=isSun(light);
 if(!sun){
  let toLight=light.positionRange.xyz-P;
  let shares=sharesOf(light);
  let power=dot(light.colorIntensity.rgb,vec3f(0.3,0.59,0.11))*lightStrength(light)*max(shares.x,shares.y);
  if(!isRect(light)&&estimateLocalLight(dot(toLight,toLight),power,1.0/max(light.positionRange.w,1e-6),light.shape.y,mlp.misc.w)<mlp.weights.y){return;}
 }
 let luminance=mlLightLuminance(rank,light,P,toEye,bias);
 var weight=luminance*smoothFalloffMask(luminance,mlp.weights.x);
 var visibleBefore=true;
 if(mlp.flags.x!=0u&&weight>0.0){
  let before=previousRankOf(rank);
  if(before>=0){
   visibleBefore=isLightVisible(visibleSet,u32(before));
   if(!visibleBefore){visibleBefore=luminance*mlRatio(rank)<mlp.weights.x;}
  }
 }
 if(weight<=0.0){return;}
 if(!visibleBefore){weight*=select(mlp.weights.w,mlp.weights.z,hasValid);}
 addLightSample(s,weight,rank,visibleBefore,!sun,mlp.samples.w,mlp.more.x,mlp.more.y);
}
fn mlClear(d:vec3u){
 for(var i=0u;i<mlp.samples.w;i++){
  textureStore(mlSamplesOut,vec3i(mlSampleCoord(d,i)),vec4u(${NO_LIGHT_INDEX}u|0x8000u,0u,0u,0u));
  textureStore(mlRaysOut,vec3i(mlSampleCoord(d,i)),vec4u(0u));
 }
}
@compute @workgroup_size(4,4,4)
fn ${VOLUME_SAMPLE_ENTRY}(@builtin(global_invocation_id) d:vec3u){
 if(any(d>=mlp.down.xyz)){return;}
 let translucency=mlp.flags3.y!=0u;
 let cell=(d<<vec3u(mlp.down.w))+mlVoxelJitter(d);
 if(any(cell>=mlp.grid.xyz)||!mlFroxelVisible(cell,3.0)){mlClear(d);return;}
 let P=mlPoint(vec3f(cell)+mlp.jitter.xyz).xyz;
 let toEyeFull=mlp.eye.xyz-P;
 var toEye=normalize(toEyeFull);
 if(mlp.misc.z>0.5){toEye=-mlp.forward.xyz;}
 // The inverse square is taken at a distance the cell's size longer than the real one in the fog; the translucency volume's cells take none of it.
 var bias=LAMP_BIAS;
 if(!translucency){
  let radius=max(length(P-mlPoint(vec3f(cell+vec3u(1u))+mlp.jitter.xyz).xyz)*mlp.scales.x,sqrt(LAMP_BIAS));
  bias=radius*radius;
 }
 // The tile the point was in, in the image before: through the reprojection in the fog's grid, the voxel itself in the translucency volume's.
 var hasValid=mlp.flags.y!=0u;
 var visibleSet=vec4u(0xFFFFFFFFu);
 var hiddenSet=vec2u(0u);
 if(mlp.flags.x!=0u&&mlp.flags.y!=0u){
  var before=cell;
  if(!translucency){
   let clip=mlp.prev*vec4f(P,1.0);
   let uv=ndcToUv(clip.xy/clip.w);
   let slice=logSliceOfDepth(max(clip.w,1e-4),mlp.sliceMap.xyz)*mlp.sliceMap.w;
   hasValid=clip.w>0.0&&all(uv>=vec2f(0.0))&&all(uv<=vec2f(1.0))&&slice>=0.0&&slice<=1.0;
   before=vec3u(floor(vec3f(saturate(uv),saturate(slice))*vec3f(mlp.grid.xyz)));
  }
  let tile=clamp(before/vec3u(${VOLUME_HASH_TILE.join('u,')}u),vec3u(0u),mlp.hashTiles.xyz-vec3u(1u));
  let at=((tile.z*mlp.hashTiles.y+tile.y)*mlp.hashTiles.x+tile.x)*${VOLUME_HASH_WORDS}u;
  visibleSet=vec4u(mlHashHistory[at],mlHashHistory[at+1u],mlHashHistory[at+2u],mlHashHistory[at+3u]);
  hiddenSet=vec2u(mlHashHistory[at+4u],mlHashHistory[at+5u]);
 }
 var draw=initLightSamplerStratified(mlRandom(d,0u).x,mlp.samples.w);
 let clipHere=mlp.viewProj*vec4f(P,1.0);
 let pixel=ndcToUv(clipHere.xy/clipHere.w)*mlp.misc.xy;
 let slice=cellSlice(gridCell(pixel,clipHere.z/clipHere.w,vec2u(mlp.flags3.z,mlp.flags3.w)));
 for(var index=0u;index<slice.y;index++){
  let rank=listedLight(slice,index);
  if(!listedDrawn(slice,rank)||!sampledTakes(rank)){continue;}
  mlOffer(&draw,rank,P,toEye,bias,visibleSet,hasValid);
 }
 if(mlp.flags2.x!=0u&&mlp.scales.w>=0.0){mlOffer(&draw,u32(mlp.scales.w),P,toEye,bias,visibleSet,hasValid);}
 for(var i=0u;i<mlp.samples.w;i++){
  let drawn=draw.packed[i];
  let rank=candidateIndex(drawn);
  var weight=candidateWeight(drawn);
  var visible=true;
  var casts=false;
  var traced=false;
  if(rank!=${NO_LIGHT_INDEX}u){
   let light=directLights.items[rank];
   weight=draw.weightSum/weight;
   casts=shadowsFog(light);
   var penumbra=true;
   if(mlp.flags.x!=0u&&hasValid){
    let before=previousRankOf(rank);
    if(before>=0){
     if(candidateVisible(drawn)){penumbra=isLightHidden(hiddenSet,u32(before));}else{penumbra=false;}
    }
   }
   let area=isRect(light)||light.shape.x>0.001||(!isSun(light)&&tubeHalfLengthOf(light)*2.0>0.01);
   var merged=false;
   if(mlp.flags.w!=0u&&!(area&&penumbra)&&i+1u<mlp.samples.w){
    if(candidateIndex(draw.packed[i+1u])==rank){weight=0.0;visible=false;merged=true;}
   }
   // The fog traces the lights that shadow it (and, where it shares its samples, the ones that shadow the translucency volume); the translucency volume those that cast a shadow.
   if((castsShadow(light)||simpleCastsSampled(rank))&&(((translucency||mlp.flags3.x!=0u)&&simpleInjected(rank))||casts)&&!merged&&mlp.flags.z!=0u){
    // The ray toward the point of the light the sample's place picks is traced afterwards (volumeTraceMain), over the samples marked here.
    traced=true;
   }
  }
  let guided=select(candidateVisible(drawn),true,mlp.flags.x==0u);
  textureStore(mlSamplesOut,vec3i(mlSampleCoord(d,i)),vec4u(packLightSample(rank,weight,visible,guided,casts),0u,0u,0u));
  textureStore(mlRaysOut,vec3i(mlSampleCoord(d,i)),vec4u(select(0u,1u,traced),0u,0u,0u));
 }
}`,
)

/** The samples the volume holds, read by load: declared by the programs that read them (the hash, the fog's scatter, the translucency volume's injection). */
const ML_SAMPLES_IN_WGSL = wgslBlock(
  'ML_SAMPLES_IN_WGSL',
  [],
  `@group(0) @binding(${B.samplesIn}) var mlSamplesIn:texture_storage_3d<r32uint,read>;`,
)

export const ML_HASH_WGSL = wgslBlock(
  'ML_HASH_WGSL',
  [
    ML_GRID_WGSL,
    ML_SAMPLES_IN_WGSL,
    hashLightIndex,
    lightSampleIndex,
    lightSampleVisible,
    lightSampleWeight,
  ],
  `@compute @workgroup_size(4,4,4)
fn ${VOLUME_HASH_ENTRY}(@builtin(global_invocation_id) tile:vec3u){
 if(any(tile>=mlp.hashTiles.xyz)){return;}
 var visibleSet=vec4u(0u);
 var hiddenSet=vec2u(0u);
 let size=vec3u(${VOLUME_HASH_TILE.join('u,')}u)>>vec3u(mlp.down.w);
 let first=tile*size;
 for(var z=0u;z<size.z;z++){
  for(var y=0u;y<size.y;y++){
   for(var x=0u;x<size.x;x++){
    let d=first+vec3u(x,y,z);
    if(any(d>=mlp.down.xyz)){continue;}
    for(var i=0u;i<mlp.samples.w;i++){
     let word=textureLoad(mlSamplesIn,vec3i(mlSampleCoord(d,i))).r;
     if(lightSampleIndex(word)==${NO_LIGHT_INDEX}u||lightSampleWeight(word)<=0.0){continue;}
     let h=hashLightIndex(lightSampleIndex(word));
     if(lightSampleVisible(word)){
      visibleSet[h&3u]|=1u<<((h>>4u)&31u);
      visibleSet[(h>>2u)&3u]|=1u<<((h>>9u)&31u);
     }else{
      hiddenSet[h&1u]|=1u<<((h>>2u)&31u);
      hiddenSet[(h>>1u)&1u]|=1u<<((h>>7u)&31u);
     }
    }
   }
  }
 }
 let at=((tile.z*mlp.hashTiles.y+tile.y)*mlp.hashTiles.x+tile.x)*${VOLUME_HASH_WORDS}u;
 mlHashOut[at]=visibleSet.x;mlHashOut[at+1u]=visibleSet.y;mlHashOut[at+2u]=visibleSet.z;mlHashOut[at+3u]=visibleSet.w;
 mlHashOut[at+4u]=hiddenSet.x;mlHashOut[at+5u]=hiddenSet.y;
}`,
)

/**
 * What the readers of the volume share: the voxels' samples around the world point 'P' (`mlSetsAt`: its voxel of the grid, found by the point in the fog's grid and by 'seed' in the translucency volume's, and for a downsampled grid two of the eight downsampled voxels
 * around it by the stochastic trilinear filter, `seed` the random number's place), then the lights they drew, in order of index (`mlLowest`, `mlTake`: the weight a light has in the sets, each
 * sample's held to the most a sample weighs and the identical samples merged in, over the samples taken). `translucent` reads the samples as traced; the fog reads a light that casts no shadow
 * in the fog as visible. The program declares `mlSamplesIn`.
 */
export const ML_SETS_WGSL = wgslBlock(
  'ML_SETS_WGSL',
  [ML_GRID_WGSL, ML_SAMPLES_IN_WGSL, lightSampleIndex, lightSampleVisible, lightSampleWeight],
  `struct MlSets{first:array<u32,4>,second:array<u32,4>,share:f32,}
/** The stochastic trilinear choice among the eight downsampled voxels around a voxel: the one the random number, over the weights' running sum, falls in. */
fn mlPick(r:f32,w0:vec4f,w1:vec4f)->vec3u{
 let total=dot(w0,vec4f(1.0))+dot(w1,vec4f(1.0));
 let t=r*total;
 var sum=0.0;
 var weights=array<f32,8>(w0.x,w0.y,w0.z,w0.w,w1.x,w1.y,w1.z,w1.w);
 for(var i=0u;i<8u;i++){
  sum+=weights[i];
  if(t<=sum&&weights[i]>0.0){return vec3u(i&1u,(i>>1u)&1u,i>>2u);}
 }
 return vec3u(1u);
}
fn mlLoad(d:vec3i,words:ptr<function,array<u32,4>>){
 let at=vec3u(clamp(d,vec3i(0),vec3i(mlp.down.xyz)-vec3i(1)));
 for(var i=0u;i<mlp.samples.w;i++){(*words)[i]=textureLoad(mlSamplesIn,vec3i(mlSampleCoord(at,i))).r;}
}
fn mlSetsAt(seed:vec3u,P:vec3f)->MlSets{
 var sets:MlSets;
 sets.share=1.0;
 for(var i=0u;i<4u;i++){sets.first[i]=${NO_LIGHT_INDEX}u|0x8000u;sets.second[i]=${NO_LIGHT_INDEX}u|0x8000u;}
 var voxel=min(seed,mlp.grid.xyz-vec3u(1u));
 if(mlp.flags3.y==0u){
  // The fog's grid is found by the point (the resample): one past the volume's far end is not lit by it, one outside the view takes the edge's voxel.
  let at=mlCoordOf(P);
  if(at.z>f32(mlp.grid.z)){return sets;}
  voxel=vec3u(clamp(vec3i(floor(vec3f(saturate(at.xy/vec2f(mlp.grid.xy)),saturate(at.z/f32(mlp.grid.z)))*vec3f(mlp.grid.xyz))),vec3i(0),vec3i(mlp.grid.xyz)-vec3i(1)));
 }
 if(mlp.down.w==0u){
  mlLoad(vec3i(voxel),&sets.first);
  return sets;
 }
 let d000=(vec3i(voxel)-vec3i(1))/2;
 let offset=vec3i(voxel)-d000*2;
 var w=array<f32,8>(0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0);
 for(var i=0u;i<8u;i++){
  let corner=vec3u(i&1u,(i>>1u)&1u,i>>2u);
  let o=vec3f(vec3i(mlVoxelJitter(vec3u(max(d000+vec3i(corner),vec3i(0)))))+vec3i(corner)*2-offset);
  w[i]=(2.0-abs(o.x))*(2.0-abs(o.y))*(2.0-abs(o.z));
 }
 let r=mlRandom(seed,7u).x;
 let w0=vec4f(w[0],w[1],w[2],w[3]);
 let w1=vec4f(w[4],w[5],w[6],w[7]);
 mlLoad(d000+vec3i(mlPick(r*0.5,w0,w1)),&sets.first);
 mlLoad(d000+vec3i(mlPick(r*0.5+0.5,w0,w1)),&sets.second);
 sets.share=0.5;
 return sets;
}
/** Whether a sample counts as visible: traced so; the fog also takes a light that casts no shadow in the fog (the sample's bit 15) as visible. */
fn mlVisible(word:u32,translucent:bool)->bool{return lightSampleVisible(word)||(!translucent&&((word>>15u)&1u)==0u);}
fn mlLowestIn(words:ptr<function,array<u32,4>>,translucent:bool)->u32{
 var next=${NO_LIGHT_INDEX}u;
 for(var i=0u;i<mlp.samples.w;i++){
  let index=lightSampleIndex((*words)[i]);
  if(mlVisible((*words)[i],translucent)&&index<next){next=index;}
 }
 return next;
}
fn mlLowest(sets:ptr<function,MlSets>,translucent:bool)->u32{
 var next=mlLowestIn(&(*sets).first,translucent);
 if(mlp.down.w!=0u){next=min(next,mlLowestIn(&(*sets).second,translucent));}
 return next;
}
fn mlTakeIn(words:ptr<function,array<u32,4>>,rank:u32,share:f32,translucent:bool,next:ptr<function,u32>,sum:ptr<function,f32>){
 var merged=1u;
 for(var i=0u;i<mlp.samples.w;i++){
  let word=(*words)[i];
  let visible=mlVisible(word,translucent);
  if(lightSampleIndex(word)==rank){
   if(lightSampleWeight(word)==0.0){merged++;}
   else if(visible){
    let guided=((word>>16u)&1u)!=0u;
    *sum+=min(lightSampleWeight(word),select(mlp.more.w,mlp.more.z,guided))*share*f32(merged);
    merged=1u;
   }
  }
  if(visible&&lightSampleIndex(word)>rank){*next=min(*next,lightSampleIndex(word));}
 }
}
/** The weight of the light 'rank' in the sets, over the samples taken; 'next' is lowered to the next light above it. */
fn mlTake(sets:ptr<function,MlSets>,rank:u32,translucent:bool,next:ptr<function,u32>)->f32{
 var weight=0.0;
 mlTakeIn(&(*sets).first,rank,(*sets).share,translucent,next,&weight);
 if(mlp.down.w!=0u){mlTakeIn(&(*sets).second,rank,(*sets).share,translucent,next,&weight);}
 return weight/f32(mlp.samples.w);
}`,
)

/** What the fog's scatter reads (`mlVolumeLight`): the light of the lights the voxels drew at the fog sample 'P' of 'cell', each at the sample's point. */
export const ML_SHADE_WGSL = wgslBlock(
  'ML_SHADE_WGSL',
  [ML_SETS_WGSL, smoothFalloffMask],
  `fn mlVolumeLight(cell:vec3u,P:vec3f,toEye:vec3f,bias:f32,fade:f32)->vec3f{
 var sets=mlSetsAt(cell,P);
 var sum=vec3f(0.0);
 var next=mlLowest(&sets,false);
 while(next<${NO_LIGHT_INDEX}u){
  let rank=next;
  next=${NO_LIGHT_INDEX}u;
  let weight=mlTake(&sets,rank,false,&next);
  if(weight>0.0){
   let light=directLights.items[rank];
   var term=vec3f(0.0);
   if(isSun(light)){term=fogSun(P,toEye,false);}else{term=fogLocal(rank,P,toEye,bias,fade,false);}
   let luminance=dot(term,vec3f(0.3,0.59,0.11))*mlp.misc.w;
   sum+=term*(weight*smoothFalloffMask(luminance,mlp.weights.x));
  }
 }
 return sum;
}`,
)
