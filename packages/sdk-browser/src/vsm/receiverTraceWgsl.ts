/**
 * The shadow of one light at one receiver, through the virtual shadow maps: the one estimator every
 * lit surface reads. The receiver is pushed along its normal by the normal bias, a screen ray
 * (`vsmScreenRayCast`) finds the contact occluders the maps are too coarse to hold, and the traces
 * (`traceWgsl.ts`) march rays across the light's disk or sphere from where it stops.
 *
 * Two hosts evaluate it, on the same view uniform (`VsmProjectionView`, `projectionView.ts`), the same
 * blue noise and the same maps:
 * - the projection pass (`projectionWgsl.ts`), on the opaque pixels, 64 a workgroup: its 32-pixel
 *   halves vote their rays' count;
 * - the blended surfaces and the water (`../lighting/direct/shadowWgsl.ts`), a fragment each, `lone`:
 *   no lane of another voting beside it, a fragment never stops on a vote, only on its own first
 *   ray hitting a narrow occluder (`rayCountStatement`). It never traces fewer rays than a voting
 *   pixel would: never less image.
 *
 * The host declares `vsmView` and `vsm` (`VsmUniforms`), and gives the pool the traces sample
 * (`pool`), the noise pair (`noise`) and the depth pyramid's bindings the screen ray marches (`hiz`,
 * `SCREEN_MARCH_WGSL`).
 */
import { wgslBlock, type WgslDecl } from '../../../math/src/wgsl/decl.ts'
import { clipToFramebuffer } from '../../../math/src/wgsl/projection.ts'
import { SCREEN_MARCH_WGSL } from '../gpu/hiz/screenMarch.ts'
import { VSM_CONSTANTS_WGSL } from './constants.ts'
import { VSM_PROJECTION_DATA_WGSL } from './projectionDataWgsl.ts'
import { VSM_TRACE_LIGHT_WGSL, VSM_TRACE_RESULT_WGSL, vsmTraceWgsl } from './traceWgsl.ts'

/** Bits of `VSM_PROJECTION_KINDS`: a directional light in the pass, a local one. */
export const VSM_PROJECTION_KINDS_DIRECTIONAL = 1
export const VSM_PROJECTION_KINDS_LOCAL = 2

/** What a host gives the receiver's trace (`vsmReceiverTraceWgsl`). */
export interface VsmReceiverTraceHost {
  /** The pool's `vsmPoolLoad` the traces sample. */
  pool: WgslDecl
  /** The rays' noise pair (`vsmNoiseTwo`). */
  noise: WgslDecl
  /** The depth pyramid's group and first binding (`hizDepthEntries`). */
  hiz: readonly [group: number, binding: number]
  /** A fragment's trace, which no other lane votes beside. */
  lone: boolean
}

