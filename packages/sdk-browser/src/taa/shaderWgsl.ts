import { FULLSCREEN_VERTEX } from '../lighting/deferred/shaders.ts';
import { PAGE_INFO_STRUCT_WGSL } from '../visibility/shader/pageWgsl.ts';
import { AS_IS_FLAG } from '../scene/surfaceModel.ts';
import * as layer from './layers.ts';
import { BINDINGS_WGSL, shareBindingsWgsl, VIEW_WGSL } from './bindingsWgsl.ts';
import { TAA_DEFORM_WGSL } from './deformWgsl.ts';
import {
  CATMULL_ROM_WGSL,
  CURRENT_SHARE_WGSL,
  PLACEMENT_TAG_WGSL,
  shareText,
  taaHistoryBlend,
} from './historyWgsl.ts';
import { YCOCG_WGSL } from './ycocgWgsl.ts';

/** Pass label; its timestamp duration absorbs that of the passes that precede it on
 *  some devices (apple metal-3), and is only read safely by envelope difference. */
export const TAA_PASS = 'Trillion3D temporal antialiasing';

/**
 * Where this pixel was on the previous frame, in history texture coordinates, and whether that
 * position is readable. The pixel is rebuilt in homogeneous from its depth — the background, at
 * zero depth (reversed, infinite far plane), is a direction and reprojects too, which
 * keeps the silhouette stable when the camera turns. When a placement has moved, a geometry
 * pixel first goes through its own motion matrix — `previous·current⁻¹`, identity
 * for those that have not moved; otherwise nothing is read, neither identifier, nor record, nor matrix.
 * `coord` is the display pixel, `id` the identifier of the render texel its depth was read at,
 * read once by the resolve for its tag, its motion and its deformation.
 */
export const taaReprojectWgsl = (deformation = true) => `
fn placementOf(id:u32)->u32{return pages[(id>>8u)-1u].placement;}
fn previousUv(coord:vec2i,depthValue:f32,id:u32)->vec3f{
 let ndc=vec2f((f32(coord.x)+0.5)*view.viewport.z*2.0-1.0,1.0-(f32(coord.y)+0.5)*view.viewport.w*2.0);
 var position=view.invViewProj*vec4f(ndc,depthValue,1.0);
 // A deformed surface was elsewhere in the last frame: its point moves back first (#357).
${deformation ? ' if(view.eye.w!=0.0){position=deformedPrevious(id,position);}' : ''}
 if(view.params.z!=0.0&&id!=0u){position=motion[placementOf(id)]*position;}
 let previous=view.prevViewProj*position;
 if(previous.w<=0.0){return vec3f(0.0,0.0,0.0);}
 let uv=vec2f(previous.x/previous.w*0.5+0.5,0.5-previous.y/previous.w*0.5);
 let inside=all(uv>=vec2f(0.0))&&all(uv<=vec2f(1.0));
 return vec3f(uv,select(0.0,1.0,inside));
}`;

const TAA_REPROJECT_WGSL = taaReprojectWgsl();

/**
 * Temporal resolve. The current image is refiltered on its 3×3 neighbours with the uniform
 * weights (Blackman-Harris centred on the unshifted centre); history is read at the
 * reprojected point, clamped to the YCoCg box of those
 * same neighbours — which removes ghosts of a moving object or a discovery — then the
 * two are mixed, each weighted by the inverse of its luminance so a spark does not settle.
 * All four channels are accumulated: alpha carries the coverage that composition divides.
 * Beside the colour, each pixel's as-is share — the weight of debug views (`AS_IS_FLAG`) in it,
 * which composition keeps off the display curve — is filtered, clamped and mixed with the very
 * same weights, so it follows the colour it describes: an edge between a debug view and a lit
 * surface settles on one blend of the curve and none, never flipping with the jitter. Without an
 * as-is pixel in the frame (`asIs` false, OMB-11) that share is exactly 0 wherever the colour is
 * finite — each neighbour 0, and history clamped to [0, 0] —: the flagless resolve writes 0 and
 * reads neither the flags nor the share history, its colour the same text. Every resolve writes,
 * beside the share, the placement tag an uncovered pixel is told by (`historyWgsl.ts`).
 */
export const taaShader = (asIs: boolean, blended = false, filtered = false) => {
  const share = shareText(asIs);
  return `${taaPrelude(asIs, blended, filtered)}
@fragment fn resolve(@builtin(position) pixel:vec4f)->TaaOut{
 let coord=vec2i(pixel.xy);
 let last=vec2i(view.viewport.xy)-vec2i(1);
 var filtered=vec4f(0.0);
 var lo=vec4f(1e9);var hi=vec4f(-1e9);
${share(' var share=0.0;var shareLo=1.0;var shareHi=0.0;\n')}${layer.layerWgsl(filtered, 'vars')} var k=0u;
 for(var dy=-1;dy<=1;dy++){for(var dx=-1;dx<=1;dx++){
  let at=clamp(coord+vec2i(dx,dy),vec2i(0),last);
  let sample=textureLoad(current,at,0);
  let weight=view.weights[k>>2u][k&3u];k++;
  filtered+=sample*weight;
  let y=vec4f(toYcocg(sample.rgb),sample.a);
  lo=min(lo,y);hi=max(hi,y);
${taaShareTap(asIs, blended)}${layer.layerWgsl(filtered, 'tap')} }}
 let centre=coord;let reach=1.0;let id=textureLoad(ids,centre,0).r;let tag=f32(tagOf(id))/255.0;
 if(view.params.y==0.0){return ${layer.taaOut(asIs, filtered)};}
 let previous=previousUv(coord,textureLoad(depth,coord,0),id);
${taaHistoryBlend(asIs, filtered, false, 'id')}
}`;
};

/** One neighbour's as-is share, weighed like its colour, in both resolves: nothing in the flagless
 *  one. */
export const taaShareTap = (asIs: boolean, blended: boolean) =>
  shareText(
    asIs,
  )(`  let asIs=${blended ? 'textureLoad(flags,at,0).r' : `f32(textureLoad(flags,at,0).r==${AS_IS_FLAG}u)`};
  share+=asIs*weight;shareLo=min(shareLo,asIs);shareHi=max(shareHi,asIs);\n`);

/** What both resolves open with: bindings, uniform, the full-screen triangle, YCoCg, reprojection,
 *  the history's own functions (`historyWgsl.ts`) and their output: the share beside its tag. */
export const taaPrelude = (asIs: boolean, blended: boolean, filtered = false) => `
${PAGE_INFO_STRUCT_WGSL}
${VIEW_WGSL}
${BINDINGS_WGSL}${asIs ? shareBindingsWgsl(blended) : ''}${layer.layerWgsl(filtered, 'bindings')}
${FULLSCREEN_VERTEX}
${YCOCG_WGSL}
${TAA_DEFORM_WGSL}
${TAA_REPROJECT_WGSL}
${CATMULL_ROM_WGSL}
${PLACEMENT_TAG_WGSL}
${CURRENT_SHARE_WGSL}
struct TaaOut{@location(0) color:vec4f,@location(1) share:vec4f,${filtered ? '@location(2) tint:vec4f,@location(3) add:vec4f,' : ''}}`;
