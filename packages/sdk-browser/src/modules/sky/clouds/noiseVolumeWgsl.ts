import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslF32, wgslVec3 } from '../../../../../math/src/wgsl/number.ts'

/**
 * THE NOISE VOLUME'S PROGRAM: a cube of 128 texels a side, four channels, tiling with period 128 on
 * every axis, written by one kernel straight into the texture, a thread to a texel, at the texel's
 * coordinate in the unit cube (the texel index over 128, no half-texel shift, so that the grids'
 * lattice points fall on texels).
 *
 * - G, B and A are weighted sums of three or two octaves of inverted cellular noise (one minus the
 *   distance to the nearest feature point, saturated), the grids doubling in cells from one octave
 *   to the next: G over 4, 8 and 16 cells, B over 8, 16 and 32, A over 16 and 32 (two octaves).
 *   Each channel is the one before it with its frequencies doubled.
 * - R is a classic periodic gradient-noise fractal, three octaves from 2 cells, joined to a sum of
 *   three octaves of the cellular noise over 2, 8 and 14 cells by `W + P · (1 − W)`: the gradient
 *   noise spread between the cellular one and one.
 * - Each channel is then moved and stretched to the mean and spread of the reference volume's
 *   (`NOISE_CHANNEL_LEVELS`) and held in [0, 1], as the reference's 8-bit volume holds it.
 *
 * The cells, the distance (not its square) and the levels are those of the volume the reference
 * material reads (its "balanced" Perlin-Worley volume, 128 texels a side), whose generator is not
 * published: measured on its texels, the radial power spectrum of each channel (cumulative median
 * at 1, 2, 4 and 9 cycles a tile for R, G, B, A, where the author's public generator gives 4, 4, 8
 * and 14), its histogram and its mean and standard deviation.
 */

/** Texels a side of the volume. */
export const NOISE_VOLUME_SIZE = 128

/** Per channel R, G, B, A: the cells a side of the cellular octaves and their weights. R's sum is
 *  the one the gradient noise is spread over; A has two octaves, its third weight 0. */
const NOISE_CHANNEL_OCTAVES = [
  { cells: [2, 8, 14], weights: [0.625, 0.25, 0.125] },
  { cells: [4, 8, 16], weights: [0.625, 0.25, 0.125] },
  { cells: [8, 16, 32], weights: [0.625, 0.25, 0.125] },
  { cells: [16, 32, 32], weights: [0.75, 0.25, 0] },
] as const

/** Per channel R, G, B, A: the mean and the standard deviation the generated channel is moved and
 *  stretched to (the reference volume's, measured on its texels), and the generated channel's own
 *  (measured on this program's output), so that `v' = (v − own mean) · wanted std / own std + wanted mean`. */
const NOISE_CHANNEL_LEVELS = [
  { mean: 0.534, std: 0.145, ownMean: 0.7383, ownStd: 0.0749 },
  { mean: 0.451, std: 0.178, ownMean: 0.4879, ownStd: 0.1158 },
  { mean: 0.433, std: 0.182, ownMean: 0.4879, ownStd: 0.1153 },
  { mean: 0.45, std: 0.175, ownMean: 0.4872, ownStd: 0.134 },
] as const

/** The gradient fractal's first octave's cells a side and its octave count; each octave has twice
 *  the cells of the one before and the square of its weight (0.5, 0.25, 0.0625). */
const GRADIENT_FREQUENCY = 2
const GRADIENT_OCTAVES = 3

/** Texels a thread group covers along each axis. */
export const NOISE_GROUP = 4

/** The greatest index a hashed lattice point takes, `x + 57 y + 113 z` with each of x, y, z below
 *  the finest grid's cells: the size of the table of hashed numbers is one more. */
const NOISE_HASH_TABLE_SIZE =
  Math.max(...NOISE_CHANNEL_OCTAVES.flatMap((c) => c.cells)) * 171 - 170

