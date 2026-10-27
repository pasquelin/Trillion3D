import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { ndcToPixel } from '../../../../../math/src/wgsl/projection.ts'
import { SP_TARGET_DITHER, spCommon, spParams } from './commonWgsl.ts'
import { SP_QUANTIZE } from './gatherWgsl.ts'
import { spProbes } from './probesWgsl.ts'
import { SCREEN_PROBE_FORMATS as F, bindingTable } from './screenProbeLayout.ts'
import { spVectors } from './vectorsWgsl.ts'

/** The temporal filter of the probes' bindings: the probes' records and pixels, the last image's records and composited radiance, this image's composited
 *  radiance, the filtered radiance written and the surfaces' vectors. */
export const PROBE_FILTER_BINDINGS = bindingTable({
  params: [0, 'uniform'],
  info: [1, 'float'],
  normal: [2, 'uint'],
  counts: [3, 'buffer-read'],
  pixels: [4, 'buffer-read'],
  historyInfo: [5, 'float'],
  history: [6, 'float'],
  composite: [7, 'float'],
  filtered: [8, { store: F.gather }],
  vectors: [9, 'uint'],
})

const B = PROBE_FILTER_BINDINGS.at

/** The scale of the plane test of a probe of the last image (`exp2(scale · (distance / depth)²)`) and the weight over which it stands on the probe's plane. */
const PLANE_SCALE = -10000
const PLANE_MIN_WEIGHT = 0.1

/**
 * THE TEMPORAL FILTER OF THE PROBES (`probeFilter`, `screenProbeTemporalFilterProbes`): the radiance a probe's rays composited, blended with the
 * last image's composited radiance of the probes round where its surface stood. A thread a texel of a probe's octahedron. The probe's point goes to
 * where it was in the last image (the camera's motion and its own, `spMotionOf`); inside that image, the four uniform probes round it, in the tiles of
 * the last image's jitter, are read at the same texel — each only where it stands on the probe's plane (`exp2(-10000 · (distance / depth)²)` over a tenth); the
 * probes' radiance is not pre-exposed, so it needs no scaling by the exposure between the images —, their mean taking `screenProbeTemporalFilterProbesHistoryWeight` of the
 * texel (none where no probe stood there), the rest being the new radiance. The result is quantized as the 11-11-10 target of the reference is,
 * dithered by a hash of the texel and the frame's rank plus ten; a texel keeps the code of its nearest hit. Without a history the radiance is kept as it is.
 */
const SP_PROBE_FILTER = wgslBlock(
  'SP_PROBE_FILTER',
  [ndcToPixel, SP_QUANTIZE, SP_TARGET_DITHER],
  `const SP_FILTER_PLANE_SCALE:f32=${PLANE_SCALE};
const SP_FILTER_MIN_WEIGHT:f32=${PLANE_MIN_WEIGHT};
@group(0) @binding(${B.pixels}) var<storage,read> probePixels:array<u32>;
@group(0) @binding(${B.historyInfo}) var historyInfo:texture_2d<f32>;
@group(0) @binding(${B.history}) var historyRadiance:texture_2d<f32>;
@group(0) @binding(${B.composite}) var composite:texture_2d<f32>;
@group(0) @binding(${B.filtered}) var filtered:texture_storage_2d<${F.gather},write>;
/** The last image's radiance of the probes round the point of \`probe\`, standing on pixel \`pixel\`, at texel \`t\` of their octahedra, averaged; the probes it found in \`w\`. */
fn spHistoryRadiance(probe:SpProbe,pixel:vec2u,t:vec2u)->vec4f{
 let clip=reflectionView.radianceViewProj*vec4f(probe.P,1.0);
 let size=reflectionView.radiance.xy;
 if(clip.w<=0.0){return vec4f(0.0);}
 let px=ndcToPixel(spMotionOf(vec2i(pixel),probe.P,clip.xy/clip.w).ndc,size);
 if(any(px<vec2f(0.0))||any(px>size)){return vec4f(0.0);}
 let at=(px-vec2f(0.5)-vec2f(spTileJitter(sp.mode.y)))/f32(sp.size.z);
 var radiance=vec3f(0.0);
 var total=0.0;
 for(var i=0u;i<4u;i++){
  let neighbour=vec2u(clamp(at+vec2f(f32(i&1u),f32(i>>1u)),vec2f(0.0),vec2f(sp.grid.xy-vec2u(1u))));
  let kept=textureLoad(historyInfo,vec2i(neighbour),0);
  if(kept.w>0.0){
   let away=abs(dot(kept.xyz,probe.N)-dot(probe.P,probe.N))/probe.depth;
   if(exp2(SP_FILTER_PLANE_SCALE*away*away)>SP_FILTER_MIN_WEIGHT){
    radiance+=textureLoad(historyRadiance,vec2i(neighbour*SP_GATHER+t),0).rgb;
    total+=1.0;
   }
  }
 }
 return vec4f(select(vec3f(0.0),radiance/total,total>0.0),total);
}
@compute @workgroup_size(8,8)
fn probeFilter(@builtin(global_invocation_id) id:vec3u){
 let atlas=id.xy/SP_GATHER;
 if(atlas.x>=sp.grid.x||atlas.y>=sp.grid.z){return;}
 let t=id.xy%SP_GATHER;
 let fresh=textureLoad(composite,vec2i(id.xy),0);
 let probe=spProbeOrDead(atlas);
 var out=fresh;
 if(probe.depth>0.0&&spFlag(SP_FLAG_PROBE_TEMPORAL)){
  let own=probePixels[spIndexOf(atlas)];
  let kept=spHistoryRadiance(probe,vec2u(own&0xffffu,own>>16u),t);
  let mixed=mix(fresh.rgb,kept.rgb,select(0.0,sp.screen.y,kept.w>0.0));
  let dither=spTargetDither(id.xy,10);
  out=vec4f(spQuantize(mixed,dither),fresh.w);
 }
 textureStore(filtered,vec2i(id.xy),out);
}`,
)

/** The temporal filter of the probes' program over `gather × gather` texels a probe and `samples` of a tile. */
export const probeFilterShader = (gather: number, samples: readonly [number, number]) =>
  wgslProgram(
    `${spParams(B.params)}
${wgslConsts({ SP_GATHER: gather })}`,
    [
      spCommon(samples),
      spProbes(B.info, B.normal, B.counts),
      spVectors(B.vectors),
      SP_PROBE_FILTER,
    ],
  )
