import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import {
  hammersley16,
  rand3dPcg16,
  uniformDiskConcentric,
  visibleGgxHalf,
} from '../../../../../math/src/wgsl/sampling.ts'
import { frameAround, intoFrame } from '../../../../../math/src/wgsl/basis.ts'
import { SCREEN_SPACE_BINDINGS as B } from '../rayCastWgsl.ts'
import { SCREEN_SPACE_GROUP_SIDE } from '../screenSpaceQuality.ts'
import { SCREEN_SPACE_GROUP } from '../screenSpaceView.ts'
import {
  DENOISE_COMMON_WGSL,
  DENOISE_LOAD_WGSL,
  denoiseSignalWgsl,
  type DenoiseSignal,
} from './signalWgsl.ts'
import { STACKOWIAK_OFFSETS, STACKOWIAK_SET_COUNT } from './stackowiakSet.ts'

const G = SCREEN_SPACE_GROUP

/** The texture the spatial passes write: the first (colour, four half floats) and the second (two floats: the weight and the confusion, or the missed share and the weight). */
const OUTPUTS = `@group(${G}) @binding(${B.out}) var outA:texture_storage_2d<rgba16float,write>;
@group(${G}) @binding(${B.outSecond}) var outB:texture_storage_2d<rg32float,write>;`

/**
 * THE LOBE OF A SURFACE ON THE SCREEN (`dnLobeOnScreen`): where its reflection points (a unit axis in screen directions, y up), then how wide the specular lobe
 * is along that axis and across it, as a radius in units of the view's width, for a surface with no hit distance. The lobe's two angles are those between
 * the reflections of four visible-normal samples at the lobe's half height, around the disc; a mirror has none.
 */
export const LOBE_ON_SCREEN_WGSL = wgslBlock(
  'DENOISE_LOBE_ON_SCREEN_WGSL',
  [DENOISE_COMMON_WGSL, frameAround, intoFrame, visibleGgxHalf],
  `fn dnLobeOnScreen(m:DnMeta,screen:vec2f)->vec4f{
 let V=-ssCameraVector(m.P);
 let R=2.0*dot(V,m.N)*m.N-V;
 let reached=ssView.worldToClip*vec4f(m.P+R*(0.5*m.depth),1.0);
 var dir=(reached.xy/reached.w-screen)*ssView.size.xy;
 let len=length(dir);
 dir=select(vec2f(1.0,0.0),dir/len,len>0.0);
 let a=m.rough*m.rough;
 let tangentV=intoFrame(frameAround(m.N),V);
 var L:array<vec3f,4>;
 for(var i=0u;i<4u;i++){
  let H=visibleGgxHalf(vec2f(f32(i)*0.25,0.5),vec2f(a),tangentV);
  L[i]=2.0*dot(tangentV,H)*H-tangentV;
 }
 let major=acos(clamp(dot(L[2],L[3]),-1.0,1.0));
 let minor=acos(clamp(dot(L[0],L[1]),-1.0,1.0));
 let cotangent=ssView.pixelRadius.z;
 return vec4f(dir,tan(0.5*major)*cotangent,tan(0.5*minor)*cotangent);
}`,
)

/** The reflections' kernel: an ellipse of samples along the lobe, the bilateral weight the likeness of the lobes. */
const REFLECTION_KERNEL = `
fn dnTapAt(origin:DnMeta,pos:vec2f,weight:f32,acc:ptr<function,DnAcc>){
 if(dnOutside(pos)){return;}
 let loaded=dnLoadSource(dnTexelOf(pos));
 if(loaded.s.n==0.0){return;}
 let w=weight*dnBilateral(0u,false,true,1.0,origin,dnMetaCur(pos));
 dnAccAdd(acc,dnToAccum(loaded.s),loaded.conf,w);
}
@compute @workgroup_size(${SCREEN_SPACE_GROUP_SIDE},${SCREEN_SPACE_GROUP_SIDE})
fn denoiseCompute(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=vec2u(dnParams.grid.xy))){return;}
 let center=vec2f(id.xy)+vec2f(0.5/dnParams.grid.z);
 let origin=dnMetaCur(center);
 let own=dnLoadSource(vec2i(id.xy));
 var acc=dnAccNew();
 dnAccAdd(&acc,dnToAccum(own.s),own.conf,1.0);
 let lobe=dnLobeOnScreen(origin,ssScreenOfPixel(center*dnParams.grid.z));
 let confusion=saturate(own.conf);
 let aspect=select(1.0,lobe.w/lobe.z,lobe.z>0.0);
 let previous=dnParams.spread.y;
 let most=dnParams.spread.x;
 let axis=lobe.xy*vec2f(1.0,-1.0);
 let previousDiameter=sqrt(4.0*previous/aspect);
 let diameter=sqrt(4.0*most*previous/aspect);
 let major=clamp(lobe.z*confusion*ssView.size.x-previousDiameter,0.0,0.5*diameter);
 let minor=aspect*major;
 let least=0.5*inverseSqrt(2.0);
 let area=4.0*max(major,least)*max(minor,least);
 let total=(u32(clamp(area*0.25/previous,0.0,most))/2u)*2u;
 let seed=rand3dPcg16(vec3i(vec2i(id.xy),i32(dnParams.time.x))).xy;
 for(var i=0u;i<total;i++){
  let e=uniformDiskConcentric(hammersley16(i,total,seed));
  let offset=axis*major*e.x+vec2f(-axis.y,axis.x)*minor*e.y;
  dnTapAt(origin,center+offset,1.0,&acc);
 }
 let sum=dnFromAccum(acc.s);
 textureStore(outA,vec2i(id.xy),dnEncodeA(sum));
 textureStore(outB,vec2i(id.xy),dnEncodeB(sum,acc.conf));
}`

