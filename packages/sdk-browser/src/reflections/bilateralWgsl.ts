import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { GOLDEN_ANGLE } from '../../../math/src/wgsl/constants.ts'
import { f0Of } from '../../../math/src/wgsl/lighting.ts'
import { clampToExtent } from '../../../math/src/wgsl/sampling.ts'
import { surfaceReflects } from '../scene/surfaceModel.ts'
import { HDR_FORMAT } from '../scene/targetFormats.ts'
import { REFLECTION_COUNTS, REFLECTION_SIDE } from './constants.ts'
import { FRONT_TRACED_FORMAT } from './frontLayer.ts'
import { FRONT_PACK_WGSL } from './frontPackWgsl.ts'
import { REFLECTION_TILES_WGSL, REFLECTION_TRACE_BINDINGS as B } from './traceBindings.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { REFLECTION_SPATIAL_WGSL } from './spatialWgsl.ts'
import { REFLECTION_TEMPORAL_WGSL } from './temporalWgsl.ts'
import { REFLECTION_TEXEL_WGSL } from './texelWgsl.ts'
import { reflectionWeighWgsl } from './weight.ts'

/** The side of the last pass's workgroups, in pixels: a tile's texels widened to their blocks. */
const BILATERAL_SIDE = REFLECTION_SIDE * REFLECTION_COUNTS.REFLECTION_TRACE_BLOCK

/**
 * THE LAST PASS, widening the grid to every pixel (`bilateralOpaque`, `bilateralFront`, a thread a pixel
 * of a listed tile's blocks): every pixel reads the history (`bilateralIn`, this image's
 * accumulation) of the grid texels around it where they saw its own surface, the reference engine's
 * upsample of its high-quality reflections, and averages it with its neighbours' on a disc of the lobe's own
 * reach (`reflectionReuseReach` at this image's hit, `temporalIn`, `REFLECTION_REUSE_RADIUS` pixels at
 * most), each
 * weighed by the same-surface test, by how short the pixel's history is — one minus its count over
 * `REFLECTION_HISTORY` — and by how full the neighbour's is — its count over the same. A pixel whose
 * history holds a dozen images keeps its own; one whose history was just rejected — a disocclusion, a
 * moved light — borrows its neighbours', the longest the most, until its own fills. The same rule for
 * every pixel, in the denoiser's space (`reflectionDenoised`).
 *
 * It writes the surface's answer: the opaque one weighs it on the pixel's own reflectance, normal,
 * roughness and lobes (`reflectionShare`) — a surface's texture detail is the pixel's — into the
 * reflection target the resolve reads; the front one writes it where the forward fragments read it,
 * one load (`forwardTrace`). A pixel that does not reflect writes nothing, and nothing reads it.
 */
