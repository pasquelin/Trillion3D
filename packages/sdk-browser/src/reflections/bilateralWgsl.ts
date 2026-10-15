import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { GOLDEN_ANGLE } from '../../../math/src/wgsl/constants.ts'
import { f0Of } from '../../../math/src/wgsl/lighting.ts'
import { clampToExtent } from '../../../math/src/wgsl/sampling.ts'
import { surfaceReflects } from '../scene/surfaceModel.ts'
import { HDR_FORMAT } from '../scene/targetFormats.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { FRONT_TRACED_FORMAT } from './frontLayer.ts'
import { FRONT_PACK_WGSL } from './frontPackWgsl.ts'
import { REFLECTION_TILES_WGSL, REFLECTION_TRACE_BINDINGS as B } from './traceBindings.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { REFLECTION_SPATIAL_WGSL } from './spatialWgsl.ts'
import { REFLECTION_TEXEL_WGSL } from './texelWgsl.ts'
import { reflectionWeighWgsl } from './weight.ts'

/**
 * THE LAST PASS, a pixel a thread (`bilateralOpaque`, `bilateralFront`): every pixel averages its
 * history (`bilateralIn`, this image's accumulation) with its neighbours' on a disc of the lobe's own
 * reach (`reflectionReuseReach` at the far scene, `REFLECTION_REUSE_RADIUS` pixels at most), each
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
/** What the pixel \`own\` at \`coord\` reflects: its history and, as short as it is, its neighbours'. */
fn bilateralTexel(coord:vec2i,own:ReflectingPixel)->Reflected{
 let t=textureLoad(bilateralIn,coord,0);
 let count=historyCount(t);
 if(count==0u){return Reflected(vec3f(0.0),vec3f(0.0));}
 let mine=reflectionDenoised(texelReflected(t));
 let lack=1.0-min(f32(count)/f32(REFLECTION_HISTORY),1.0);
 let radius=min(reflectionReuseReach(own.P,lobeAlpha(own.rough),REFLECTION_FAR),f32(REFLECTION_REUSE_RADIUS));
 var sum=mine;
 var total=1.0;
 if(lack>0.0&&radius>=1.0){
  let depth=surfaceLinearDepth(own.P);
  let size=vec2i(textureDimensions(bilateralIn));
  let turn=f32(reflectionView.temporal.x)*GOLDEN_ANGLE;
  for(var k=0u;k<REFLECTION_REUSE_TAPS;k++){
   let a=turn+f32(k)*GOLDEN_ANGLE;
   let reach=radius*sqrt((f32(k)+0.5)/f32(REFLECTION_REUSE_TAPS));
   let tap=clampToExtent(coord+vec2i(round(reach*vec2f(cos(a),sin(a)))),size);
   let n=textureLoad(bilateralIn,tap,0);
   if(all(tap==coord)||historyCount(n)==0u){continue;}
   let full=min(f32(historyCount(n))/f32(REFLECTION_HISTORY),1.0);
   let w=lack*full*reflectionSameSurface(depth,own.N,own.V,historyDepth(n),historyNormal(n),distance(vec2f(tap),vec2f(coord)));
   if(!(w>0.0)){continue;}
   let r=reflectionDenoised(texelReflected(n));
   sum.base+=w*r.base;sum.coat+=w*r.coat;
   total+=w;
  }
 }
 return reflectionLinear(Reflected(sum.base/total,sum.coat/total));
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn bilateralOpaque(@builtin(workgroup_id) tile:vec3u,@builtin(local_invocation_id) local:vec3u){
 let id=reflectionTilePixel(tile,local);
 if(any(vec2f(id)>=view.viewport.xy)){return;}
 let coord=vec2i(id);
 let flags=surfaceFlagsAt(coord);
 if(!surfaceReflects(flags)){return;}
 let own=reflectingPixelAt(0u,coord,flags);
 let base=textureLoad(traceBase,coord,0);
 let share=reflectionShare(bilateralTexel(coord,own),f0Of(base.rgb,base.a),own.rough,own.N,own.V);
 textureStore(reflectionOut,coord,vec4f(share,1.0));
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn bilateralFront(@builtin(workgroup_id) tile:vec3u,@builtin(local_invocation_id) local:vec3u){
 let id=reflectionTilePixel(tile,local);
 if(any(vec2f(id)>=view.viewport.xy)){return;}
 let coord=vec2i(id);
 let flags=surfaceFlagsAt(coord);
 if(!surfaceReflects(flags)){return;}
 let r=bilateralTexel(coord,reflectingPixelAt(1u,coord,flags));
 textureStore(frontOut,coord,vec4u(frontPack(r.base),frontPack(r.coat),0u,0u));
}`,
)