/** The indirect light's kernel: the quad-shared stochastic sets, the bilateral weight the distance to the plane and the normals' agreement. */
const INDIRECT_KERNEL = `
var<private> stackowiak:array<vec2f,${STACKOWIAK_SET_COUNT * 4}>=array<vec2f,${STACKOWIAK_SET_COUNT * 4}>(${Array.from({ length: STACKOWIAK_SET_COUNT * 4 }, (_, i) => `vec2f(${STACKOWIAK_OFFSETS[2 * i]},${STACKOWIAK_OFFSETS[2 * i + 1]})`).join(',')});
fn dnTapAt(origin:DnMeta,pos:vec2f,weight:f32,acc:ptr<function,DnAcc>){
 if(dnOutside(pos)){return;}
 let loaded=dnLoadSource(dnTexelOf(pos));
 if(loaded.s.n==0.0){return;}
 let near=dnMetaCur(pos);
 let dist=dnAmend(min(dnPixelRadius(near),dnPixelRadius(origin)))*3.0;
 let w=weight*dnBilateral(2u,true,false,dist,origin,near);
 dnAccAdd(acc,dnToAccum(loaded.s),loaded.conf,w);
}
@compute @workgroup_size(${SCREEN_SPACE_GROUP_SIDE},${SCREEN_SPACE_GROUP_SIDE})
fn denoiseCompute(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=vec2u(dnParams.grid.xy))){return;}
 let shift=0.5/dnParams.grid.z;
 let origin=dnMetaCur(vec2f(id.xy)+vec2f(shift));
 let own=dnLoadSource(vec2i(id.xy));
 var acc=dnAccNew();
 dnAccAdd(&acc,dnToAccum(own.s),own.conf,1.0);
 let quad=vec2f(id.xy|vec2u(1u))+vec2f(shift);
 let track=(id.x&1u)|((id.y&1u)<<1u);
 let count=u32(clamp(256.0,1.0,dnParams.spread.x));
 let spread=dnParams.spread.z;
 dnTapAt(origin,quad+stackowiak[4u+track]*spread,1.0,&acc);
 for(var b=0u;b<(count-1u)/2u;b++){
  let first=2u+2u*b;
  dnTapAt(origin,quad+stackowiak[4u*first+track]*spread,1.0,&acc);
  dnTapAt(origin,quad+stackowiak[4u*(first+1u)+track]*spread,1.0,&acc);
 }
 let sum=dnFromAccum(acc.s);
 textureStore(outA,vec2i(id.xy),dnEncodeA(sum));
 textureStore(outB,vec2i(id.xy),dnEncodeB(sum,acc.conf));
}`

/**
 * THE SPATIAL PASSES OF THE DENOISER (`denoiseCompute`, a thread a texel of the grid): the signal's sample at the texel, with the samples around it, weighted,
 * summed and written as a history sample (colour normalised, weight, confusion). `layout` is how the signal is read, as the trace wrote it (the reconstruction)
 * or as a denoising pass did (the pre-convolutions, the reflections' only).
 *  - reflections: the samples are drawn in an ellipse along the surface's lobe on the screen, as wide as the lobe is, less the width the earlier passes
 *    covered, within the samples the pass may read; each is weighted by the likeness of its lobe to the pixel's, and the colour is summed weighted by one over its luma
 *    plus 4;
 *  - indirect light: the pixel's own sample, the second of the pixel's set of the quad-shared sets and the following pairs, up to the most samples; each is weighted by its
 *    distance to the pixel's plane (within three pixels' radius) and the agreement of the normals.
 */
export const denoiseSpatialWgsl = (signal: DenoiseSignal, layout: 'input' | 'history') =>
  wgslProgram(`${OUTPUTS}${signal === 'reflections' ? REFLECTION_KERNEL : INDIRECT_KERNEL}`, [
    DENOISE_COMMON_WGSL,
    denoiseSignalWgsl(signal),
    DENOISE_LOAD_WGSL(layout),
    ...(signal === 'reflections'
      ? [LOBE_ON_SCREEN_WGSL, hammersley16, rand3dPcg16, uniformDiskConcentric]
      : []),
  ])
