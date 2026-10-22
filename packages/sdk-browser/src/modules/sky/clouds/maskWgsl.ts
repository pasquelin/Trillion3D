import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { wgslFloats } from './generation.ts'
import { GRADIENT_NOISE } from './gradientFractalWgsl.ts'

/**
 * THE GLOBAL MASK'S PROGRAM: a square of 1024 texels a side, three channels that add clouds to, or
 * remove them from, the layout of each type, and an alpha of zero. It is not meant to tile.
 *
 * Each channel is a vignette centred on the tile, one at the centre and falling to zero at a
 * radius past the tile's edge, so that the corners hold small values and few zeros, with swirled
 * detail over it: the plane's gradient fractal warped twice by itself, scaled by an envelope that
 * is zero where the vignette is one or zero and greatest between. The three channels share the
 * detail and differ in the fall-off and in the detail's amplitude, which is why they correlate at
 * 0.99.
 */

/** Texels a side of the mask. */
export const MASK_SIZE = 1024

/** The fall-off of each channel R, G, B: `(1 − t^a)^b`, `t` the radius from `start` to `end` texels
 *  over one. Fitted to the radial means of the reference mask in rings of 10 texels (RMS 0.010,
 *  0.006 and 0.005 on the measured means); `end` is where it reaches zero, so the corners (past 724
 *  texels) of R hold the only exact zeros and the zero fraction stays about 1 %. */
const MASK_FALLOFF = [
  { start: 0, end: 724, a: 2.9, b: 8 },
  { start: 20, end: 680, a: 2.9, b: 6.4 },
  { start: 90, end: 680, a: 2.2, b: 5.2 },
] as const

/** The amplitude of each channel's detail, fitted so that the peak of the ring standard deviation
 *  (rings of 32 texels) meets the reference mask's 0.152, 0.102 and 0.085. */
const MASK_DETAIL_AMPLITUDE = [0.12, 0.078, 0.064] as const

/** The value of the vignette under which the detail's envelope fades to zero, so that the detail
 *  cannot cut the small values of the far corners to zero: fitted to a zero fraction of 2.6 %, 1.4 %
 *  and 0.9 % against the reference mask's 1.0 %, 0.8 % and 0.8 %. */
const MASK_ENVELOPE_KNEE = 0.1

/** Cells of the detail's first octave a side: 4, the coarse swirls of the measured mask. */
const MASK_DETAIL_CELLS = 4
/** The gain between the octaves of the detail: 0.5, each octave half the weight of the last. */
const MASK_DETAIL_GAIN = 0.5
/** The octaves of the detail: 7, down to texels of about 2 across, where the mask's spectrum ends. */
const MASK_DETAIL_OCTAVES = 7
/** The size of each of the detail's two warps, in tiles: 0.08, the swirl of the measured mask. */
const MASK_DETAIL_WARP = 0.08

/** What scales the detail to a standard deviation of one: the inverse of 0.1190, the standard
 *  deviation measured on this detail over the tile (its hash and warps being fixed, the number is
 *  exact; changing any of them changes it). */
const MASK_DETAIL_UNIT = 8.4

/** The salt of the detail's grids: any number, the mask holds one set of grids. */
const MASK_DETAIL_SALT = 0

/** Texels a thread group covers along each axis. */
export const MASK_GROUP = 16

export const MASK_ENTRY_POINTS = ['maskMain'] as const

const SOURCE = `
@group(0) @binding(0) var globalMask:texture_storage_2d<rgba16float,write>;

const SIZE:f32=${MASK_SIZE}.0;
${wgslFloats('AMPLITUDE', MASK_DETAIL_AMPLITUDE)}
const FALLOFF=array<vec4f,3>(${MASK_FALLOFF.map((f) => `vec4f(${[f.start, f.end, f.a, f.b].map(wgslF32).join(',')})`).join(',')});
const ENVELOPE_KNEE:f32=${wgslF32(MASK_ENVELOPE_KNEE)};

// The detail at 'q' in the unit tile: the fractal warped twice by itself, of unit deviation.
fn detail(q:vec2f)->f32{
 return warpedFractal(q,${MASK_DETAIL_CELLS},${MASK_DETAIL_OCTAVES},${wgslF32(MASK_DETAIL_GAIN)},${MASK_DETAIL_SALT},${wgslF32(MASK_DETAIL_WARP)})*${wgslF32(MASK_DETAIL_UNIT)};
}

@compute @workgroup_size(${MASK_GROUP},${MASK_GROUP})
fn maskMain(@builtin(global_invocation_id) id:vec3u){
 let p=vec2f(id.xy)+0.5;
 let radius=length(p-vec2f(SIZE*0.5));
 let d=detail(p/SIZE);
 var result=vec4f(0.0);
 for(var c=0u;c<3u;c++){
  let f=FALLOFF[c];
  let t=clamp((radius-f.x)/(f.y-f.x),0.0,1.0);
  let v=pow(max(1.0-pow(t,f.z),0.0),f.w);
  // The detail is scaled by 2 sqrt(v (1 - v)), which is one where the vignette is one half and zero
  // where it is one or zero, and faded to zero under the knee.
  let envelope=2.0*sqrt(v*(1.0-v))*min(1.0,v/ENVELOPE_KNEE);
  result[c]=clamp(v+AMPLITUDE[c]*envelope*d,0.0,1.0);
 }
 textureStore(globalMask,id.xy,result);
}
`

/** The mask's whole shader. */
export const MASK_CODE = wgslProgram(SOURCE, [GRADIENT_NOISE])
