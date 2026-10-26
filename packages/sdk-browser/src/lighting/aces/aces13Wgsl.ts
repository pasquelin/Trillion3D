import { wgslOperand as f } from '../../../../math/src/wgsl/number.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FILM, LOG10_OF_2 } from '../filmCurveConstants.ts'
import { RRT_MEASURES_WGSL } from '../filmCurveWgsl.ts'

const { wgsl: M } = FILM

/**
 * The tone scale of the first version of the standard output transform, a spline through three
 * points in the logarithms of the light and of the luminance, for the display the reference keeps
 * unless a high-range one is on: its least luminance `minNits` (10⁻⁴), the luminance of middle
 * grey 15 and its greatest `maxNits` (1000). The light the three points lie at is `minLight`,
 * `midLight` and `maxLight`; the least and the greatest point end the curve flat (slope 0). The
 * coefficients are the knots of the quadratic spline of each half, the sixth of each repeating the
 * fifth. `scaleOf` (`aces13Model.fixture.ts`) derives all of these from the three luminances.
 */
const SCALE = {
  minLight: 2.5089862e-6,
  midLight: 0.0822144598,
  maxLight: 692.651123,
  minNits: 1e-4,
  maxNits: 1000,
  low: [-4, -4, -3.15737653, -0.485249996, 1.84773231],
  high: [-0.33286342, 1.69534576, 2.75812411, 3, 3],
} as const
/** The base-ten logarithm of a number of the scale, in single precision as the shader reads it. */
const log10 = (x: number) => Math.log10(Math.fround(x))
const LOG = {
  minX: log10(SCALE.minLight),
  midX: log10(SCALE.midLight),
  maxX: log10(SCALE.maxLight),
  minY: log10(SCALE.minNits),
  maxY: log10(SCALE.maxNits),
}

/** The gamut compression's fit: for each of cyan, magenta and yellow, the distance from the
 *  achromatic axis it takes to the gamut's edge (`limit`) and the share of the gamut it leaves
 *  alone (`threshold`), and the aggressiveness (`power`) of the curve. */
const COMPRESSION = {
  limit: [1.147, 1.264, 1.312],
  threshold: [0.815, 0.803, 0.88],
  power: 1.2,
} as const

/** The compression of a distance from the achromatic axis, of the channel `i`: unchanged under the
 *  threshold, above it a curve that takes the limit to 1, its scale the one that makes it
 *  meet 1 there. */
const distanceWgsl = (i: number) => {
  const { limit, threshold, power } = COMPRESSION
  const [lim, thr] = [limit[i], threshold[i]]
  const scale = (lim - thr) / (((1 - thr) / (lim - thr)) ** -power - 1) ** (1 / power)
  return `
fn aces13Distance${i}(dist:f32)->f32{
 if(dist<${f(thr)}){return dist;}
 let nd=(dist-${f(thr)})/${f(scale)};
 return ${f(thr)}+${f(scale)}*nd/pow(1.0+pow(nd,${f(power)}),${f(1 / power)});
}`
}

/**
 * The first version of the standard output transform (the film industry's reference rendering and
 * output transforms, version 1.3) for the display the engine has — sRGB's gamut and a peak of 100
 * nits —: `aces13Display` takes a light in the grading gamut, the scene's multiplier and the share
 * of the gamut compression to the linear sRGB colour in [0, 1] the display shows. In order:
 * - the light times the multiplier, to the colour encoding's primaries (`ACES2065-1`), where the
 *   gamut compression (`aces13Compress`: each channel's distance from the largest, cyan, magenta
 *   and yellow, compressed past a threshold toward a limit; a colour with a negative channel, or
 *   nothing, left as it is) is mixed in by its share;
 * - the rendering's sweeteners (`aces13Sweeteners`): a glow on dark saturated colours, a pull of the
 *   reds toward a pivot by a cubic spline of the hue, the colour taken to the rendering primaries
 *   (`ACEScg`) and desaturated;
 * - the tone scale on each channel (`aces13Ssts`), the luminance taken to a share of the display's
 *   range, through XYZ and the display primaries' gamut limit, the part past the display's
 *   primaries cut, the share taken back to nits;
 * - to sRGB's primaries by the adaptation of the colour encoding's white to sRGB's, a hundredth
 *   (the display's white is 100 nits), cut to [0, 1].
 * Nothing is cut that the reference does not cut but the glow's square root (`RRT_MEASURES_WGSL`).
 * The light is cut to the table's range (`displayLight`, `./toneBakeWgsl.ts`) before it.
 */
