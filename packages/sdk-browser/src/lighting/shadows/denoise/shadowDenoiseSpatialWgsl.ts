import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { interleavedGradientNoise } from '../../../../../math/src/wgsl/sampling.ts'
import { SCREEN_SPACE_BINDINGS as B } from '../../screenSpaceTracing/rayCastWgsl.ts'
import { STACKOWIAK_WGSL } from '../../screenSpaceTracing/denoise/stackowiakSet.ts'
import { SCREEN_SPACE_GROUP_SIDE } from '../../screenSpaceTracing/screenSpaceQuality.ts'
import { SCREEN_SPACE_GROUP } from '../../screenSpaceTracing/screenSpaceView.ts'
import { SHADOW_DENOISE_COMMON_WGSL } from './shadowDenoiseCommonWgsl.ts'

const G = SCREEN_SPACE_GROUP
const SIDE = SCREEN_SPACE_GROUP_SIDE

/** The rings of the pre-convolution's hexagonal web (a ring r is r times the spread from the centre, 3r pairs of samples). */
const WEB_RINGS = 1

const OUT_HISTORY = `@group(${G}) @binding(${B.out}) var outA:texture_storage_2d<rgba16float,write>;`

/** A sample taken for the pixel being denoised: the tap at the texel `pos` falls in (pixel units, the pixel's centre at +0.5), weighed by its bilateral weight (or whole where `force`). */
const TAKE_WGSL = wgslBlock(
  'SHADOW_DENOISE_TAKE_WGSL',
  [SHADOW_DENOISE_COMMON_WGSL],
  `fn sdTake(rings:ptr<function,SdRings>,light:SdLight,base:SdSurface,least:f32,pos:vec2f,force:bool){
 if(sdOutside(pos)){return;}
 let texel=vec2i(floor(pos));
 let s=sdTap(texel);
 if(s.n==0.0){return;}
 var w=1.0;
 if(!force){w=sdBilateral(light,min(s.r,least),base,sdSurfaceAt(texel));}
 sdRingAdd(rings,s,w);
}
fn sdCenter(rings:ptr<function,SdRings>,light:SdLight,base:SdSurface,least:f32,id:vec2u,spread:f32){
 sdRingStart(rings,base,spread);
 sdTake(rings,light,base,least,vec2f(id)+vec2f(0.5),true);
 sdRingEnd(rings,1u);
}`,
)

/**
 * THE INJESTION (`shadowInjest`, a thread a pixel): the trace's visibility (the source) and the distance of the nearest blocker (the second source) become a sample: one where a ray was cast,
 * with the share that arrived, and the radius the light's penumbra gives it there (`sdBlurRadius`); none, with the radius `SD_RADIUS_INVALID`, where none was.
 */
export const shadowInjestWgsl = () =>
  wgslProgram(
    `${OUT_HISTORY}
@compute @workgroup_size(${SIDE},${SIDE})
fn shadowInjest(@builtin(global_invocation_id) gid:vec3u){
 let id=vec3u(sdPixelOf(gid.xy),0u);
 if(any(id.xy>=vec2u(dnParams.rect.zw))){return;}
 let at=vec2i(id.xy);
 let hit=textureLoad(sourceB,at,0).x;
 if(hit==SD_HIT_INVALID){textureStore(outA,at,vec4f(0.0,0.0,SD_RADIUS_INVALID,0.0));return;}
 let share=textureLoad(sourceA,at,0).x;
 let seen=select(hit,SD_HIT_MISS,share>0.999);
 textureStore(outA,at,vec4f(share,1.0,sdBlurRadius(sdLight(),sdSurfaceAt(at).P,seen),0.0));
}`,
    [SHADOW_DENOISE_COMMON_WGSL],
  )

/** The reconstruction's taking in descending ring order (`sdReconstruct`): the pixel's quad takes its track of the sets of offsets, the rings from the outermost in, the pixel itself last. */
const RECONSTRUCT_WGSL = `
fn sdReconstruct(id:vec2u,spread:f32,most:u32,capped:bool)->SdRings{
 let light=sdLight();
 let base=sdSurfaceAt(vec2i(id));
 let least=select(3.0e38,sdTap(vec2i(id)).r,capped);
 var rings=sdRingsNew();
 let batches=(max(most,1u)+1u)/2u;
 let count=batches*2u;
 var ring=(u32(floor(sqrt(4.0*f32(count-1u)-3.0)))+1u)/2u;
 var boundary=1u+ring*(ring-1u);
 sdRingStart(&rings,base,(f32(ring)+1.0)*spread);
 let quad=vec2f(id|vec2u(1u));
 let track=(id.x&1u)|((id.y&1u)<<1u);
 for(var b=0u;b<batches;b++){
  for(var k=0u;k<2u;k++){
   let at=(batches-b)*2u-1u-k;
   sdTake(&rings,light,base,least,quad+stackowiak[4u*at+track]*spread,at==0u);
   if(at==boundary&&k==0u){
    sdRingEnd(&rings,min(ring*2u,count-at));
    if(at==1u){break;}
    ring-=1u;
    boundary-=ring*2u;
    sdRingStart(&rings,base,(f32(ring)+1.0)*spread);
   }
  }
 }
 sdCenter(&rings,light,base,least,id,spread);
 return rings;
}`