export const vsmReceiverTraceWgsl = ({ pool, noise, hiz, lone }: VsmReceiverTraceHost) =>
  wgslBlock(
    `vsmReceiverTraceWgsl(${hiz.join(', ')}, ${lone})`,
    [
      VSM_CONSTANTS_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      VSM_TRACE_LIGHT_WGSL,
      VSM_TRACE_RESULT_WGSL,
      vsmTraceWgsl(pool, noise, lone),
      SCREEN_MARCH_WGSL(hiz[0], hiz[1]),
      clipToFramebuffer,
    ],
    /* wgsl */ `
/** The kinds of the pass's lights, set by the projection pass (\`pipelineFor\`, \`projectionPass.ts\`):
 *  a directional light, a local one, or both (any other value, the fragments' own). A pass of one
 *  kind is compiled with that kind's trace alone: the other kind's code, and the registers its peak
 *  holds, are not in it. The same light either way. */
override VSM_PROJECTION_KINDS:u32=0u;
fn vsmLightIsDirectional(light:VsmProjectionLight)->bool{
 let kinds=VSM_PROJECTION_KINDS;
 return kinds==${VSM_PROJECTION_KINDS_DIRECTIONAL}u||(kinds!=${VSM_PROJECTION_KINDS_LOCAL}u&&light.kind==LIGHT_KIND_DIRECTIONAL);
}
/** \`biasNormal\`: the normal the receiver's biases follow (normal bias, receiver-plane depth slope);
 *  the shading normal unless the engine's shadow receiver gives its triangle's plane. */
struct VsmSurfaceInfo{valid:bool,subsurface:bool,worldNormal:vec3f,biasNormal:vec3f,}
/** What a receiver brings to its lights: its pixel, whether it is in the view rect and its shading
 *  info; where a light can shade it (\`info.valid\`), its view depth, its shifted point, its screen
 *  ray length and its blue noise — zero elsewhere, where no light reads them (the projection's
 *  \`vsmLightParticipates\`, the traces' \`participating\`). */
struct VsmPixel{pos:vec2u,inRect:bool,info:VsmSurfaceInfo,sceneDepth:f32,shifted:vec3f,screenRayWorld:f32,noise:f32,}
/** The distance to the camera from a view vector (along the view axis for an orthographic view). */
fn vsmCameraDistance(v:vec3f)->f32{
 var d=length(v);
 if(vsmView.isOrtho!=0u){d*=d/dot(v,vsmView.viewForward);}
 return d;
}
/** The normal bias length at a position (0.02 cm floor = VSM_NORMAL_OFFSET_FLOOR). */
fn vsmNormalOffset(shiftedPosition:vec3f)->f32{
 let distanceToCamera=vsmCameraDistance(shiftedPosition-vsmView.shiftedEye);
 return vsmNormalOffsetLength(vsm.normalBias,distanceToCamera,vsmView.halfFovTangents.z);
}
/** The screen-space ray cast: the engine's screen march (\`screenMarch\`, \`gpu/hiz/screenMarch.ts\`)
 *  of the depth along the ray's length, whose reach is the ray's own and whose thickness is
 *  \`thickness\` pixels of footprint — the ray's depth span, so that a surface nearer than the ray
 *  by more than it spans is no occluder of the point the ray leaves. The first crossing is the
 *  occluder: the ray's length up to it, a pixel and a half back (declared: the map trace starts
 *  at the surface, never behind it), or the whole length where it meets nothing. */
fn vsmScreenRayCast(rayOrigin:vec3f,rayDirection:vec3f,rayLength:f32,thickness:f32)->f32{
 let size=vsmView.viewPixels.xy;
 let start=clipToFramebuffer(vsmView.shiftedToClip*vec4f(rayOrigin,1.0),size);
 let stop=clipToFramebuffer(vsmView.shiftedToClip*vec4f(rayOrigin+rayDirection*rayLength,1.0),size);
 let d=stop-start;
 let hit=screenMarch(start,d,screenMarchEnd(start.xy,d.xy,size),thickness,vsmView.screenSlab);
 // A transparent surface is no occluder here: the maps' transmission is its shadow.
 if(hit.t<0.0||hit.front){return rayLength;}
 return rayLength*max(0.0,hit.t-1.5/max(max(abs(d.x),abs(d.y)),1e-6));
}
/** Light k's shadow at a receiver (\`vsmView.lights[k]\`: its record and its map id). */
fn vsmProjectLight(k:u32,pixel:VsmPixel,participating:bool,voteSplit:bool)->VsmTraceResult{
 let light=vsmView.lights[k];
 let info=pixel.info;
 let directional=vsmLightIsDirectional(light);
 let toLight=light.shiftedPosition-pixel.shifted;
 let L=select(toLight*inverseSqrt(dot(toLight,toLight)),light.direction,directional);
 let worldNormal=info.biasNormal;
 var shiftedPosition=pixel.shifted;
 var traceStart=pixel.screenRayWorld;
 if(participating){
  if(!info.subsurface){shiftedPosition+=worldNormal*vsmNormalOffset(shiftedPosition);}
  if(!info.subsurface&&pixel.screenRayWorld>0.0){
   traceStart=vsmScreenRayCast(shiftedPosition,L,pixel.screenRayWorld,pixel.screenRayWorld/vsmPixelWorldSize(pixel.sceneDepth,vsmView.viewToClip,vsmView.viewPixels.xy));
  }
 }
 if(directional){
  return vsmTraceSun(light.mapId,light,pixel.pos,shiftedPosition,traceStart,pixel.noise,worldNormal,participating,voteSplit);
 }else{
  return vsmTraceLocal(light.mapId,light,pixel.pos,pixel.sceneDepth,shiftedPosition,traceStart,pixel.noise,worldNormal,participating,voteSplit);
 }
}
`,
  )
