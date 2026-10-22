import { fieldLayout } from '../../../../gpu/core/fieldLayout.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { HDR_FORMAT } from '../../../../scene/targetFormats.ts'

/** Threads of a workgroup: each transforms a line, a thread for each of its values in turn. */
export const FFT_LANES = 256

/**
 * The uniform of the transform's three passes:
 * - `size`: the base-two logarithm of the line along the rows' direction (the first transform) and
 *   of the line across it, the columns of the half spectrum (`along / 2 + 1`), and 1 where the first
 *   transform goes along x;
 * - `rois`: the texels of the image along the first line, the lines across it, the complex values of
 *   one plane of the image's spectrum and of the kernel's;
 * - `mode`: 1 where the columns pass multiplies by the kernel's spectrum, 0 where it keeps the
 *   transform (the kernel's own); 1 where the rows pass boosts the bright pixels it loads;
 * - `lift`: the boost of those pixels — the luminance above which it starts, the most it reaches,
 *   the slope — and the exposure the luminance is read at, which the GPU copies in from the
 *   finishing's uniform;
 * - `scale`: for each channel, what the inverse transform multiplies it by.
 */
export const FFT_PARAMS = fieldLayout('Fft', [
  ['size', 'vec4u'],
  ['rois', 'vec4u'],
  ['mode', 'vec4u'],
  ['lift', 'vec4f'],
  ['scale', 'vec4f'],
] as const)
/** Bytes of the transform's uniform. */
export const FFT_BYTES = FFT_PARAMS.words * 4

/** The bindings of the transform's passes, by the names the shader gives them: the uniform, the
 *  image, the planes of the image's spectrum and the kernel's, the table of factors, the glow's image. */
export const FFT_BINDINGS = {
  params: 0,
  source: 1,
  planes: 2,
  factors: 3,
  kernel: 4,
  glow: 5,
} as const

/** The bindings and the constants of the transform's program: the uniform, the image, the planes of
 *  the image's spectrum and the kernel's, the table of factors, the glow's image, and the line of
 *  workgroup memory — `maxLine` values — a pass transforms in place. */
const header = (maxLine: number) => `
${FFT_PARAMS.wgsl}
@group(0) @binding(${FFT_BINDINGS.params}) var<uniform> fft:Fft;
@group(0) @binding(${FFT_BINDINGS.source}) var source:texture_2d<f32>;
@group(0) @binding(${FFT_BINDINGS.planes}) var<storage,read_write> planes:array<vec2f>;
@group(0) @binding(${FFT_BINDINGS.factors}) var<storage,read> factors:array<vec2f>;
@group(0) @binding(${FFT_BINDINGS.kernel}) var<storage,read> kernelPlanes:array<vec2f>;
@group(0) @binding(${FFT_BINDINGS.glow}) var glowOut:texture_storage_2d<${HDR_FORMAT},write>;
const LANES=${FFT_LANES}u;
const PRE_FILTER_LUMA=vec3f(0.2126,0.7152,0.0722);
const MAX_LINE=${maxLine}u;
var<workgroup> waves:array<vec2f,MAX_LINE>;
`

/** The complex arithmetic, the line's order, and the stages of the transform of a line. */
const CORE = `fn cmul(a:vec2f,b:vec2f)->vec2f{return vec2f(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);}
fn conj(a:vec2f)->vec2f{return vec2f(a.x,-a.y);}
fn reversed(i:u32,bits:u32)->u32{return reverseBits(i)>>(32u-bits);}
fn scrub(v:f32)->f32{return select(0.0,v,v>0.0);}
fn texelAt(along:u32,scan:u32)->vec2i{
 return select(vec2i(i32(scan),i32(along)),vec2i(i32(along),i32(scan)),fft.size.w!=0u);
}
fn loaded(p:vec2i)->vec4f{
 let value=textureLoad(source,p,0);
 var rgb=select(vec3f(0.0),value.rgb,value.rgb>vec3f(0.0));
 let luma=dot(rgb,PRE_FILTER_LUMA)*fft.lift.w;
 if(fft.mode.y!=0u&&luma>fft.lift.x&&luma>0.0){
  rgb*=min(fft.lift.z*(luma-fft.lift.x)+fft.lift.x,fft.lift.y)/luma;
 }
 return vec4f(rgb,scrub(value.a));
}
fn butterflies(lane:u32,bits:u32,inverse:bool){
 let pairs=1u<<(bits-1u);
 workgroupBarrier();
 for(var stage=1u;stage<=bits;stage++){
  let span=1u<<(stage-1u);
  let gap=MAX_LINE>>stage;
  for(var b=lane;b<pairs;b+=LANES){
   let j=b&(span-1u);
   let lo=((b>>(stage-1u))<<stage)|j;
   let hi=lo+span;
   var w=factors[j*gap];
   if(inverse){w.y=-w.y;}
   let t=cmul(w,waves[hi]);
   let u=waves[lo];
   waves[lo]=u+t;
   waves[hi]=u-t;
  }
  workgroupBarrier();
 }
}
`

/** The first pass: the rows of the image. */
const FORWARD_ROWS = `@compute @workgroup_size(${FFT_LANES})
fn forwardRows(@builtin(workgroup_id) at:vec3u,@builtin(local_invocation_index) lane:u32){
 let scan=at.x;
 let bits=fft.size.x;
 let n=1u<<bits;
 let columns=fft.size.z;
 for(var pair=0u;pair<2u;pair++){
  for(var i=lane;i<n;i+=LANES){
   var z=vec2f(0.0);
   if(i<fft.rois.x){
    let value=loaded(texelAt(i,scan));
    z=select(value.xy,value.zw,pair==1u);
   }
   waves[reversed(i,bits)]=z;
  }
  butterflies(lane,bits,false);
  for(var k=lane;k<columns;k+=LANES){
   let a=waves[k];
   let b=conj(waves[(n-k)&(n-1u)]);
   let d=a-b;
   let first=2u*pair*fft.rois.z+scan*columns+k;
   planes[first]=0.5*(a+b);
   planes[first+fft.rois.z]=0.5*vec2f(d.y,-d.x);
  }
  workgroupBarrier();
 }
}
`

