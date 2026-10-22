import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { TWO_PI } from '../../../../../math/src/wgsl/constants.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { rand3dPcg16 } from '../../../../../math/src/wgsl/sampling.ts'

/**
 * THE LIGHTNING VOLUME'S PROGRAMS: a cube of 64 texels a side with a mip chain, one grey value a
 * texel (written to all three colour channels, alpha one), read by the storm's flashes: sparse,
 * bright, compact blobs on a dark ground, tiling on every axis.
 *
 * A periodic grid of 8 cells a side holds one blob each, at a random point of its cell. A blob is a
 * Gaussian flattened along z (the axis the material animates along), cut to zero past a few
 * deviations, its height lognormal: a few blobs are bright, most faint. A texel sums the blobs of
 * the 27 cells around it. The measured volume is such a sum: heavy-tailed (skew 9.6, excess
 * kurtosis 173), a sixth of its texels exactly zero, about 385 local maxima with lognormal heights,
 * blobs about 2.2 texels across in the plane and 1 along z. The chain's levels are box averages of the level above, for the material's explicit mip read.
 */

/** Texels a side of the volume, and the mip levels of its chain, down to one texel. */
export const LIGHTNING_SIZE = 64
export const LIGHTNING_LEVELS = 7

/** Cells a side of the blob grid: 8, one blob each, which gives the 385 measured local maxima once
 *  neighbours merge. */
const LIGHTNING_CELLS = 8

/** The Gaussian's deviation in texels in the plane of x and y and along z, read off the mean profile
 *  around the reference volume's maxima (it falls to 0.38 at 3 texels in the plane, to 0.21 at 2
 *  along z). */
const LIGHTNING_SIGMA_PLANE = 2.2
const LIGHTNING_SIGMA_DEPTH = 1

/** The median of a blob's height and the spread of its logarithm, and the seed that picks the
 *  heights' realisation (it moves the height hash's cell, which the jitter hash does not): fitted
 *  so that the volume's mean, deviation, exact-zero fraction, fractions above 0.01, 0.1 and 0.5, and
 *  greatest value come out at 0.0188, 0.0628, 0.169, 0.291, 0.039, 0.0030 and 2.73 against the
 *  reference's 0.0194, 0.0642, 0.166, 0.252, 0.0495, 0.0030 and 2.71. */
const LIGHTNING_HEIGHT_MEDIAN = 0.05
const LIGHTNING_HEIGHT_SPREAD = 1.4
const LIGHTNING_HEIGHT_SEED = 300

/** The deviations past which a blob is cut to zero, fitted to the reference's exact-zero fraction
 *  (a sixth of its texels). */
const LIGHTNING_CUTOFF_SIGMAS = 3.3

/** Texels a thread group covers along each axis. */
export const LIGHTNING_GROUP = 4

export const LIGHTNING_ENTRY_POINTS = ['blobsMain', 'downsampleMain'] as const

const SOURCE = `
@group(0) @binding(0) var level:texture_storage_3d<rgba16float,write>;
@group(0) @binding(1) var finer:texture_3d<f32>;

const SIZE:i32=${LIGHTNING_SIZE};
const CELLS:i32=${LIGHTNING_CELLS};
const CELL_TEXELS:f32=${LIGHTNING_SIZE / LIGHTNING_CELLS}.0;
const CUTOFF=${wgslF32(LIGHTNING_CUTOFF_SIGMAS ** 2)};
const SIGMAS=vec3f(${wgslF32(LIGHTNING_SIGMA_PLANE)},${wgslF32(LIGHTNING_SIGMA_PLANE)},${wgslF32(LIGHTNING_SIGMA_DEPTH)});

// The height of the blob of a wrapped cell: lognormal, from a normal made of two of the words of a
// hash of the cell moved by the height seed on every axis, so that the height is unrelated to the
// cell's jitter, which hashes the cell itself (the two-uniform normal transform).
fn blobHeight(wrapped:vec3i)->f32{
 let words=vec2f(rand3dPcg16(wrapped+vec3i(${LIGHTNING_HEIGHT_SEED})).xy);
 let normal=sqrt(-2.0*log((words.x+0.5)/65536.0))*cos(TWO_PI*words.y/65536.0);
 return ${wgslF32(LIGHTNING_HEIGHT_MEDIAN)}*exp(${wgslF32(LIGHTNING_HEIGHT_SPREAD)}*normal);
}

@compute @workgroup_size(${LIGHTNING_GROUP},${LIGHTNING_GROUP},${LIGHTNING_GROUP})
fn blobsMain(@builtin(global_invocation_id) id:vec3u){
 let p=vec3f(id)+0.5;
 let base=vec3i(floor(p/CELL_TEXELS));
 var sum=0.0;
 for(var k=0;k<27;k++){
  let cell=base+vec3i(k%3-1,(k/3)%3-1,k/9-1);
  let wrapped=((cell%vec3i(CELLS))+vec3i(CELLS))%vec3i(CELLS);
  let centre=(vec3f(cell)+vec3f(rand3dPcg16(wrapped))/65536.0)*CELL_TEXELS;
  let d=(centre-p)/SIGMAS;
  let q=dot(d,d);
  if(q<CUTOFF){sum+=blobHeight(wrapped)*exp(-0.5*q);}
 }
 textureStore(level,id,vec4f(vec3f(sum),1.0));
}

// A level of the chain: the mean of the eight texels of the finer level it covers.
@compute @workgroup_size(${LIGHTNING_GROUP},${LIGHTNING_GROUP},${LIGHTNING_GROUP})
fn downsampleMain(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=textureDimensions(level))){return;}
 var sum=0.0;
 for(var k=0u;k<8u;k++){
  sum+=textureLoad(finer,id*2u+vec3u(k&1u,(k>>1u)&1u,k>>2u),0).x;
 }
 textureStore(level,id,vec4f(vec3f(sum*0.125),1.0));
}
`

/** The lightning volume's whole shader. */
export const LIGHTNING_CODE = wgslProgram(SOURCE, [rand3dPcg16, TWO_PI])
