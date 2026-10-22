import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { wgslFloats } from './generation.ts'
import { GRADIENT_NOISE } from './gradientFractalWgsl.ts'

/**
 * THE LAYOUT PATTERN'S PROGRAMS: a square of 1024 texels a side that tiles, four independent
 * channels (one per cloud type), each a clamped distance field, built by four kernels.
 *
 * A channel starts as a periodic gradient fractal (5 octaves, gain 0.5) warped twice by itself. The
 * field is cut at the quantile that leaves the measured fraction of the texels inside, and the
 * channel is the distance from an inside texel to the nearest outside one, over the ramp length,
 * clamped to [0, 1]: zero outside, rising by one ramp length to one. The distance is exact (the
 * squared distance transform, a column pass then a row pass, wrapping), and reaches no further than
 * the ramp, as the clamp ends it there.
 *
 * Two channels repeat inside the tile, as the measured layout does: the field of G is periodic on
 * the lattice spanned by (512, 512) and (512, -512) texels, that of B on the one spanned by
 * (256, 256) and (256, -256), so that the whole tile holds 2 and 8 copies on a checkerboard.
 */

/** Texels a side of the pattern. */
export const PATTERN_SIZE = 1024

/** The ramp length in texels of each channel R, G, B, A: the constant slope of its distance field,
 *  1 / 64, 1 / 30, 1 / 35, 1 / 86 a texel, read from the mode of the reference channels' gradient
 *  magnitudes (0.0156, 0.0337, 0.0284, 0.0117). */
const PATTERN_RAMP_TEXELS = [64, 30, 35, 86] as const

/** The fraction of each channel's texels that are inside (above zero), measured on the reference
 *  layout: 0.756, 0.872, 0.860, 0.919, so that 24 %, 13 %, 14 % and 8 % are exactly zero. */
const PATTERN_INSIDE_FRACTIONS = [0.756, 0.872, 0.86, 0.919] as const

/** The texels after which each channel's field repeats along the diagonal, measured by
 *  autocorrelation: R and A are unique over the tile (1024), G repeats at (512, 512), B at
 *  (256, 256). */
const PATTERN_REPEAT_TEXELS = [1024, 512, 256, 1024] as const

/** The field of each channel R, G, B, A: the cells of its first octave along the tile, the gain
 *  between its octaves, the size of each of its two warps in tiles, its octaves, and the salt of
 *  its grids (a multiple of 64, wider than the octaves). Fitted by search, the fields hashed as the
 *  shader hashes them, to the reference channels' mean, standard deviation, fraction of ones,
 *  16-bin histogram and autocorrelation half width; the predicted values are in the comment of each. */
const PATTERN_FIELDS = [
  // R: mean 0.203 / 0.203, std 0.243 / 0.260, ones 0.018 / 0.012, half width 53 / 61 texels.
  { cells: 4, gain: 0.6526, warp: 0.241, octaves: 5, salt: 576 },
  // G: mean 0.265 / 0.268, std 0.280 / 0.314, ones 0.047 / 0.037, half width 31 / 34 texels; the
  // histogram stays far (L1 0.34 against 0.08): the measured channel holds a near-zero toe that a
  // distance to a thresholded field does not give.
  { cells: 6, gain: 0.6816, warp: 0.2281, octaves: 6, salt: 192 },
  // B: mean 0.150 / 0.140, std 0.155 / 0.156, ones 0 / 0, half width 17 / 16 texels.
  { cells: 6, gain: 0.7268, warp: 0.1817, octaves: 5, salt: 192 },
  // A: mean 0.263 / 0.254, std 0.232 / 0.242, ones 0.005 / 0.003, half width 47 / 55 texels.
  { cells: 8, gain: 0.5141, warp: 0.236, octaves: 5, salt: 320 },
] as const

/** Texels a thread group covers along each axis. */
export const PATTERN_GROUP = 16

/** Bins of the histogram the quantile is read from, per channel: one a thread of a group, which
 *  pours its bin of each channel into the whole histogram. */
export const PATTERN_BINS = PATTERN_GROUP * PATTERN_GROUP

export const PATTERN_ENTRY_POINTS = ['fieldMain', 'thresholdMain', 'columnMain', 'rowMain'] as const

