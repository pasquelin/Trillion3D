import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { frameAround, intoFrame } from '../../../../../math/src/wgsl/basis.ts'
import { visibleGgxHalf } from '../../../../../math/src/wgsl/sampling.ts'
import { safeRcp } from '../../../../../math/src/wgsl/reals.ts'
import { SCREEN_SPACE_INPUTS_WGSL, SCREEN_SPACE_SURFACE_WGSL } from '../rayCastWgsl.ts'
import { SCREEN_SPACE_GROUP } from '../screenSpaceView.ts'
import { DENOISE_BINDINGS as D, DENOISE_PARAMS_WGSL } from './denoiseView.ts'

/** The two signals the denoiser filters: the screen reflections (colour with its alpha, and how far the rays went) and the screen indirect light (mean radiance and
 *  the share of the rays that missed). */
export type DenoiseSignal = 'reflections' | 'indirect'

/**
 * THE DENOISER'S SHARED PARTS: the parameters and the signal read, a signal's sample (its weight `n`, its colour `c` with the alpha, its missed share `m`, all
 * summed, never averaged, until it is written), the surface of a pixel of this image or of the image before (position, depth, normal, roughness), the
 * bilateral weight between two surfaces, and the accumulator of a kernel (the sum of the weighted samples, the sum of their squares and the least confusion
 * met). A position is in texels of the signal's grid, the centre of texel `t` being `t + 0.5 / ratio` (texel `t` stands for the full-resolution pixel `t · ratio`).
 */
export const DENOISE_COMMON_WGSL = wgslBlock(
  'DENOISE_COMMON_WGSL',
  [
    SCREEN_SPACE_INPUTS_WGSL,
    SCREEN_SPACE_SURFACE_WGSL,
    DENOISE_PARAMS_WGSL,
    frameAround,
    intoFrame,
    visibleGgxHalf,
    safeRcp,
  ],
  `@group(${SCREEN_SPACE_GROUP}) @binding(${D.params}) var<uniform> dnParams:DenoiseParams;
@group(${SCREEN_SPACE_GROUP}) @binding(${D.sourceA}) var sourceA:texture_2d<f32>;
@group(${SCREEN_SPACE_GROUP}) @binding(${D.sourceB}) var sourceB:texture_2d<f32>;
const DN_MAX_HALF:f32=65504.0;
fn dnLuma4(c:vec3f)->f32{return c.g*2.0+(c.r+c.b);}
struct DnSig{n:f32,c:vec4f,m:f32,}
struct DnLoaded{s:DnSig,conf:f32,}
fn dnMul(a:DnSig,s:f32)->DnSig{return DnSig(a.n*s,a.c*s,a.m*s);}
fn dnAdd(a:DnSig,b:DnSig)->DnSig{return DnSig(a.n+b.n,a.c+b.c,a.m+b.m);}
fn dnSq(a:DnSig)->DnSig{return DnSig(a.n*a.n,a.c*a.c,a.m*a.m);}
/** The sample brought to one: its colour and missed share divided by its weight, the weight one where it had any. */
fn dnNormalized(a:DnSig)->DnSig{
 var o=dnMul(a,safeRcp(a.n));
 o.n=select(0.0,1.0,a.n>0.0);
 return o;
}
fn dnAmend(radius:f32)->f32{return radius*2.8284271;}
/** The grid's size in texels, and the texel under a position, held within it. */
fn dnGridSize()->vec2i{return vec2i(dnParams.grid.xy);}
fn dnTexelOf(pos:vec2f)->vec2i{return clamp(vec2i(floor(pos)),vec2i(0),dnGridSize()-vec2i(1));}
/** Whether a position lies where the kernels do not read: past the centres of the grid's first and last texels. */
fn dnOutside(pos:vec2f)->bool{
 let size=vec2f(dnParams.grid.xy);
 return any(pos<vec2f(0.5))||any(pos>size-vec2f(0.5));
}
/** The surface of a position of the full-resolution image (pixels, a pixel's centre at +0.5). */
struct DnMeta{P:vec3f,depth:f32,N:vec3f,rough:f32,}
fn dnMetaAt(full:vec2f)->DnMeta{
 let pixel=clampToExtent(vec2i(floor(full)),vec2i(ssView.size.xy));
 let surface=ssSurfaceAt(pixel);
 let z=max(hizOpaqueDepth(pixel),1e-8);
 return DnMeta(ssWorldAt(ssScreenOfPixel(full),z),ssSceneDepth(z),surface.N,surface.roughness);
}
/** The surface under a position of the signal's grid, in this image. */
fn dnMetaCur(pos:vec2f)->DnMeta{return dnMetaAt(pos*dnParams.grid.z);}
fn dnPixelRadius(m:DnMeta)->f32{return ssPixelRadius(m.depth);}
/** The bilateral weight of a neighbour n for the surface r: the position (1: the distance to it, 2: the distance to r's plane) within dist, the normals' agreement, and
 *  the likeness of the specular lobes (their width and their axis). */
struct DnLobe{axis:vec3f,sharp:f32,}
fn dnLobe(m:DnMeta)->DnLobe{
 let V=-ssCameraVector(m.P);
 let a=max(0.001,m.rough);
 let a2=a*a*a*a;
 let NoV=saturate(abs(dot(m.N,V))+1e-5);
 return DnLobe(2.0*NoV*m.N-V,0.5/(a2*max(NoV,0.1)));
}
fn dnBilateral(positionMode:u32,useNormal:bool,useLobes:bool,dist:f32,r:DnMeta,n:DnMeta)->f32{
 let toRef=r.P-n.P;
 var position=1.0;
 if(positionMode==1u){position=saturate(1.0-dot(toRef,toRef)/(dist*dist));}
 else if(positionMode==2u){position=saturate(1.0-abs(dot(r.N,toRef))/dist);}
 var normalWeight=1.0;
 if(useNormal){normalWeight=pow(max(dot(r.N,n.N),0.0),4.0);}
 var lobe=1.0;
 var axes=1.0;
 if(useLobes){
  let a=dnLobe(r);
  let b=dnLobe(n);
  let inverse=1.0/(a.sharp+b.sharp);
  lobe=pow(2.0*sqrt(a.sharp*b.sharp)*inverse,32.0);
  axes=exp(-(32.0*(a.sharp*b.sharp)*inverse)*saturate(1.0-dot(a.axis,b.axis)));
 }
 return position*normalWeight*lobe*axes;
}
/** A kernel's accumulator: the sum of the weighted samples (s), of their squares (s2), the least confusion of the samples that weighed (conf). */
struct DnAcc{s:DnSig,s2:DnSig,conf:f32,}
fn dnAccNew()->DnAcc{return DnAcc(DnSig(0.0,vec4f(0.0),0.0),DnSig(0.0,vec4f(0.0),0.0),1.0);}
fn dnAccAdd(a:ptr<function,DnAcc>,s:DnSig,conf:f32,w:f32){
 (*a).s=dnAdd((*a).s,dnMul(s,w));
 (*a).s2=dnAdd((*a).s2,dnMul(dnSq(s),w));
 if(w>0.0){(*a).conf=min((*a).conf,conf);}
}`,
)