/** The second pass: the columns of the planes. */
const CONVOLVE_COLUMNS = `@compute @workgroup_size(${FFT_LANES})
fn convolveColumns(@builtin(workgroup_id) at:vec3u,@builtin(local_invocation_index) lane:u32){
 let k=at.x;
 let width=fft.size.z;
 let bits=fft.size.y;
 let n=1u<<bits;
 for(var c=0u;c<4u;c++){
  let own=c*fft.rois.z;
  for(var i=lane;i<n;i+=LANES){
   var z=vec2f(0.0);
   if(i<fft.rois.y){z=planes[own+i*width+k];}
   waves[reversed(i,bits)]=z;
  }
  butterflies(lane,bits,false);
  if(fft.mode.x==0u){
   for(var i=lane;i<n;i+=LANES){planes[own+i*width+k]=waves[i];}
  }else{
   let kernelAt=c*fft.rois.w;
   let divisor=kernelPlanes[kernelAt].x;
   for(var i=lane;i<n;i+=LANES){
    let j=reversed(i,bits);
    if(i<=j){
     let a=cmul(waves[i],kernelPlanes[kernelAt+i*width+k])/divisor;
     let b=cmul(waves[j],kernelPlanes[kernelAt+j*width+k])/divisor;
     waves[i]=b;
     waves[j]=a;
    }
   }
   butterflies(lane,bits,true);
   let share=1.0/f32(n);
   for(var i=lane;i<fft.rois.y;i+=LANES){planes[own+i*width+k]=waves[i]*share;}
  }
  workgroupBarrier();
 }
}
`

/** The third pass: the rows, back, into the image. */
const INVERSE_ROWS = `@compute @workgroup_size(${FFT_LANES})
fn inverseRows(@builtin(workgroup_id) at:vec3u,@builtin(local_invocation_index) lane:u32){
 let scan=at.x;
 let bits=fft.size.x;
 let n=1u<<bits;
 let columns=fft.size.z;
 let share=1.0/f32(n);
 var held:array<vec2f,MAX_LINE/LANES>;
 for(var pair=0u;pair<2u;pair++){
  for(var k=lane;k<n;k+=LANES){
   let direct=k<columns;
   let row=scan*columns+select(n-k,k,direct);
   var f=planes[2u*pair*fft.rois.z+row];
   var g=planes[(2u*pair+1u)*fft.rois.z+row];
   if(!direct){f=conj(f);g=conj(g);}
   waves[reversed(k,bits)]=f+vec2f(-g.y,g.x);
  }
  butterflies(lane,bits,true);
  var slot=0u;
  for(var i=lane;i<fft.rois.x;i+=LANES){
   let z=waves[i]*share;
   if(pair==0u){held[slot]=z;}else{
    let first=held[slot];
    textureStore(glowOut,texelAt(i,scan),vec4f(
     scrub(first.x)*fft.scale.x,scrub(first.y)*fft.scale.y,
     scrub(z.x)*fft.scale.z,scrub(z.y)*fft.scale.w));
   }
   slot++;
  }
  workgroupBarrier();
 }
}`

/**
 * THE FOURIER TRANSFORM OF A CONVOLUTION, three passes, a workgroup to a line, a line held in
 * workgroup memory (`maxLine` values of two floats at most) and transformed in place, a thread for
 * `maxLine / 256` of its values:
 * - `forwardRows` transforms the lines of an image along the first direction, each texel loaded
 *   with no negative or missing light and, where the transform boosts, its bright pixels boosted:
 *   a pixel whose luminance in the exposed radiance, `luminance · exposure`, is over `lift.x` — the
 *   boost's luminance is the reference's own weights, 0.2126, 0.7152 and 0.0722 (`PRE_FILTER_LUMA`),
 *   not the engine's, which the kernel's centre reads — takes
 *   `lift.z · (luminance − lift.x) + lift.x`, at most `lift.y`; its colour is scaled by the ratio,
 *   its coverage kept, a pixel of no luminance left alone. A line holds four real
 *   channels, taken two by two as one complex signal each (red + i green, blue + i alpha): the
 *   transform of a real signal is its own conjugate turned about the middle, so the transforms of
 *   both channels are read off the one transform. They are stored half a spectrum, from 0 to the
 *   middle included, a plane for each channel, a row of the plane for each line.
 * - `convolveColumns` transforms each column of the planes — a column is the same frequency of every line,
 *   the lines past the image's zeros — and, where it convolves, multiplies each channel by the
 *   kernel's spectrum at that place, divides it by the sum of its own kernel channel — the first
 *   value of the plane, which is the channel's whole light — and transforms it back.
 * - `inverseRows` completes each line's half spectra by the same symmetry, joins two channels as
 *   one complex spectrum, transforms it back, and writes the channels to the image: held to 0 or
 *   more, times each channel's multiplier.
 * The forward transform is unscaled, the inverse divides by the line's length. The factors are read
 * from a table (`twiddleTable`), a line shorter than `maxLine` every `maxLine / length`-th of it.
 */
export const fftShader = (maxLine: number) =>
  wgslProgram(header(maxLine) + CORE + FORWARD_ROWS + CONVOLVE_COLUMNS + INVERSE_ROWS, [])