/** The table of hashed numbers of the lattice indices, in single precision as the cells read them:
 *  `fract(sin(n + 1.951) · 43758.5453)` for every whole `n`, each step rounded to a float. A shader's
 *  sine of an argument this large is only good to about a thousandth of a radian, which times 43758
 *  would make every number unrelated to the exact one, so the hash is computed here, once. */
export function noiseHashTable() {
  const offset = Math.fround(1.951)
  const scale = Math.fround(43758.5453)
  return Float32Array.from({ length: NOISE_HASH_TABLE_SIZE }, (_, n) => {
    const product = Math.fround(Math.fround(Math.sin(Math.fround(n + offset))) * scale)
    return Math.fround(product - Math.floor(product))
  })
}

export const NOISE_VOLUME_ENTRY_POINTS = ['noiseMain'] as const

const SOURCE = `
@group(0) @binding(0) var volume:texture_storage_3d<rgba16float,write>;
@group(0) @binding(1) var<storage,read> hashTable:array<f32>;

const SIZE:f32=${NOISE_VOLUME_SIZE}.0;
const CHANNEL_CELLS=array<vec3f,4>(${NOISE_CHANNEL_OCTAVES.map((c) => wgslVec3(c.cells)).join(',')});
const CHANNEL_WEIGHTS=array<vec3f,4>(${NOISE_CHANNEL_OCTAVES.map((c) => wgslVec3(c.weights)).join(',')});
// Per channel, the factor and the offset that move the generated value to the reference's levels.
const CHANNEL_SCALE=vec4f(${NOISE_CHANNEL_LEVELS.map((l) => wgslF32(l.std / l.ownStd)).join(',')});
const CHANNEL_OFFSET=vec4f(${NOISE_CHANNEL_LEVELS.map((l) => wgslF32(l.mean - (l.ownMean * l.std) / l.ownStd)).join(',')});

// A hashed number in [0, 1) of a whole number: the fraction of a large multiple of a sine, read
// from the table the host made (noiseHashTable in the host).
fn hashValue(n:f32)->f32{return hashTable[u32(n)];}

// The feature point of a cell of a grid is its lattice point moved along the cell's diagonal by a
// hashed number: the value noise of the lattice point, which at a lattice point is the hash of the
// point's index (x + 57 y + 113 z, the cell wrapped by the grid's cells so that the grid tiles).
fn featureOffset(cell:vec3i,cells:i32)->f32{
 let wrapped=((cell%vec3i(cells))+vec3i(cells))%vec3i(cells);
 return hashValue(f32(wrapped.x+57*wrapped.y+113*wrapped.z));
}

// One minus the distance, in cells and at most one, to the nearest feature point of the periodic
// grid of 'cells' cells a side: the 27 cells around the one holding 'p' are searched.
fn invertedCells(p:vec3f,cells:f32)->f32{
 let scaled=p*cells;
 let base=vec3i(floor(scaled));
 var nearest=1e10;
 for(var k=0;k<27;k++){
  let cell=base+vec3i(k%3-1,(k/3)%3-1,k/9-1);
  let d=scaled-vec3f(cell)-vec3f(featureOffset(cell,i32(cells)));
  nearest=min(nearest,dot(d,d));
 }
 return 1.0-clamp(sqrt(nearest),0.0,1.0);
}

// The octaves of 'channel' summed by their weights; the third is skipped when its weight is zero.
fn cellularSum(p:vec3f,channel:u32)->f32{
 let cells=CHANNEL_CELLS[channel];
 let weights=CHANNEL_WEIGHTS[channel];
 var sum=weights.x*invertedCells(p,cells.x)+weights.y*invertedCells(p,cells.y);
 if(weights.z>0.0){sum+=weights.z*invertedCells(p,cells.z);}
 return sum;
}

// The permutation polynomial that scrambles a lattice index, modulo 289. The argument is a whole
// number below 321 (a remainder under 289 plus a lattice index under 32), so the polynomial stays below 2^24, where a float holds every integer, and
// the modulo is taken on the integer.
fn permute(x:f32)->f32{
 return f32(u32((x*34.0+1.0)*x)%289u);
}

// The gradient in four dimensions of a scrambled index: the index spread over a 7 by 7 by 6 grid of
// the cube [-0.5, 0.5]^3, the fourth component completing a taxicab length of 0.75, the first two
// folded to the other side where that component would be negative, then scaled to about unit length
// by a Taylor series of the inverse square root.
fn gradient4(index:f32)->vec4f{
 var gx=index*(1.0/7.0);
 var gy=floor(gx)*(1.0/7.0);
 var gz=floor(gy)*(1.0/6.0);
 gx=fract(gx)-0.5;
 gy=fract(gy)-0.5;
 gz=fract(gz)-0.5;
 let gw=0.75-abs(gx)-abs(gy)-abs(gz);
 let folded=select(0.0,1.0,gw<=0.0);
 gx-=folded*(select(0.0,1.0,gx>=0.0)-0.5);
 gy-=folded*(select(0.0,1.0,gy>=0.0)-0.5);
 let g=vec4f(gx,gy,gz,gw);
 return g*(1.79284291400159-0.85373472095314*dot(g,g));
}

// Classic periodic gradient noise in four dimensions at 'p', repeating every 'repeat' cells on each
// axis, scaled by 2.2 to span about [-1, 1]: the sixteen corners' gradients dotted with the offsets to
// them, blended by the quintic fade.
fn gradientNoise4(p:vec4f,repeat:f32)->f32{
 let floor0=floor(p);
 let period=i32(repeat);
 let low=vec4f(((vec4i(floor0)%period)+period)%period);
 let high=vec4f(((vec4i(floor0)+1)%period+period)%period);
 let near=p-floor0;
 let far=near-1.0;
 let fade=near*near*near*(near*(near*6.0-15.0)+10.0);
 var sum=0.0;
 for(var k=0;k<16;k++){
  let corner=vec4<bool>((k&1)!=0,(k&2)!=0,(k&4)!=0,(k&8)!=0);
  let at=select(low,high,corner);
  let index=permute(permute(permute(permute(at.x)+at.y)+at.z)+at.w);
  let toCorner=select(near,far,corner);
  let w=select(vec4f(1.0)-fade,fade,corner);
  sum+=w.x*w.y*w.z*w.w*dot(gradient4(index),toCorner);
 }
 return 2.2*sum;
}

// The gradient fractal at 'p' in the unit cube: octaves of the noise at its first coordinates and
// the fourth held at 0, each with twice the cells, its weights 0.5 squared again each octave, in
// [0, 1].
fn gradientFractal(p:vec3f)->f32{
 var sum=0.0;
 var weightSum=0.0;
 var weight=0.5;
 var frequency=${wgslF32(GRADIENT_FREQUENCY)};
 for(var i=0;i<${GRADIENT_OCTAVES};i++){
  sum+=weight*gradientNoise4(vec4f(p*frequency,0.0),frequency);
  weightSum+=weight;
  weight*=weight;
  frequency*=2.0;
 }
 return clamp(sum/weightSum*0.5+0.5,0.0,1.0);
}

@compute @workgroup_size(${NOISE_GROUP},${NOISE_GROUP},${NOISE_GROUP})
fn noiseMain(@builtin(global_invocation_id) id:vec3u){
 let p=vec3f(id)/SIZE;
 let cellular=cellularSum(p,0u);
 let r=cellular+gradientFractal(p)*(1.0-cellular);
 let raw=vec4f(r,cellularSum(p,1u),cellularSum(p,2u),cellularSum(p,3u));
 textureStore(volume,id,saturate(raw*CHANNEL_SCALE+CHANNEL_OFFSET));
}
`

/** The noise volume's whole shader. */
export const NOISE_VOLUME_CODE = wgslProgram(SOURCE, [])