/** The reflections' parts: colour with its alpha, accumulated weighted by one over its luma plus 4, clamped in luma-chroma. */
const REFLECTIONS_SIGNAL_TEXT = `fn dnDecodeInput(a:vec4f,b:vec4f)->DnLoaded{
 let valid=b.r!=-1.0;
 return DnLoaded(DnSig(select(0.0,1.0,valid),a,select(0.0,1.0-a.a,valid)),b.r);
}
fn dnDecodeHistory(a:vec4f,b:vec4f,unit:bool)->DnLoaded{
 var n=b.r;
 if(unit){n=select(0.0,1.0,b.r>0.0);}
 return DnLoaded(DnSig(n,a*n,n*(1.0-a.a)),b.g);
}
fn dnEncodeA(s:DnSig)->vec4f{
 let c=s.c*safeRcp(s.n);
 return vec4f(min(c.rgb,vec3f(DN_MAX_HALF)),c.a);
}
fn dnEncodeB(s:DnSig,conf:f32)->vec4f{return vec4f(s.n,conf,0.0,0.0);}
fn dnKarisWeight(x:f32)->f32{return 1.0/(x*dnParams.time.y+4.0);}
fn dnKarisInverse(x:f32)->f32{return 4.0/(1.0-x*dnParams.time.y);}
/** The colour into the space a kernel accumulates in, and back. */
fn dnToAccum(s:DnSig)->DnSig{
 var o=s;
 let c=s.c*safeRcp(s.n);
 o.c=c*dnKarisWeight(dnLuma4(c.rgb))*s.n;
 return o;
}
fn dnFromAccum(s:DnSig)->DnSig{
 var o=s;
 let c=s.c*safeRcp(s.n);
 o.c=c*dnKarisInverse(dnLuma4(c.rgb))*s.n;
 return o;
}
fn dnToLcocg(c:vec3f)->vec3f{
 let y=dot(c,vec3f(1.0,2.0,1.0));
 let yc=vec3f(y,dot(c,vec3f(2.0,0.0,-2.0)),dot(c,vec3f(-1.0,2.0,-1.0)));
 return vec3f(yc.x,yc.yz*safeRcp(yc.x));
}
fn dnFromLcocg(l:vec3f)->vec3f{
 let y=l.x;
 let co=y*l.y*0.25;
 let cg=y*l.z*0.25;
 let luma=y*0.25;
 return vec3f(luma+co-cg,luma+cg,luma-co-cg);
}
/** The colour into the space the history is clamped in (luma, chroma over luma, the alpha kept), and back. */
fn dnToReject(s:DnSig)->DnSig{
 var o=s;
 let c=s.c*safeRcp(s.n);
 o.c=vec4f(dnToLcocg(c.rgb*safeRcp(c.a)),c.a)*s.n;
 return o;
}
fn dnFromReject(s:DnSig)->DnSig{
 var o=s;
 let c=s.c*safeRcp(s.n);
 o.c=vec4f(dnFromLcocg(c.rgb)*c.a,c.a)*s.n;
 return o;
}
fn dnLumaLog(x:f32)->f32{return max(select(-100.0,log2(x),x>0.0),-100.0);}
/** How much the clamp changed the history: the luma's change in stops, the chroma's and the alpha's. */
fn dnRejection(clamped:DnSig,history:DnSig)->f32{
 let diff=abs(clamped.c-history.c);
 var factor=abs(dnLumaLog(clamped.c.x)-dnLumaLog(history.c.x));
 factor=max(factor,max(diff.y,diff.z));
 return max(factor,diff.a);
}`

