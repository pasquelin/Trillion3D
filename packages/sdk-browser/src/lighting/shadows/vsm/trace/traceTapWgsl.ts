/**
 * THE ONE TAP OF A LOCAL LIGHT'S MAP (`vsmLocalTap`), the reference's one `SampleVirtualShadowMapLocal`:
 * the shadow of a local light that takes no ray (`VsmProjectionView.traceRays` 0 — a single tap, the
 * trace's `vsmTraceLight`), and the share of a light the frame's mask holds no lane for
 * (`sampleMapWgsl.ts`). The receiver, in the map's own frame (the light at its origin), is read in the
 * map at the mip its footprint asks (`vsmLocalMipAt`, from a scene depth; the finest without one),
 * through the coarser mips of the same projection where the page is not there. The stored depth is
 * lowered by the receiver plane's optimal slope bias — the plane's lift from the receiver to the
 * centre of the texel it reads (`vsmCentreLift`), held to `VSM_TRACE_ONE_TAP_BIAS_CAP` of the map's
 * depth scale — and by the ray start's lift along the ray towards the light, in the map's depth: a
 * perspective map's depth per unit of distance is its projection's third diagonal term over the clip w.
 */
import { type WgslDecl, wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { perspectiveDivide } from '../../../../../../math/src/wgsl/projection.ts'
import { VSM_UNIT_PER_CM } from '../constants.ts'
import { VSM_TRACE_RESULT_WGSL } from './traceCommonWgsl.ts'
import { vsmLocalMipAt, vsmTraceMapWgsl } from './traceMapWgsl.ts'

/** The plane's lift from a receiver to the centre of its texel and how far a local occluder lies from
 *  the receiver, and the tap itself, sampling the pages of `pool`. The host declares the view `vsmView`
 *  and brings the light's map (`vsmLightMapOn`). */
export const vsmLocalTapWgsl = (pool: WgslDecl) =>
  wgslBlock(
    'vsmLocalTapWgsl',
    [vsmTraceMapWgsl(pool), vsmLocalMipAt, VSM_TRACE_RESULT_WGSL, perspectiveDivide],
    `
/** The plane's lift from a receiver to the centre of its texel \`texelXY\` (the receiver at
 *  \`texelPos\` of a map \`texels\` wide), held to \`cap\`. */
fn vsmCentreLift(texelXY:vec2u,texelPos:vec2f,texels:u32,uvDepthSlope:vec2f,cap:f32)->f32{
 let toCentre=(vec2f(texelXY)+0.5-texelPos)/f32(texels);
 return min(cap,vsmPlaneLift(uvDepthSlope,toCentre));
}
/** How far the receiver at clip depth \`receiverDepth\`, \`receiverDistance\` from its light, lies from an
 *  occluder at \`occluderDepth\` on a perspective map of clip matrix \`m\`: similar triangles in the
 *  view depths; never under a millionth of a centimetre. */
fn vsmLocalOccluderDistance(m:mat4x4f,occluderDepth:f32,receiverDepth:f32,receiverDistance:f32)->f32{
 let occluderViewZ=m[3][2]/(occluderDepth-m[2][2]);
 let receiverViewZ=m[3][2]/(saturate(receiverDepth)-m[2][2]);
 return max(1e-6*${VSM_UNIT_PER_CM},receiverDistance-(receiverDistance/receiverViewZ)*occluderViewZ);
}
/** The share of the light map \`m\` (\`vsmLightMapAt\`, \`vsmLightMapOn\`) at its receiver, one tap: 0
 *  where the stored depth of the texel the receiver falls on, lowered by the ray start \`rayStart\`
 *  (never under 0) and, with \`optimalBias\`, by the plane of \`normal\` through the receiver, lies
 *  nearer the light than the receiver, 1 elsewhere; none (the empty trace) where no page maps it. The
 *  mip is the receiver's footprint at \`sceneDepth\`, the finest of the map without one (negative). */
fn vsmLocalTap(m:VsmLightMap,rayStart:f32,normal:vec3f,optimalBias:bool,sceneDepth:f32)->VsmTraceResult{
 var result=vsmEmptyTrace();
 let pd=vsmProjectionOf(m.handle);
 let uvz=perspectiveDivide(m.mapPoint);
 var mip=pd.finestMip;
 if(sceneDepth>=0.0){mip=vsmLocalMipAt(pd,m.pInMap,sceneDepth,vsmView.viewToClip,vsmView.viewPixels.xy,0.0);}
 let read=vsmReadMap(m.handle,uvz.xy,mip);
 if(!read.valid){return result;}
 result.rayCount=1u;
 var slopeBias=0.0;
 if(optimalBias){
  let uvDepthSlope=vsmDepthGradientUv(pd,m.pInMap,normal);
  slopeBias=vsmCentreLift(read.mapTexelXY,read.mapTexelPos,vsmTexelsAtLevel(read.mipLevel),uvDepthSlope,VSM_TRACE_ONE_TAP_BIAS_CAP*abs(pd.lightViewToClip[2][2]));
 }
 let startBias=-max(rayStart,0.0)*pd.lightViewToClip[2][2]/m.mapPoint.w;
 let biasedDepth=read.depth-slopeBias-startBias;
 if(biasedDepth>uvz.z){
  result.shadowFactor=0.0;
  result.occluderDistance=vsmLocalOccluderDistance(pd.lightViewToClip,biasedDepth,uvz.z,length(m.pInMap));
 }
 return result;
}
`,
  )
