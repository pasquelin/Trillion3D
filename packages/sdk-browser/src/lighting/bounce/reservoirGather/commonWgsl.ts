import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { ndcToPixel, pixelToNdc, slabPerspective } from '../../../../../math/src/wgsl/projection.ts'
import { equalAreaDecode, equalAreaEncode } from '../../../../../math/src/wgsl/octahedral.ts'
import { hammersley16, interleavedGradientNoise } from '../../../../../math/src/wgsl/sampling.ts'
import { VECTOR_CODEC_WGSL } from '../../../post/taa/velocityWgsl.ts'
import { blueNoiseWgsl } from '../../../gpu/noise/blueNoiseWgsl.ts'
import { SP_REFLECTION } from '../screen/commonWgsl.ts'
import { SURFACE_PAST_WGSL } from '../screen/vectorsWgsl.ts'
import { RESERVOIR_PARAMS } from './params.ts'

/** Where the kernels of the reservoir gather bind what they share, in group 0 (the reflection group, 1, holds the view and the depth pyramid). */
export const RESERVOIR_BINDINGS = {
  params: 30,
  blue: 31,
  /** The two pools of reservoirs, a set each in sets 0 and 1 of the first and 2 and 3 of the second (`RESERVOIR_SET`). */
  poolA: 32,
  poolB: 33,
  normals: 34,
  vectors: 35,
  /** The pixels' light: the upsampling's (`lightIn`, `restIn`), the last image's accumulation (`historyLight`, `historyRest`, `historyFrames`), then what a pass writes. */
  lightIn: 36,
  restIn: 37,
  historyLight: 38,
  historyRest: 39,
  historyFrames: 40,
  lightOut: 41,
  restOut: 42,
  framesOut: 43,
} as const
const B = RESERVOIR_BINDINGS

/** The format of the pixels' light textures (the colour and, in the alpha, whether the pixel answered or the variance) and of the frames' (the share of the longest history, the pixel's linear depth). */
export const LIGHT_FORMAT = 'rgba16float' as const
export const FRAMES_FORMAT = 'rg32float' as const

/**
 * THE RESERVOIRS: a reservoir holds one sample of a ray (its direction and density, the light it brought back, how far it went, the normal it hit, whether it hit) and the weights that
 * say how it was chosen (`wSum`, `m`, `w`), with the linear depth and the normal of the surface it belongs to — four words of four in a pool (bit for bit: the packed words are no floats) (`rsAt`), the set picking the pool and the half of it. The
 * normals are held as two 16-bit coordinates of the equal-area octahedron (`rsPack`), the density as it is (the reference's 10-bit normals and 11-bit light are finer here). `rsUpdate` streams a
 * sample in, `rsMerge` another reservoir, `rsWill` asks whether a merge would change the sample; the jitter of the pixel a reservoir stands on turns with the frame (`rsPixel`).
 */