export const STANDARD_OUTPUT_13_WGSL = wgslBlock(
  'STANDARD_OUTPUT_13_WGSL',
  [RRT_MEASURES_WGSL],
  `
const ACES13_FLOAT_MAX=65504.0;
const ACES13_INFINITY=65535.0;
${[0, 1, 2].map(distanceWgsl).join('')}
fn aces13Compress(aces:vec3f)->vec3f{
 let ap1=${M.gradingToWorking}*aces;
 let largest=max(ap1.x,max(ap1.y,ap1.z));
 if(largest<1e-10||any(aces<vec3f(0.0))){return aces;}
 let dist=(vec3f(largest)-ap1)/abs(largest);
 let compressed=vec3f(aces13Distance0(dist.x),aces13Distance1(dist.y),aces13Distance2(dist.z));
 return ${M.workingToGrading}*(vec3f(largest)-compressed*abs(largest));
}
fn aces13RedWeight(x:f32)->f32{
 let width=${f(FILM.red.width)};
 if(!(x>-0.5*width&&x<0.5*width)){return 0.0;}
 let coord=(x+0.5*width)*4.0/width;
 let j=i32(coord);
 let t=coord-f32(j);
 var y=0.0;
 if(j==3){y=t*t*t*${f(-1 / 6)}+t*t*0.5-t*0.5+${f(1 / 6)};}
 else if(j==2){y=t*t*t*0.5-t*t+${f(4 / 6)};}
 else if(j==1){y=t*t*t*(-0.5)+t*t*0.5+t*0.5+${f(1 / 6)};}
 else if(j==0){y=t*t*t*${f(1 / 6)};}
 return y*1.5;
}
fn aces13Sweeteners(inValue:vec3f)->vec3f{
 var aces=inValue;
 let saturation=rrtSaturation(aces);
 aces=aces*rrtGlow(aces,saturation);
 aces.r=aces.r+aces13RedWeight(rrtHue(aces))*saturation*(${f(FILM.red.pivot)}-aces.r)*${f(1 - FILM.red.scale)};
 aces=clamp(aces,vec3f(0.0),vec3f(ACES13_INFINITY));
 let rendering=clamp(${M.gradingToWorking}*aces,vec3f(0.0),vec3f(ACES13_FLOAT_MAX));
 return mix(vec3f(dot(rendering,${M.luma})),rendering,${f(FILM.preDesaturate)});
}
fn aces13Spline(cf:vec3f,t:f32)->f32{
 return t*t*(0.5*cf.x-cf.y+0.5*cf.z)+t*(cf.y-cf.x)+0.5*(cf.x+cf.y);
}
fn aces13Knots(logx:f32,first:f32,last:f32,c:array<f32,5>)->f32{
 let coord=3.0*(logx-first)/(last-first);
 let j=i32(coord);
 let t=coord-f32(j);
 var cf=vec3f(c[0],c[1],c[2]);
 if(j==1){cf=vec3f(c[1],c[2],c[3]);}
 else if(j==2){cf=vec3f(c[2],c[3],c[4]);}
 else if(j>=3){cf=vec3f(c[3],c[4],c[4]);}
 return aces13Spline(cf,t);
}
fn aces13Ssts(x:f32)->f32{
 let logx=log2(max(x,1e-10))*${f(LOG10_OF_2)};
 var logy=${f(LOG.maxY)};
 if(logx<=${f(LOG.minX)}){logy=${f(LOG.minY)};}
 else if(logx<${f(LOG.midX)}){
  logy=aces13Knots(logx,${f(LOG.minX)},${f(LOG.midX)},array<f32,5>(${SCALE.low.map(f).join(',')}));
 }else if(logx<${f(LOG.maxX)}){
  logy=aces13Knots(logx,${f(LOG.midX)},${f(LOG.maxX)},array<f32,5>(${SCALE.high.map(f).join(',')}));
 }
 return pow(10.0,logy);
}
fn aces13Output(aces:vec3f)->vec3f{
 let pre=aces13Sweeteners(aces);
 let post=vec3f(aces13Ssts(pre.x),aces13Ssts(pre.y),aces13Ssts(pre.z));
 let share=(post-vec3f(${f(SCALE.minNits)}))/${f(SCALE.maxNits - SCALE.minNits)};
 let limited=clamp(${M.xyzToAp1}*(${M.ap1ToXyz}*share),vec3f(0.0),vec3f(1.0));
 let display=clamp(${M.xyzToAp1}*(${M.ap1ToXyz}*limited),vec3f(0.0),vec3f(ACES13_INFINITY));
 return clamp(display*${f(SCALE.maxNits)},vec3f(0.0),vec3f(ACES13_INFINITY));
}
fn aces13Display(light:vec3f,multiplier:f32,compression:f32)->vec3f{
 var aces=${M.workingToGrading}*(light*multiplier);
 if(compression!=0.0){aces=mix(aces,aces13Compress(aces),compression);}
 return saturate(${M.workingToSrgb}*aces13Output(aces)*0.01);
}`,
)