/** The indirect light's parts: mean radiance and the missed share, in the space they are read in. */
const INDIRECT_SIGNAL_TEXT = `fn dnDecodeInput(a:vec4f,b:vec4f)->DnLoaded{
 let n=a.a;
 return DnLoaded(DnSig(n,vec4f(n*a.rgb,0.0),n*b.r),1.0);
}
fn dnDecodeHistory(a:vec4f,b:vec4f,unit:bool)->DnLoaded{
 var n=b.g*64.0;
 if(unit){n=select(0.0,1.0,b.g>0.0);}
 return DnLoaded(DnSig(n,vec4f(n*a.rgb,0.0),n*b.r),1.0);
}
fn dnEncodeA(s:DnSig)->vec4f{return vec4f(min(s.c.rgb*safeRcp(s.n),vec3f(DN_MAX_HALF)),1.0);}
fn dnEncodeB(s:DnSig,conf:f32)->vec4f{return vec4f(s.m*safeRcp(s.n),saturate(s.n/64.0),0.0,0.0);}
fn dnToAccum(s:DnSig)->DnSig{return s;}
fn dnFromAccum(s:DnSig)->DnSig{return s;}
fn dnToReject(s:DnSig)->DnSig{return s;}
fn dnFromReject(s:DnSig)->DnSig{return s;}
fn dnRejection(clamped:DnSig,history:DnSig)->f32{return abs(clamped.m-history.m);}`

/**
 * THE SIGNAL'S OWN PARTS, by signal (`DenoiseSignal`): how the textures read become a sample (`dnDecodeInput`: the trace's output, `dnDecodeHistory`: what a
 * denoising pass wrote, normalised to one sample when asked) and how a sample is written (`dnEncodeA`, `dnEncodeB`: two textures), the colour spaces a
 * kernel accumulates in and a history is clamped in. The reflections' colour is accumulated weighted by one over its luma plus 4 (so a bright spot does not
 * show the kernel), and clamped in luma-chroma with the colour unpremultiplied by its alpha; the indirect light's keeps its space.
 */
const signalBlock = (signal: DenoiseSignal) =>
  wgslBlock(
    `DENOISE_SIGNAL_WGSL(${signal})`,
    [DENOISE_COMMON_WGSL],
    signal === 'reflections' ? REFLECTIONS_SIGNAL_TEXT : INDIRECT_SIGNAL_TEXT,
  )
const SIGNAL_BLOCKS = { reflections: signalBlock('reflections'), indirect: signalBlock('indirect') }
/** The signal's own parts. */
export const denoiseSignalWgsl = (signal: DenoiseSignal) => SIGNAL_BLOCKS[signal]

/** The signal read at a texel of the grid, as the trace wrote it (`input`) or a denoising pass did (`history`, normalised to one sample when unit). */
const loadBlock = (layout: 'input' | 'history') =>
  wgslBlock(
    `DENOISE_LOAD_WGSL(${layout})`,
    [DENOISE_COMMON_WGSL],
    layout === 'input'
      ? `fn dnLoadSource(texel:vec2i)->DnLoaded{
 let t=clamp(texel,vec2i(0),dnGridSize()-vec2i(1));
 return dnDecodeInput(textureLoad(sourceA,t,0),textureLoad(sourceB,t,0));
}`
      : `fn dnLoadSource(texel:vec2i)->DnLoaded{
 let t=clamp(texel,vec2i(0),dnGridSize()-vec2i(1));
 return dnDecodeHistory(textureLoad(sourceA,t,0),textureLoad(sourceB,t,0),false);
}
fn dnLoadSourceNormalized(texel:vec2i)->DnLoaded{
 let t=clamp(texel,vec2i(0),dnGridSize()-vec2i(1));
 return dnDecodeHistory(textureLoad(sourceA,t,0),textureLoad(sourceB,t,0),true);
}`,
  )
const LOAD_BLOCKS = { input: loadBlock('input'), history: loadBlock('history') }
export const DENOISE_LOAD_WGSL = (layout: 'input' | 'history') => LOAD_BLOCKS[layout]
