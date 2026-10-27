import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { TWO_PI } from '../../../../../math/src/wgsl/constants.ts'
import { irradianceShader } from '../../../../../sdk-core/src/scene/core/irradianceBasis.ts'
import {
  IRRADIANCE_PROBE_SIDE,
  SCREEN_PROBE_CONSTANTS,
} from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import { ditherLight, packLight, unpackLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { BLUE_NOISE_HALF_PERIOD, blueNoiseWgsl } from '../../../gpu/noise/blueNoiseWgsl.ts'
import { SP_TARGET_DITHER, spCoefficientTexel, spCommon, spParams } from './commonWgsl.ts'
import { spProbes } from './probesWgsl.ts'
import { SCREEN_PROBE_FORMATS as F, bindingTable } from './screenProbeLayout.ts'

/** The composite's bindings: the probes' records and pixels, the ray words, what the trace wrote, the
 *  gathered texels written and the share of each probe's rays that move. */
export const COMPOSITE_BINDINGS = bindingTable({
  params: [0, 'uniform'],
  info: [1, 'float'],
  normal: [2, 'uint'],
  counts: [3, 'buffer-read'],
  pixels: [4, 'buffer-read'],
  ray: [5, 'uint'],
  radiance: [6, 'uint'],
  hit: [7, 'uint'],
  gather: [8, { store: F.gather }],
  moving: [9, 'buffer'],
  blue: [10, 'float'],
  ao: [11, { store: F.extraAo }],
})

/** The conversion's bindings: the probes' records, the gathered radiance, the irradiance written; with the extra ambient occlusion, the occlusion by
 *  direction it reads (the one by normal it writes in the irradiance's alpha). */
export const CONVERT_BINDINGS = bindingTable({
  params: [0, 'uniform'],
  info: [1, 'float'],
  normal: [2, 'uint'],
  counts: [3, 'buffer-read'],
  gather: [4, 'float'],
  irradiance: [5, { store: F.irradiance }],
  ao: [6, 'float'],
})

const C = COMPOSITE_BINDINGS.at
const V = CONVERT_BINDINGS.at

/** The layout of the composite's group: the extra ambient occlusion it writes only where the probes keep one. */
export const compositeEntries = (extraAo: boolean) =>
  COMPOSITE_BINDINGS.entries.filter((entry) => extraAo || entry.binding !== C.ao)

/** The layout of the conversion's group: the extra ambient occlusion it reads only where the probes keep one. */
export const convertEntries = (extraAo: boolean) =>
  CONVERT_BINDINGS.entries.filter((entry) => extraAo || entry.binding !== V.ao)

/** The words of a texel's accumulator: three channels of fixed-point radiance, whether any ray fell in
 *  it, the nearest hit's distance (its bits: the order of positive floats is the order of their bits), and the weight of the rays that move
 *  that fell in it, in the same fixed point. */
const ACCUMULATED = 6
const HIT_WORD = 4
const MOVING_WORD = 5

/**
 * WHAT A TARGET OF 11-11-10 BITS HOLDS, and the 8-bit code of a hit distance. The gathered texels are kept in a half-float texture, which holds
 * what the 11-11-10 target holds exactly: `spQuantize` is a colour dithered by the number `e` of [0, 1) and rounded to that format's mantissas. The
 * gathered texel's hit distance is kept as the whole number `spHitCode` makes of it, the square root of its share of the greatest
 * (`SCREEN_PROBE_CONSTANTS.radianceMaxHitDistance`) in the 254 steps above the first, rounded to the 255 an 8-bit unsigned normalised target has — the distance
 * `-1` of a texel no ray fell in is the code 0, the greatest distance the code 255 —, and `spHitFromCode` is the filter's reading of it.
 */
export const SP_QUANTIZE = wgslBlock(
  'SP_QUANTIZE',
  [unpackLight, packLight, ditherLight],
  `const SP_PROBE_MAX_HIT:f32=${wgslF32(SCREEN_PROBE_CONSTANTS.radianceMaxHitDistance)};
fn spQuantize(c:vec3f,e:f32)->vec3f{return unpackLight(packLight(ditherLight(c,e)));}
// A ratio of no weight is not a number, which the reference's eight-bit store writes as zero; WGSL leaves a clamp of it to the
// implementation, so its bits are read.
fn spExtraAoCode(ao:f32)->f32{return select(round(saturate(ao)*255.0),0.0,(bitcast<u32>(ao)&0x7fffffffu)>0x7f800000u);}
fn spExtraAoStored(ao:f32)->f32{return spExtraAoCode(ao)/255.0;}
fn spHitCode(distance:f32)->f32{
 if(!(distance>=0.0)){return 0.0;}
 return round(clamp(sqrt(distance/SP_PROBE_MAX_HIT)*(254.0/255.0)+1.0/255.0,0.0,1.0)*255.0);
}
fn spHitFromCode(code:f32)->f32{
 let encoded=code/255.0;
 return (encoded*encoded*SP_PROBE_MAX_HIT-1.0/255.0)*(255.0/254.0);
}`,
)

/**
 * One ray of a probe added to the texel of its octahedron it lands in (`spCompositeRay`): held to `maxRayIntensity`, weighed by the
 * share of the sphere it stands for ((`G / mip`)², `G` the gather's side: a refined ray, four times finer, a quarter), and added — in fixed
 * point, in workgroup memory: `0xFFFFFFFF` over the rays, so that no sum overflows — to one of the four texels round the point of
 * the octahedron it was traced through, the one the tile's blue noise picks by how near it is (`blueNoiseVec2` at the rays'
 * turn, offset by half the frames' period from the read that picked the ray's point): the octahedron's low resolution does not show, and a ray that moves a little moves
 * its light by a share of a texel. A texel keeps the distance of the nearest hit it received, and the weights of the rays that move, in the same
 * fixed point.
 */
const SP_COMPOSITE_RAY = wgslBlock(
  'SP_COMPOSITE_RAY',
  [unpackLight],
  `const SP_ACCUMULATED_WORDS:u32=SP_TEXELS*${ACCUMULATED}u;
@group(0) @binding(${C.pixels}) var<storage,read> probePixels:array<u32>;
@group(0) @binding(${C.ray}) var rayWords:texture_2d<u32>;
@group(0) @binding(${C.radiance}) var radianceIn:texture_2d<u32>;
@group(0) @binding(${C.hit}) var hitIn:texture_2d<u32>;
var<workgroup> accumulated:array<atomic<u32>,SP_ACCUMULATED_WORDS>;
fn spCompositeRay(atlas:vec2u,index:u32,t:vec2u){
 let at=vec2i(atlas*SP_TRACE+t);
 let word=textureLoad(rayWords,at,0).r;
 let hitWord=textureLoad(hitIn,at,0).r;
 let imported=spFlag(SP_FLAG_IMPORTANCE);
 let coord=select(t,spRayCoord(word),imported);
 let mip=f32(select(SP_TRACE,spRayMip(spRayLevel(word),SP_TRACE),imported));
 let weight=(f32(SP_GATHER)/mip)*(f32(SP_GATHER)/mip);
 var lighting=unpackLight(textureLoad(radianceIn,at,0).r)*weight;
 let strongest=max(lighting.x,max(lighting.y,lighting.z));
 if(strongest>spMaxRay()){lighting*=spMaxRay()/strongest;}
 let tile=spProbeTile(probePixels[index]);
 let texel=(vec2f(coord)+blueNoiseVec2(tile,sp.mode.w))*(f32(SP_GATHER)/mip)-vec2f(0.5);
 let floored=floor(texel);
 let shifted=select(vec2i(1),vec2i(0),texel-floored<blueNoiseVec2(tile,sp.mode.w+${BLUE_NOISE_HALF_PERIOD}u));
 let landed=octWrapBorder(vec2u(vec2i(floored)+shifted+vec2i(1)),SP_GATHER+2u,1u);
 let base=(landed.y*SP_GATHER+landed.x)*${ACCUMULATED}u;
 let share=4294967295.0/f32(SP_RAYS);
 let fixed=vec3u(max(lighting,vec3f(0.0))*(share/spMaxRay()));
 atomicAdd(&accumulated[base],fixed.x);
 atomicAdd(&accumulated[base+1u],fixed.y);
 atomicAdd(&accumulated[base+2u],fixed.z);
 atomicStore(&accumulated[base+3u],1u);
 atomicMin(&accumulated[base+${HIT_WORD}u],bitcast<u32>(spHitDistance(hitWord)));
 atomicAdd(&accumulated[base+${MOVING_WORD}u],select(0u,u32(weight*share),spHitMoves(hitWord)));
}`,
)

/**
 * THE COMPOSITE: a probe's traced rays gathered into its octahedron of `G × G` texels, the filter's (`G` the gather's side, the
 * tracing one's scaled by `screenProbeGatherScale`). A group a probe, a thread each ray (`spCompositeRay`) and each texel. A texel
 * keeps the distance of the nearest hit it received, as the 8-bit code `spHitCode` gives it (`0` where it received none), and the radiance
 * its rays gave, the sum of their weights, zero where none fell, as an 11-11-10 target holds it (`spQuantize`, dithered by a hash of the
 * texel and the frame). A texel's share of moving light is its rays' moving weights, held to an unsigned normalised byte; a probe keeps beside it
 * (`probeMoving`) the mean of its texels' bytes, as a byte too. A probe on no lit surface holds zero light and the greatest distance. With the extra
 * ambient occlusion, a texel keeps beside them how near its nearest hit lies, as an eight-bit number (`spExtraAoStored`): the distance over the furthest that counts
 * (`sp.screen.z`) to the power `sp.screen.w`, one where no ray fell in it and on a probe on no surface.
 */
const spComposite = (extraAo: boolean) =>
  wgslBlock(
    `SP_COMPOSITE(${extraAo})`,
    [SP_COMPOSITE_RAY, SP_QUANTIZE, SP_TARGET_DITHER],
    `@group(0) @binding(${C.gather}) var gatherOut:texture_storage_2d<${F.gather},write>;
${extraAo ? `@group(0) @binding(${C.ao}) var aoOut:texture_storage_2d<${F.extraAo},write>;\n` : ''}@group(0) @binding(${C.moving}) var<storage,read_write> probeMoving:array<f32>;
var<workgroup> movingBytes:atomic<u32>;
@compute @workgroup_size(SP_TRACE,SP_TRACE)
fn composite(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let atlas=group.xy;
 let index=spIndexOf(atlas);
 let t=vec2u(lane%SP_TRACE,lane/SP_TRACE);
 if(lane<SP_TEXELS){
  for(var word=0u;word<${ACCUMULATED}u;word++){atomicStore(&accumulated[lane*${ACCUMULATED}u+word],0u);}
  atomicStore(&accumulated[lane*${ACCUMULATED}u+${HIT_WORD}u],bitcast<u32>(SP_PROBE_MAX_HIT));
 }
 if(lane==0u){atomicStore(&movingBytes,0u);}
 workgroupBarrier();
 let valid=spProbeOrDead(atlas).depth>0.0;
 if(valid){spCompositeRay(atlas,index,t);}
 workgroupBarrier();
 if(lane<SP_TEXELS){
  let texel=atlas*SP_GATHER+vec2u(lane%SP_GATHER,lane/SP_GATHER);
  var out=vec4f(0.0,0.0,0.0,255.0);
${extraAo ? '  var ao=1.0;\n' : ''}  if(valid){
   let base=lane*${ACCUMULATED}u;
   let unscale=spMaxRay()*(f32(SP_RAYS)/4294967295.0);
   let light=vec3f(f32(atomicLoad(&accumulated[base])),f32(atomicLoad(&accumulated[base+1u])),f32(atomicLoad(&accumulated[base+2u])))*unscale;
   let e=spTargetDither(texel,0);
   let nearest=select(-1.0,bitcast<f32>(atomicLoad(&accumulated[base+${HIT_WORD}u])),atomicLoad(&accumulated[base+3u])>0u);
   out=vec4f(spQuantize(light,e),spHitCode(nearest));
${extraAo ? '   ao=select(1.0,pow(saturate(nearest/sp.screen.z),sp.screen.w),nearest>=0.0);\n' : ''}   let moving=round(saturate(f32(atomicLoad(&accumulated[base+${MOVING_WORD}u]))*(f32(SP_RAYS)/4294967295.0))*255.0);
   atomicAdd(&movingBytes,u32(moving));
  }
  textureStore(gatherOut,vec2i(texel),out);
${extraAo ? '  textureStore(aoOut,vec2i(texel),vec4f(spExtraAoStored(ao),0.0,0.0,0.0));\n' : ''} }
 workgroupBarrier();
 if(lane==0u){probeMoving[index]=select(0.0,round(f32(atomicLoad(&movingBytes))/f32(SP_TEXELS))/255.0,valid);}
}`,
  )

/** The composite's program over `side × side` rays a probe gathered into `gather × gather` texels, and `samples` of a tile; with the extra ambient occlusion where `extraAo`. */
export const compositeShader = (
  side: number,
  gather: number,
  samples: readonly [number, number],
  extraAo = false,
) =>
  wgslProgram(
    `${spParams(C.params)}
${wgslConsts({ SP_TRACE: side, SP_RAYS: side * side, SP_GATHER: gather, SP_TEXELS: gather * gather })}`,
    [
      spCommon(samples),
      spProbes(C.info, C.normal, C.counts),
      blueNoiseWgsl(0, C.blue),
      spComposite(extraAo),
    ],
  )

/**
 * THE CONVERSION TO IRRADIANCE: the probe's filtered radiance projected on the order-2 basis (`spBasis`: the mean over the
 * `G × G` texels, each the same solid angle, times 4π — the projection of a radiance sampled on the sphere in equal areas),
 * and kept as the pixels read it. A group a probe, a thread each texel (and more, where the gather is coarser than the rays). The nine coefficients of each channel are the
 * probe's: stored as they are (a texel a coefficient, nine to a probe) where the format is the harmonics', or evaluated at the
 * normals of an octahedral map of `IRRADIANCE_PROBE_SIDE` texels a side and a border of one (`irradianceShader`; the border the texel its wrap names, `octWrapBorder`) where it is the octahedral irradiance. The irradiance, and the constant
 * coefficient, are kept as an 11-11-10 target holds them (`spQuantize`), dithered by a hash of the texel and the frame. A probe that stands on
 * no lit surface holds zero. With the extra ambient occlusion, the texels' occlusion (`ao`, one where the texel received no ray: `aoWeight` zero) is projected on the same basis, with
 * the weight of the texels that hold one, and the alpha of the irradiance's block of the octahedron's side and border holds, at each normal, the first
 * evaluated with the cosine lobe (`spCosine`) over the second's, as its eight-bit code (`spExtraAoCode`): the occlusion the probe finds there; zero on a probe on no lit surface.
 * The block of a probe then holds its harmonics, where they are the format, in its first nine texels (`spCoefficientTexel`): the one texture carries both, a sampled texture of the integration spared.
 */
const spConvert = (extraAo: boolean) =>
  wgslBlock(
    `SP_CONVERT(${extraAo})`,
    [TWO_PI, SP_QUANTIZE, SP_TARGET_DITHER, ...(extraAo ? [] : [spCoefficientTexel(false)])],
    `@group(0) @binding(${V.gather}) var gatherIn:texture_2d<f32>;
@group(0) @binding(${V.irradiance}) var irradianceOut:texture_storage_2d<${F.irradiance},write>;
const SP_BASIS_WORDS:u32=SP_TEXELS*9u;
var<workgroup> basis:array<f32,SP_BASIS_WORDS>;
var<workgroup> light:array<vec3f,SP_TEXELS>;
var<workgroup> coefficients:array<vec3f,9>;
${
  extraAo
    ? `@group(0) @binding(${V.ao}) var aoIn:texture_2d<f32>;
var<workgroup> occlusion:array<vec2f,SP_TEXELS>;
var<workgroup> occlusionSum:array<vec2f,9>;`
    : ''
}
fn spIrradianceAt(n:vec3f)->vec3f{
 return ${irradianceShader((k) => `coefficients[${k}u]`, 'n')};
}
@compute @workgroup_size(SP_TRACE,SP_TRACE)
fn convert(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let atlas=group.xy;
 let t=vec2u(lane%SP_GATHER,lane/SP_GATHER);
 let valid=spProbeOrDead(atlas).depth>0.0;
 if(lane<SP_TEXELS){
  let b=spBasis(equalAreaDecode((vec2f(t)+vec2f(0.5))/f32(SP_GATHER)));
  for(var k=0u;k<9u;k++){basis[lane*9u+k]=b[k];}
  let kept=textureLoad(gatherIn,vec2i(atlas*SP_GATHER+t),0);
  light[lane]=select(vec3f(0.0),kept.rgb,valid);
${
  extraAo
    ? `  // A texel holds an occlusion where its rays gave a hit distance (the code of none is zero).
  let hasRay=valid&&spHitFromCode(kept.w)>=0.0;
  occlusion[lane]=select(vec2f(0.0),vec2f(textureLoad(aoIn,vec2i(atlas*SP_GATHER+t),0).r,1.0),hasRay);`
    : ''
}
 }
 workgroupBarrier();
 // 4π times the mean over the texels: the projection of a radiance sampled on the sphere in equal areas.
 for(var s=lane;s<9u;s+=SP_RAYS){
  var sum=vec3f(0.0);
  for(var i=0u;i<SP_TEXELS;i++){sum+=basis[i*9u+s]*light[i];}
  coefficients[s]=sum*(2.0*TWO_PI/f32(SP_TEXELS));
${
  extraAo
    ? `  var sumAo=vec2f(0.0);
  for(var i=0u;i<SP_TEXELS;i++){sumAo+=basis[i*9u+s]*occlusion[i];}
  occlusionSum[s]=sumAo;`
    : ''
}
 }
 workgroupBarrier();
${
  extraAo
    ? ''
    : ` if(!spFlag(SP_FLAG_OCTAHEDRAL)){
  for(var k=lane;k<9u;k+=SP_RAYS){
   // The constant coefficient is the 11-11-10 target of the ambient light, dithered by the probe; the others are halves as they are.
   let coefficient=select(coefficients[k],spQuantize(coefficients[k],spTargetDither(atlas,0)),k==0u);
   textureStore(irradianceOut,spCoefficientTexel(atlas,k),vec4f(coefficient,0.0));
  }
  return;
 }
`
} let border=SP_OCT_SIDE+2u;
 for(var i=lane;i<border*border;i+=SP_RAYS){
  let texel=vec2u(i%border,i/border);
  let n=equalAreaDecode((vec2f(octWrapBorder(texel,border,1u))+vec2f(0.5))/f32(SP_OCT_SIDE));
  let at=atlas*border+texel;
${
  extraAo
    ? `  // The block of the probe holds its irradiance, or, in the first nine texels, its harmonics (the constant coefficient an 11-11-10 target, dithered by the probe; the others halves as they are).
  var irradiance=vec3f(0.0);
  if(spFlag(SP_FLAG_OCTAHEDRAL)){irradiance=spQuantize(spIrradianceAt(n),spTargetDither(at,0));}
  else if(i<9u){irradiance=select(coefficients[i],spQuantize(coefficients[i],spTargetDither(atlas,0)),i==0u);}
  // The occlusion over the weight of the texels that hold one, both under the cosine lobe of the texel's direction, as an eight-bit code in the alpha.
  let lobe=spCosine(n);
  var total=vec2f(0.0);
  for(var k=0u;k<9u;k++){total+=occlusionSum[k]*lobe[k];}
  textureStore(irradianceOut,vec2i(at),vec4f(irradiance,spExtraAoCode(select(0.0,total.x/total.y,valid))));`
    : `  textureStore(irradianceOut,vec2i(at),vec4f(spQuantize(spIrradianceAt(n),spTargetDither(at,0)),0.0));`
}
 }
}`,
  )

/** The conversion's program over the `gather × gather` texels of a probe, a group `side × side` threads wide, and `samples` of a tile; with the extra ambient occlusion where `extraAo`. */
export const convertShader = (
  side: number,
  gather: number,
  samples: readonly [number, number],
  extraAo = false,
) =>
  wgslProgram(
    `${spParams(V.params)}
${wgslConsts({
  SP_TRACE: side,
  SP_RAYS: side * side,
  SP_GATHER: gather,
  SP_TEXELS: gather * gather,
  SP_OCT_SIDE: IRRADIANCE_PROBE_SIDE,
})}`,
    [spCommon(samples), spProbes(V.info, V.normal, V.counts), spConvert(extraAo)],
  )