export const RESERVOIR_WGSL = wgslBlock(
  'RESERVOIR_WGSL',
  [
    SP_REFLECTION,
    blueNoiseWgsl(0, B.blue),
    hammersley16,
    interleavedGradientNoise,
    equalAreaEncode,
    equalAreaDecode,
    slabPerspective,
  ],
  `${RESERVOIR_PARAMS.wgsl}
@group(0) @binding(${B.params}) var<uniform> rs:ReservoirParams;
@group(0) @binding(${B.poolA}) var<storage,read_write> poolA:array<vec4u>;
@group(0) @binding(${B.poolB}) var<storage,read_write> poolB:array<vec4u>;
@group(0) @binding(${B.normals}) var surfaceNormals:texture_2d<f32>;
struct RsSample{dir:vec3f,pdf:f32,radiance:vec3f,distance:f32,normal:vec3f,hit:f32,}
struct RsReservoir{s:RsSample,wSum:f32,m:f32,w:f32,depth:f32,surface:vec3f,}
fn rsPack(n:vec3f)->u32{return pack2x16unorm(equalAreaEncode(n));}
fn rsUnpack(word:u32)->vec3f{return equalAreaDecode(unpack2x16unorm(word));}
fn rsAt(pool:u32,c:vec2u)->u32{return ((pool&1u)*rs.size.x*rs.size.y+c.y*rs.size.x+c.x)*4u;}
fn rsLoad(pool:u32,c:vec2u)->RsReservoir{
 let at=rsAt(pool,c);
 var a=vec4u();var b=vec4u();var d=vec4u();var e=vec4u();
 if(pool<2u){a=poolA[at];b=poolA[at+1u];d=poolA[at+2u];e=poolA[at+3u];}
 else{a=poolB[at];b=poolB[at+1u];d=poolB[at+2u];e=poolB[at+3u];}
 let sa=bitcast<vec4f>(a);
 let sb=bitcast<vec4f>(b);
 var r:RsReservoir;
 r.s=RsSample(sa.xyz,sa.w,sb.xyz,sb.w,rsUnpack(d.x),bitcast<f32>(e.z));
 r.wSum=bitcast<f32>(d.y);r.m=bitcast<f32>(d.z);r.w=bitcast<f32>(d.w);r.depth=bitcast<f32>(e.x);r.surface=rsUnpack(e.y);
 return r;
}
fn rsStore(pool:u32,c:vec2u,r:RsReservoir){
 let at=rsAt(pool,c);
 let a=bitcast<vec4u>(vec4f(r.s.dir,r.s.pdf));
 let b=bitcast<vec4u>(vec4f(r.s.radiance,r.s.distance));
 let d=vec4u(rsPack(r.s.normal),bitcast<u32>(r.wSum),bitcast<u32>(r.m),bitcast<u32>(r.w));
 let e=vec4u(bitcast<u32>(r.depth),rsPack(r.surface),bitcast<u32>(r.s.hit),0u);
 if(pool<2u){poolA[at]=a;poolA[at+1u]=b;poolA[at+2u]=d;poolA[at+3u]=e;}
 else{poolB[at]=a;poolB[at+1u]=b;poolB[at+2u]=d;poolB[at+3u]=e;}
}
/** A reservoir with no sample and no weight, that keeps the surface of 'r'. */
fn rsEmptyOf(r:RsReservoir)->RsReservoir{
 var e:RsReservoir;
 e.s=RsSample(vec3f(0.0),0.0,vec3f(0.0),0.0,vec3f(0.0),0.0);
 e.wSum=0.0;e.m=0.0;e.w=0.0;e.depth=r.depth;e.surface=r.surface;
 return e;
}
fn rsUpdate(r:ptr<function,RsReservoir>,s:RsSample,wNew:f32,noise:f32){
 (*r).wSum+=wNew;
 (*r).m+=1.0;
 if(noise<wNew/(*r).wSum){(*r).s=s;}
}
fn rsMerge(r:ptr<function,RsReservoir>,o:RsReservoir,pdf:f32,noise:f32){
 let m0=(*r).m;
 rsUpdate(r,o.s,pdf*o.w*o.m,noise);
 (*r).m=m0+o.m;
}
fn rsWill(r:RsReservoir,o:RsReservoir,pdf:f32,noise:f32)->bool{
 let wNew=pdf*o.w*o.m;
 return noise<wNew/(r.wSum+wNew);
}
fn rsLuma(c:vec3f)->f32{return dot(c,vec3f(0.3,0.59,0.11));}
/** The pixel the reservoir 'c' stands on at the frame 'index': its tile's corner moved by a Hammersley point of the tile. */
fn rsPixel(c:vec2u,index:u32)->vec2u{return c*rs.size.z+vec2u(hammersley16(index,8u,vec2u(0u))*f32(rs.size.z));}
fn rsDevice(linear:f32)->f32{
 return select(linear,reflectionView.slab.y+reflectionView.slab.z/linear,slabPerspective(reflectionView.slab));
}
fn rsWorld(c:vec2u,index:u32,linear:f32)->vec3f{return worldAt(vec2f(rsPixel(c,index))+vec2f(0.5),rsDevice(linear));}
struct RsMaterial{valid:bool,P:vec3f,N:vec3f,rough:f32,depth:f32,}
/** The surface of the pixel: its world point, normal, roughness and linear depth; none for a pixel that shows no lit surface. */
fn rsMaterial(pixel:vec2u)->RsMaterial{
 var m:RsMaterial;
 m.valid=false;
 if(any(pixel>=vec2u(view.viewport.xy))){return m;}
 let z=hizOpaqueDepth(vec2i(pixel));
 let n=textureLoad(surfaceNormals,vec2i(pixel),0);
 if(z<=0.0||dot(n.xyz,n.xyz)<0.5){return m;}
 m.valid=true;
 m.P=worldAt(vec2f(pixel)+vec2f(0.5),z);
 m.N=normalize(n.xyz);
 m.rough=n.a;
 m.depth=reflectionLinearOfDevice(z);
 return m;
}`,
)

/**
 * WHERE A SURFACE STOOD IN THE LAST IMAGE (`rsPast`), from the vectors the velocity stage drew (`sceneVectors`): the pixel of the last lit image and the device depth, as `reflectionPast` finds a screen hit's,
 * the jitter of either image taken off and the last one's put back; `valid` is false for a point behind the last camera.
 */
export const RESERVOIR_PAST_WGSL = wgslBlock(
  'RESERVOIR_PAST_WGSL',
  [RESERVOIR_WGSL, VECTOR_CODEC_WGSL, SURFACE_PAST_WGSL, ndcToPixel, pixelToNdc],
  `@group(0) @binding(${B.vectors}) var sceneVectors:texture_2d<u32>;
struct RsPast{pixel:vec2f,z:f32,valid:bool,}
fn rsPast(P:vec3f,S:vec2f,z:f32)->RsPast{
 let previous=reflectionView.radianceViewProj*vec4f(P,1.0);
 let last=vec2i(textureDimensions(sceneVectors))-vec2i(1);
 let words=textureLoad(sceneVectors,clamp(vec2i(S),vec2i(0),last),0);
 let moves=hasOwnMotion(words.r);
 let jitter=reflectionView.jitter;
 let here=pixelToNdc(S,view.viewport.xy)-jitter.xy;
 let still=previous.xy/previous.w-jitter.zw;
 let ndc=surfacePast(words.r,here,still)+jitter.zw;
 return RsPast(ndcToPixel(ndc,reflectionView.radiance.xy),select(previous.z/previous.w,z-depthStepOf(words.g),moves),moves||previous.w>0.0);
}`,
)