export const REFLECTION_BILATERAL_WGSL = wgslBlock(
  'REFLECTION_BILATERAL_WGSL',
  [
    REFLECTION_TILES_WGSL,
    REFLECTION_SURFACES_WGSL,
    REFLECTION_TEXEL_WGSL,
    REFLECTION_SPATIAL_WGSL,
    REFLECTION_TEMPORAL_WGSL,
    reflectionWeighWgsl(true),
    FRONT_PACK_WGSL,
    surfaceReflects,
    f0Of,
    clampToExtent,
    GOLDEN_ANGLE,
  ],
  `@group(0) @binding(${B.bilateralIn}) var bilateralIn:texture_2d<u32>;
@group(0) @binding(${B.base}) var traceBase:texture_2d<f32>;
@group(0) @binding(${B.target}) var reflectionOut:texture_storage_2d<${HDR_FORMAT},write>;
@group(0) @binding(${B.frontTarget}) var frontOut:texture_storage_2d<${FRONT_TRACED_FORMAT},write>;
/** What the pixel \`own\` at \`coord\` reflects: the history of the grid texels around it, read where they
 *  saw its surface (\`historyGather\`, a texel a block of pixels), and, as short as that is, its
 *  neighbours' — on a disc of the lobe's reach, in texels. */
fn bilateralTexel(coord:vec2i,own:ReflectingPixel)->Reflected{
 let block=f32(REFLECTION_TRACE_BLOCK);
 let q=(vec2f(coord)+vec2f(0.5))/block-vec2f(0.5);
 let depth=surfaceLinearDepth(own.P);
 let held=historyGather(bilateralIn,q,depth,own.N,own.V,block);
 let size=vec2i(textureDimensions(bilateralIn));
 let centre=clampToExtent(vec2i(round(q)),size);
 // A pixel none of whose texels traced its surface — a feature thinner than a block, its block's turn
 // on another surface — reads the nearest texel's history as it stands, never nothing.
 if(held.weight<=REFLECTION_EPSILON){
  let near=textureLoad(bilateralIn,centre,0);
  if(historyCount(near)==0u){return Reflected(vec3f(0.0),vec3f(0.0));}
  return texelReflected(near);
 }
 let mine=reflectionDenoised(Reflected(held.radiance.base/held.weight,held.radiance.coat/held.weight));
 let lack=1.0-min(held.count/held.weight/f32(REFLECTION_HISTORY),1.0);
 // The lobe's reach at this image's own hit (the spatial reuse's texel keeps it): a mirror's is under a
 // texel, and it keeps the history it read alone.
 let fresh=textureLoad(temporalIn,centre,0);
 let hit=select(REFLECTION_FAR,freshHit(fresh),freshValid(fresh));
 let radius=min(reflectionReuseReach(own.P,lobeAlpha(own.rough),hit),f32(REFLECTION_REUSE_RADIUS))/block;
 var sum=mine;
 var total=1.0;
 if(lack>0.0&&radius>=1.0){
  let turn=f32(reflectionView.temporal.x)*GOLDEN_ANGLE;
  for(var k=0u;k<REFLECTION_REUSE_TAPS;k++){
   let a=turn+f32(k)*GOLDEN_ANGLE;
   let reach=radius*sqrt((f32(k)+0.5)/f32(REFLECTION_REUSE_TAPS));
   let tap=clampToExtent(centre+vec2i(round(reach*vec2f(cos(a),sin(a)))),size);
   let n=textureLoad(bilateralIn,tap,0);
   if(all(tap==centre)||historyCount(n)==0u){continue;}
   let full=min(f32(historyCount(n))/f32(REFLECTION_HISTORY),1.0);
   let apart=distance((vec2f(tap)+vec2f(0.5))*block,vec2f(coord)+vec2f(0.5));
   let w=lack*full*reflectionSameSurface(depth,own.N,own.V,historyDepth(n),historyNormal(n),apart);
   if(!(w>0.0)){continue;}
   let r=reflectionDenoised(texelReflected(n));
   sum.base+=w*r.base;sum.coat+=w*r.coat;
   total+=w;
  }
 }
 return reflectionLinear(Reflected(sum.base/total,sum.coat/total));
}
/** The pixel of a listed tile's texels a thread of the last pass takes: the tile's \`REFLECTION_SIDE\`²
 *  texels widened to their blocks, a thread a pixel. */
fn bilateralPixel(tile:vec3u,groups:vec3u,local:vec3u)->vec2u{
 return reflectionTilePixel(tile,groups,vec3u(0u))*REFLECTION_TRACE_BLOCK+local.xy;
}
@compute @workgroup_size(${BILATERAL_SIDE},${BILATERAL_SIDE})
fn bilateralOpaque(@builtin(workgroup_id) tile:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_id) local:vec3u){
 let id=bilateralPixel(tile,groups,local);
 if(any(vec2f(id)>=view.viewport.xy)){return;}
 let coord=vec2i(id);
 let flags=surfaceFlagsAt(coord);
 if(!surfaceReflects(flags)){return;}
 let own=reflectingPixelAt(0u,coord,flags);
 let base=textureLoad(traceBase,coord,0);
 let share=reflectionShare(bilateralTexel(coord,own),f0Of(base.rgb,base.a),own.rough,own.N,own.V);
 textureStore(reflectionOut,coord,vec4f(share,1.0));
}
@compute @workgroup_size(${BILATERAL_SIDE},${BILATERAL_SIDE})
fn bilateralFront(@builtin(workgroup_id) tile:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_id) local:vec3u){
 let id=bilateralPixel(tile,groups,local);
 if(any(vec2f(id)>=view.viewport.xy)){return;}
 let coord=vec2i(id);
 let flags=surfaceFlagsAt(coord);
 if(!surfaceReflects(flags)){return;}
 let r=bilateralTexel(coord,reflectingPixelAt(1u,coord,flags));
 textureStore(frontOut,coord,vec4u(frontPack(r.base),frontPack(r.coat),0u,0u));
}`,
)
