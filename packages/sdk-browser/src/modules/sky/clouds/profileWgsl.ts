import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { wgslFloats } from './generation.ts'

/**
 * THE HEIGHT PROFILE'S PROGRAM: a table of 256 by 256 texels, smooth and not periodic, read with
 * the altitude in the layer along x (0 at the bottom, 1 at the top) and the layout channel's value
 * down y (the row is V · 255). Each channel is the density multiplier of one cloud type.
 *
 * Every row of a channel is a tent through three points, straight between them: the value at the
 * first texel, the peak, the value at the last texel. The peak's position and height and the two
 * end values vary with the row, linearly between the nine rows of `PROFILE_KNOT_ROWS`; their
 * numbers are the least-squares tent of the measured table's rows at those rows (a window of seven
 * rows, the median for a position), which brings the table to an RMS of 0.0068, 0.0075, 0.0009 and
 * 0.0027 for R, G, B and A against the measured one.
 */

/** Texels a side of the table. */
export const PROFILE_SIZE = 256

/** The nine rows the tables below are given at, about 32 rows apart, the last at 255. */
const PROFILE_KNOT_ROWS = [0, 32, 64, 96, 128, 159, 191, 223, 255] as const

/** A table of the channels R, G, B, A at each knot row. */
type KnotTable = readonly (readonly [number, number, number, number])[]

/** The peak's x in texels at each knot row, fitted to the rows of the measured table. */
const PROFILE_PEAK_X: KnotTable = [
  [105, 127, 217.5, 185],
  [85, 125, 226, 188],
  [66, 130, 226, 180],
  [66, 140, 227, 172],
  [67, 147, 227, 163],
  [68, 150, 227, 152],
  [67, 152, 228, 137],
  [67, 146, 228, 125],
  [80, 134, 229, 118],
]

/** The peak's height at each knot row, fitted likewise. */
const PROFILE_PEAK_HEIGHT: KnotTable = [
  [0.434, 0.452, 0.476, 0.488],
  [0.504, 0.497, 0.505, 0.541],
  [0.563, 0.523, 0.509, 0.575],
  [0.576, 0.548, 0.513, 0.6],
  [0.582, 0.563, 0.515, 0.621],
  [0.588, 0.567, 0.517, 0.647],
  [0.59, 0.564, 0.52, 0.678],
  [0.596, 0.57, 0.521, 0.703],
  [0.624, 0.599, 0.525, 0.718],
]

/** The value at the first texel of the row at each knot row, fitted likewise. */
const PROFILE_FIRST_TEXEL: KnotTable = [
  [0.445, 0.256, 0.062, 0.234],
  [0.467, 0.264, 0.065, 0.266],
  [0.451, 0.271, 0.068, 0.303],
  [0.449, 0.275, 0.07, 0.347],
  [0.451, 0.277, 0.072, 0.395],
  [0.455, 0.297, 0.073, 0.435],
  [0.46, 0.354, 0.075, 0.463],
  [0.464, 0.425, 0.076, 0.483],
  [0.469, 0.48, 0.078, 0.487],
]

/** The value at the last texel of the row at each knot row, fitted likewise. */
const PROFILE_LAST_TEXEL: KnotTable = [
  [0.179, 0.272, 0.442, 0.408],
  [0.193, 0.31, 0.45, 0.421],
  [0.203, 0.352, 0.454, 0.431],
  [0.213, 0.366, 0.457, 0.438],
  [0.234, 0.363, 0.46, 0.443],
  [0.267, 0.364, 0.463, 0.446],
  [0.319, 0.386, 0.465, 0.448],
  [0.382, 0.442, 0.469, 0.45],
  [0.42, 0.47, 0.474, 0.451],
]

/** Texels a thread group covers along each axis. */
export const PROFILE_GROUP = 16

export const PROFILE_ENTRY_POINTS = ['profileMain'] as const

const rows = (name: string, table: KnotTable) =>
  `const ${name}=array<vec4f,${table.length}>(${table
    .map((row) => `vec4f(${row.map(wgslF32).join(',')})`)
    .join(',')});`

const SOURCE = `
@group(0) @binding(0) var profile:texture_storage_2d<rgba16float,write>;

const LAST:f32=${PROFILE_SIZE - 1}.0;
${wgslFloats('KNOT_ROWS', PROFILE_KNOT_ROWS)}
${rows('PEAK_X', PROFILE_PEAK_X)}
${rows('PEAK_HEIGHT', PROFILE_PEAK_HEIGHT)}
${rows('FIRST_TEXEL', PROFILE_FIRST_TEXEL)}
${rows('LAST_TEXEL', PROFILE_LAST_TEXEL)}

// A knot table's four channels at 'row', straight between the two knot rows around it.
fn atRow(table:array<vec4f,${PROFILE_KNOT_ROWS.length}>,row:f32)->vec4f{
 var i=0u;
 for(var k=1u;k<${PROFILE_KNOT_ROWS.length - 1}u;k++){if(row>=KNOT_ROWS[k]){i=k;}}
 return mix(table[i],table[i+1u],(row-KNOT_ROWS[i])/(KNOT_ROWS[i+1u]-KNOT_ROWS[i]));
}

@compute @workgroup_size(${PROFILE_GROUP},${PROFILE_GROUP})
fn profileMain(@builtin(global_invocation_id) id:vec3u){
 let x=f32(id.x);
 let row=f32(id.y);
 let peakX=atRow(PEAK_X,row);
 let height=atRow(PEAK_HEIGHT,row);
 let first=atRow(FIRST_TEXEL,row);
 let last=atRow(LAST_TEXEL,row);
 let climb=mix(first,height,saturate(x/peakX));
 let fall=mix(height,last,saturate((x-peakX)/(LAST-peakX)));
 textureStore(profile,id.xy,select(fall,climb,vec4f(x)<=peakX));
}
`

/** The profile's whole shader. */
export const PROFILE_CODE = wgslProgram(SOURCE, [])