/** The pre-convolution's taking (`sdWeb`): the pixel's centre moved by noise within the spread, the six samples of a hexagonal web ring by pairs, the pixel itself last. */
const WEB_WGSL = `
fn sdWeb(id:vec2u,spread:f32)->SdRings{
 let light=sdLight();
 let base=sdSurfaceAt(vec2i(id));
 let least=sdTap(vec2i(id)).r;
 var rings=sdRingsNew();
 let noise=vec2f(interleavedGradientNoise(vec2f(id),0.0),interleavedGradientNoise(vec2f(id),1.0));
 let jittered=vec2f(id)+vec2f(0.5)+(noise-vec2f(0.5))*spread;
 let pairs=3u*${WEB_RINGS}u;
 let step=3.14159265/f32(pairs);
 var angle=3.14159265*0.2/f32(pairs);
 sdRingStart(&rings,base,(f32(${WEB_RINGS})+1.0)*spread);
 for(var k=0u;k<pairs;k++){
  angle+=step;
  let offset=vec2f(cos(angle),sin(angle))*f32(${WEB_RINGS})*spread;
  sdTake(&rings,light,base,least,jittered+offset,false);
  sdTake(&rings,light,base,least,jittered-offset,false);
 }
 sdRingEnd(&rings,pairs*2u);
 sdCenter(&rings,light,base,least,id,spread);
 return rings;
}`

/**
 * THE SPATIAL PASSES (`shadowReconstruct`, `shadowPreConvolve`, `shadowPostFilter`; a thread a pixel): the sample of the pixel from the samples around it, weighed by the bilateral weight (`sdBilateral`)
 * within the least of the sample's radius and the pixel's own, taken ring by ring from the outside in (`SdRings`), and written as a sample whose radius is the least met.
 *  - the reconstruction (the parameters' spread x the most samples, 1 pixel): the pixel's quad takes its track of the stochastic sets of offsets, `most` samples in descending rings, the quad's
 *    centre at the corner the four pixels share;
 *  - the pre-convolution (spread z, the spread of the pass: 8 pixels times two to its rank): a hexagonal web of one ring, the centre moved by noise;
 *  - the post filter (the history convolution): the reconstruction's kernel over the accumulated history, bounded by no radius of the pixel's own, the count of the sample capped at 1024.
 */
export const shadowSpatialWgsl = (kernel: 'reconstruct' | 'web' | 'postFilter') =>
  wgslProgram(
    `${OUT_HISTORY}
${kernel === 'web' ? WEB_WGSL : RECONSTRUCT_WGSL}
@compute @workgroup_size(${SIDE},${SIDE})
fn ${kernel === 'web' ? 'shadowPreConvolve' : kernel === 'reconstruct' ? 'shadowReconstruct' : 'shadowPostFilter'}(@builtin(global_invocation_id) gid:vec3u){
 let id=vec3u(sdPixelOf(gid.xy),0u);
 if(any(id.xy>=vec2u(dnParams.rect.zw))){return;}
 let rings=${kernel === 'web' ? 'sdWeb(id.xy,dnParams.spread.z)' : `sdReconstruct(id.xy,dnParams.spread.z,u32(dnParams.spread.x),${kernel === 'reconstruct'})`};
 ${kernel === 'postFilter' ? 'let held=sdTap(vec2i(id.xy)).n;\n let scale=select(0.0,min(held,1024.0)/held,held>0.0);\n textureStore(outA,vec2i(id.xy),sdEncode(rings.pn*scale,rings.pm*scale,rings.least));' : 'textureStore(outA,vec2i(id.xy),sdEncode(rings.pn,rings.pm,rings.least));'}
}`,
    [
      SHADOW_DENOISE_COMMON_WGSL,
      TAKE_WGSL,
      ...(kernel === 'web' ? [interleavedGradientNoise] : [STACKOWIAK_WGSL]),
    ],
  )

/**
 * THE OUTPUT (`shadowFinal`, a thread a pixel): the share of the rays that arrived of the accumulated sample, 1 where it has none, into the layer of the light's visibility; a sun's, taken into its
 * layer (the time w) of the suns' mask by the minimum.
 */
export const shadowFinalWgsl = (sun: boolean) =>
  wgslProgram(
    `${
      sun
        ? `@group(${G}) @binding(${B.out}) var shadowOut:texture_storage_2d_array<r32float,read_write>;`
        : `@group(${G}) @binding(${B.out}) var shadowOut:texture_storage_2d<r32float,write>;`
    }
@compute @workgroup_size(${SIDE},${SIDE})
fn shadowFinal(@builtin(global_invocation_id) gid:vec3u){
 let id=vec3u(sdPixelOf(gid.xy),0u);
 if(any(id.xy>=vec2u(dnParams.rect.zw))){return;}
 let at=vec2i(id.xy);
 let v=textureLoad(sourceA,at,0);
 let visibility=select(1.0,v.r,v.g>0.0);
 ${
   sun
     ? `if(visibility<1.0){
  let slot=i32(dnParams.time.w);
  textureStore(shadowOut,at,slot,vec4f(min(textureLoad(shadowOut,at,slot).x,visibility),0.0,0.0,0.0));
 }`
     : 'textureStore(shadowOut,at,vec4f(visibility,0.0,0.0,0.0));'
 }
}`,
    [SHADOW_DENOISE_COMMON_WGSL],
  )
