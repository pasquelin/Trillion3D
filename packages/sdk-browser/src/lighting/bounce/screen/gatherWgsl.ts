import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { HALF_MAX, TWO_PI } from '../../../../../math/src/wgsl/constants.ts'
import { irradianceShader } from '../../../../../sdk-core/src/scene/core/irradianceBasis.ts'
import { IRRADIANCE_PROBE_SIDE } from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import { unpackLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { BLUE_NOISE_HALF_PERIOD, blueNoiseWgsl } from '../../../gpu/noise/blueNoiseWgsl.ts'
import { spCommon, spParams } from './commonWgsl.ts'
import { spProbes } from './probesWgsl.ts'
import { SCREEN_PROBE_FORMATS as F, bindingTable } from './screenProbeLayout.ts'

/** The composite's bindings: the probes' records and pixels, the ray words, what the trace wrote, the
 *  gathered texels written and the share of each probe's rays that move. */
export const COMPOSITE_BINDINGS = bindingTable({
  params: [0, 'uniform'],
  info: [1, 'float'],
  normal: [2, 'float'],
  counts: [3, 'buffer-read'],
  pixels: [4, 'buffer-read'],
  ray: [5, 'uint'],
  radiance: [6, 'uint'],
  hit: [7, 'uint'],
  gather: [8, { store: F.gather }],
  moving: [9, 'buffer'],
  blue: [10, 'float'],
})

/** The conversion's bindings: the probes' records, the gathered radiance, the irradiance written. */
export const CONVERT_BINDINGS = bindingTable({
  params: [0, 'uniform'],
  info: [1, 'float'],
  normal: [2, 'float'],
  counts: [3, 'buffer-read'],
  gather: [4, 'float'],
  irradiance: [5, { store: F.irradiance }],
})

const C = COMPOSITE_BINDINGS.at
const V = CONVERT_BINDINGS.at

/** The words of a texel's accumulator: three channels of fixed-point radiance, whether any ray fell in
 *  it, the nearest hit's distance (its bits: the order of positive floats is the order of their bits). */
const ACCUMULATED = 5

/**
 * One ray of a probe added to the texel of its octahedron it lands in (`spCompositeRay`): held to `maxRayIntensity`, weighed by the
 * share of the sphere it stands for ((`G / mip`)², `G` the gather's side: a refined ray, four times finer, a quarter), and added — in fixed
 * point, in workgroup memory: `0xFFFFFFFF` over the rays, so that no sum overflows — to one of the four texels round the point of
 * the octahedron it was traced through, the one the tile's blue noise picks by how near it is (`blueNoiseVec2` at the rays'
 * turn, offset by half the frames' period from the read that picked the ray's point): the octahedron's low resolution does not show, and a ray that moves a little moves
 * its light by a share of a texel. A texel keeps the distance of the nearest hit it received. The share of the probe's rays that
 * move is summed beside, a weight each in sixteen bits of fraction.
 */
const SP_COMPOSITE_RAY = wgslBlock(
  'SP_COMPOSITE_RAY',
  [unpackLight],
  `const SP_ACCUMULATED_WORDS:u32=SP_TEXELS*${ACCUMULATED}u;
const SP_MOVING_SCALE:f32=65536.0;
@group(0) @binding(${C.pixels}) var<storage,read> probePixels:array<u32>;
@group(0) @binding(${C.ray}) var rayWords:texture_2d<u32>;
@group(0) @binding(${C.radiance}) var radianceIn:texture_2d<u32>;
@group(0) @binding(${C.hit}) var hitIn:texture_2d<u32>;
var<workgroup> accumulated:array<atomic<u32>,SP_ACCUMULATED_WORDS>;
var<workgroup> movingWeight:atomic<u32>;
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
 if(strongest>sp.weights.w){lighting*=sp.weights.w/strongest;}
 let tile=spProbeTile(probePixels[index]);
 let texel=(vec2f(coord)+blueNoiseVec2(tile,sp.mode.w))*(f32(SP_GATHER)/mip)-vec2f(0.5);
 let floored=floor(texel);
 let shifted=select(vec2i(1),vec2i(0),texel-floored<blueNoiseVec2(tile,sp.mode.w+${BLUE_NOISE_HALF_PERIOD}u));
 let landed=octWrapBorder(vec2u(vec2i(floored)+shifted+vec2i(1)),SP_GATHER+2u,1u);
 let base=(landed.y*SP_GATHER+landed.x)*${ACCUMULATED}u;
 let fixed=vec3u(max(lighting,vec3f(0.0))*((4294967295.0/f32(SP_RAYS))/sp.weights.w));
 atomicAdd(&accumulated[base],fixed.x);
 atomicAdd(&accumulated[base+1u],fixed.y);
 atomicAdd(&accumulated[base+2u],fixed.z);
 atomicStore(&accumulated[base+3u],1u);
 atomicMin(&accumulated[base+4u],bitcast<u32>(spHitDistance(hitWord)));
 if(spHitMoves(hitWord)){atomicAdd(&movingWeight,u32(weight*SP_MOVING_SCALE));}
}`,
)

/**
 * THE COMPOSITE: a probe's traced rays gathered into its octahedron of `G × G` texels, the filter's (`G` the gather's side, the
 * tracing one's scaled by `screenProbeGatherScale`). A group a probe, a thread each ray (`spCompositeRay`) and each texel. A texel
 * keeps the distance of the nearest hit it received, `-1` when it received none; the radiance is its sum over the rays' weights, zero
 * where none fell. A probe keeps beside it the share of its rays that move (`probeMoving`): their weights over the texels' count, the
 * same sum the texels would give averaged.
 */
const SP_COMPOSITE = wgslBlock(
  'SP_COMPOSITE',
  [SP_COMPOSITE_RAY, HALF_MAX],
  `@group(0) @binding(${C.gather}) var gatherOut:texture_storage_2d<${F.gather},write>;
@group(0) @binding(${C.moving}) var<storage,read_write> probeMoving:array<f32>;
@compute @workgroup_size(SP_TRACE,SP_TRACE)
fn composite(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let atlas=group.xy;
 let index=spIndexOf(atlas);
 let t=vec2u(lane%SP_TRACE,lane/SP_TRACE);
 if(lane<SP_TEXELS){
  for(var word=0u;word<${ACCUMULATED - 1}u;word++){atomicStore(&accumulated[lane*${ACCUMULATED}u+word],0u);}
  atomicStore(&accumulated[lane*${ACCUMULATED}u+${ACCUMULATED - 1}u],bitcast<u32>(HALF_MAX));
 }
 if(lane==0u){atomicStore(&movingWeight,0u);}
 workgroupBarrier();
 let valid=spProbeOrDead(atlas).depth>0.0;
 if(valid){spCompositeRay(atlas,index,t);}
 workgroupBarrier();
 if(lane<SP_TEXELS){
  var out=vec4f(0.0,0.0,0.0,HALF_MAX);
  if(valid){
   let base=lane*${ACCUMULATED}u;
   let unscale=sp.weights.w*(f32(SP_RAYS)/4294967295.0);
   out=vec4f(vec3f(f32(atomicLoad(&accumulated[base])),f32(atomicLoad(&accumulated[base+1u])),f32(atomicLoad(&accumulated[base+2u])))*unscale,
    select(-1.0,bitcast<f32>(atomicLoad(&accumulated[base+4u])),atomicLoad(&accumulated[base+3u])>0u));
  }
  textureStore(gatherOut,vec2i(atlas*SP_GATHER+vec2u(lane%SP_GATHER,lane/SP_GATHER)),out);
 }
 if(lane==0u){probeMoving[index]=select(0.0,f32(atomicLoad(&movingWeight))/(SP_MOVING_SCALE*f32(SP_TEXELS)),valid);}
}`,
)

/** The composite's program over `side × side` rays a probe gathered into `gather × gather` texels, and `samples` of a tile. */
export const compositeShader = (side: number, gather: number, samples: readonly [number, number]) =>
  wgslProgram(
    `${spParams(C.params)}
${wgslConsts({ SP_TRACE: side, SP_RAYS: side * side, SP_GATHER: gather, SP_TEXELS: gather * gather })}`,
    [
      spCommon(samples),
      spProbes(C.info, C.normal, C.counts),
      blueNoiseWgsl(0, C.blue),
      SP_COMPOSITE,
    ],
  )

/**
 * THE CONVERSION TO IRRADIANCE: the probe's filtered radiance projected on the order-2 basis (`spBasis`: the mean over the
 * `G × G` texels, each the same solid angle, times 4π — the projection of a radiance sampled on the sphere in equal areas),
 * and kept as the pixels read it. A group a probe, a thread each texel (and more, where the gather is coarser than the rays). The nine coefficients of each channel are the
 * probe's: stored as they are (a texel a coefficient, nine to a probe) where the format is the harmonics', or evaluated at the
 * normals of an octahedral map of `IRRADIANCE_PROBE_SIDE` texels a side and a border of one (`irradianceShader`, never
 * negative; the border the texel its wrap names, `octWrapBorder`) where it is the octahedral irradiance. A probe that stands on
 * no lit surface holds zero.
 */
const SP_CONVERT = wgslBlock(
  'SP_CONVERT',
  [TWO_PI],
  `@group(0) @binding(${V.gather}) var gatherIn:texture_2d<f32>;
@group(0) @binding(${V.irradiance}) var irradianceOut:texture_storage_2d<${F.irradiance},write>;
const SP_BASIS_WORDS:u32=SP_TEXELS*9u;
var<workgroup> basis:array<f32,SP_BASIS_WORDS>;
var<workgroup> light:array<vec3f,SP_TEXELS>;
var<workgroup> coefficients:array<vec3f,9>;
fn spIrradianceAt(n:vec3f)->vec3f{
 return max(${irradianceShader((k) => `coefficients[${k}u]`, 'n')},vec3f(0.0));
}
@compute @workgroup_size(SP_TRACE,SP_TRACE)
fn convert(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let atlas=group.xy;
 let t=vec2u(lane%SP_GATHER,lane/SP_GATHER);
 let valid=spProbeOrDead(atlas).depth>0.0;
 if(lane<SP_TEXELS){
  let b=spBasis(equalAreaDecode((vec2f(t)+vec2f(0.5))/f32(SP_GATHER)));
  for(var k=0u;k<9u;k++){basis[lane*9u+k]=b[k];}
  light[lane]=select(vec3f(0.0),textureLoad(gatherIn,vec2i(atlas*SP_GATHER+t),0).rgb,valid);
 }
 workgroupBarrier();
 // 4π times the mean over the texels: the projection of a radiance sampled on the sphere in equal areas.
 for(var s=lane;s<9u;s+=SP_RAYS){
  var sum=vec3f(0.0);
  for(var i=0u;i<SP_TEXELS;i++){sum+=basis[i*9u+s]*light[i];}
  coefficients[s]=sum*(2.0*TWO_PI/f32(SP_TEXELS));
 }
 workgroupBarrier();
 if(!spFlag(SP_FLAG_OCTAHEDRAL)){
  for(var k=lane;k<9u;k+=SP_RAYS){textureStore(irradianceOut,vec2i(vec2u(atlas.x*9u+k,atlas.y)),vec4f(coefficients[k],0.0));}
  return;
 }
 let border=SP_OCT_SIDE+2u;
 for(var i=lane;i<border*border;i+=SP_RAYS){
  let texel=vec2u(i%border,i/border);
  let n=equalAreaDecode((vec2f(octWrapBorder(texel,border,1u))+vec2f(0.5))/f32(SP_OCT_SIDE));
  textureStore(irradianceOut,vec2i(atlas*border+texel),vec4f(spIrradianceAt(n),0.0));
 }
}`,
)

/** The conversion's program over the `gather × gather` texels of a probe, a group `side × side` threads wide, and `samples` of a tile. */
export const convertShader = (side: number, gather: number, samples: readonly [number, number]) =>
  wgslProgram(
    `${spParams(V.params)}
${wgslConsts({
  SP_TRACE: side,
  SP_RAYS: side * side,
  SP_GATHER: gather,
  SP_TEXELS: gather * gather,
  SP_OCT_SIDE: IRRADIANCE_PROBE_SIDE,
})}`,
    [spCommon(samples), spProbes(V.info, V.normal, V.counts), SP_CONVERT],
  )