const SOURCE = `
@group(0) @binding(0) var<storage,read_write> fields:array<vec4f>;
@group(0) @binding(1) var<storage,read_write> columns:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> histogram:array<atomic<u32>,${4 * PATTERN_BINS}>;
@group(0) @binding(3) var<storage,read_write> thresholds:array<f32,4>;
@group(0) @binding(4) var layoutPattern:texture_storage_2d<rgba16float,write>;

const SIZE:i32=${PATTERN_SIZE};
const BINS:u32=${PATTERN_BINS}u;
const TEXELS=${PATTERN_SIZE * PATTERN_SIZE}.0;
${wgslFloats('RAMP', PATTERN_RAMP_TEXELS)}
${wgslFloats(
  'OUTSIDE',
  PATTERN_INSIDE_FRACTIONS.map((inside) => 1 - inside),
)}
${wgslFloats('REPEAT', PATTERN_REPEAT_TEXELS)}
const FIELDS=array<vec4f,4>(${PATTERN_FIELDS.map((f) => `vec4f(${[f.cells, f.gain, f.warp, f.octaves].map(wgslF32).join(',')})`).join(',')});
const SALTS=array<i32,4>(${PATTERN_FIELDS.map((f) => f.salt).join(',')});

fn texelIndex(p:vec2i)->u32{
 let wrapped=(p+vec2i(SIZE))&vec2i(SIZE-1);
 return u32(wrapped.x+wrapped.y*SIZE);
}

// The point of a channel's periodic domain, one unit a side, that texel 'p' lies at: the tile
// itself, or, for a channel that repeats along the diagonal, the tile turned by a quarter and
// scaled so that a shift by the repeat is one unit.
fn channelPoint(p:vec2f,c:u32)->vec2f{
 if(REPEAT[c]>=f32(SIZE)){return p/f32(SIZE);}
 return vec2f(p.x+p.y,p.x-p.y)/(2.0*REPEAT[c]);
}

// The channel's field at 'p' in [0, 1]: the fractal warped twice by itself, centred on one half so
// that its histogram falls inside the bins.
fn channelField(p:vec2f,c:u32)->f32{
 let f=FIELDS[c];
 let field=warpedFractal(channelPoint(p,c),i32(f.x),i32(f.w),f.y,SALTS[c],f.z);
 return clamp(0.5+field,0.0,1.0);
}

var<workgroup> groupBins:array<atomic<u32>,${4 * PATTERN_BINS}>;

// The four fields of each texel, and the group's histogram of them poured into the whole one.
@compute @workgroup_size(${PATTERN_GROUP},${PATTERN_GROUP})
fn fieldMain(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32){
 for(var k=0u;k<4u;k++){atomicStore(&groupBins[lane+k*BINS],0u);}
 workgroupBarrier();
 var value:vec4f;
 for(var c=0u;c<4u;c++){
  value[c]=channelField(vec2f(id.xy)+0.5,c);
  atomicAdd(&groupBins[c*BINS+min(u32(value[c]*f32(BINS)),BINS-1u)],1u);
 }
 fields[texelIndex(vec2i(id.xy))]=value;
 workgroupBarrier();
 for(var k=0u;k<4u;k++){
  let n=atomicLoad(&groupBins[lane+k*BINS]);
  if(n!=0u){atomicAdd(&histogram[lane+k*BINS],n);}
 }
}

// The value below which a channel's outside fraction of the texels lie, read off its histogram and
// interpolated inside the bin that crosses it.
@compute @workgroup_size(4)
fn thresholdMain(@builtin(global_invocation_id) id:vec3u){
 let c=id.x;
 let goal=OUTSIDE[c]*TEXELS;
 var below=0.0;
 var cut=1.0;
 for(var b=0u;b<BINS;b++){
  let n=f32(atomicLoad(&histogram[c*BINS+b]));
  if(below+n>=goal){cut=(f32(b)+(goal-below)/max(n,1.0))/f32(BINS);break;}
  below+=n;
 }
 thresholds[c]=cut;
}

fn outside(p:vec2i,c:u32)->bool{return fields[texelIndex(p)][c]<thresholds[c];}

// Per column, the squared distance from a texel to the nearest outside texel of its own column, up
// to the ramp (a texel past it counts the ramp plus one, which the clamp makes the same).
@compute @workgroup_size(${PATTERN_GROUP},${PATTERN_GROUP})
fn columnMain(@builtin(global_invocation_id) id:vec3u){
 let p=vec2i(id.xy);
 var result:vec4f;
 for(var c=0u;c<4u;c++){
  let reach=i32(RAMP[c]);
  var gap=reach+1;
  if(outside(p,c)){gap=0;}
  for(var d=1;d<=min(reach,gap-1);d++){
   if(outside(p+vec2i(0,d),c)||outside(p-vec2i(0,d),c)){gap=d;}
  }
  result[c]=f32(gap*gap);
 }
 columns[texelIndex(p)]=result;
}

// The distance transform's second pass: the nearest outside texel over the row's columns, then the
// distance over the ramp, clamped.
@compute @workgroup_size(${PATTERN_GROUP},${PATTERN_GROUP})
fn rowMain(@builtin(global_invocation_id) id:vec3u){
 let p=vec2i(id.xy);
 var result:vec4f;
 for(var c=0u;c<4u;c++){
  let reach=i32(RAMP[c]);
  var nearest=f32((reach+1)*(reach+1));
  for(var dx=-reach;dx<=reach;dx++){
   nearest=min(nearest,f32(dx*dx)+columns[texelIndex(p+vec2i(dx,0))][c]);
  }
  result[c]=clamp(sqrt(nearest)/RAMP[c],0.0,1.0);
 }
 textureStore(layoutPattern,id.xy,result);
}
`

/** The pattern's whole shader. */
export const PATTERN_CODE = wgslProgram(SOURCE, [GRADIENT_NOISE])
