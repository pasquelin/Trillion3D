import { FULLSCREEN_VERTEX } from '../lighting/deferred/shaders.ts'
import * as layer from './layers.ts'
import { BINDINGS_WGSL, shareBindingsWgsl } from './bindingsWgsl.ts'
import { TAA_DEFORM_WGSL } from './deformWgsl.ts'
import {
  CATMULL_ROM_WGSL,
  CURRENT_SHARE_WGSL,
  HISTORY_CAP_WGSL,
  HISTORY_TEXEL_WGSL,
  PAGE_OF_WGSL,
  shareText,
  taaHistoryBlend,
} from './historyWgsl.ts'
import { YCOCG_WGSL } from './ycocgWgsl.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import {
  clipToUv,
  pixelToNdcInv,
  transformHomogeneousPoint,
} from '../../../math/src/wgsl/projection.ts'
import { SHADING_HISTORY_WGSL } from './shadingHistoryWgsl.ts'
import {
  GEOMETRY_HISTORY_WGSL,
  NEAREST_OF_WGSL,
  CLOSEST_SURFACE_WGSL,
} from './geometryHistoryWgsl.ts'
import { AS_IS_FLAG } from '../scene/surfaceModel.ts'

/** One neighbour's luma into the 3×3 blur (1, ½, ¼ for centre, sides and corners, over sixteen) and
 *  into the luma's slopes across it (a Sobel pair, over eight), in both resolves: the blurred luma
 *  the flicker measure compares, and the spread of the blurred lumas over the 3×3 the slopes give
 *  (`shadingMoire`). Taken from the YCoCg luma the box already holds: no work per texel but this. */
export const BLUR_TAP = `  blur+=y.x*vec3f(f32((2-abs(dx))*(2-abs(dy))),f32(dx*(2-abs(dy))),f32(dy*(2-abs(dx))));
`

/** How a resolve reads a render texel `at`: the colour and the as-is weight (a blended share's
 *  value, or whether the flags say as-is). */
export interface TexelReads {
  color: (at: string) => string
  flag: (at: string) => string
}
export const texelReads = (blended: boolean): TexelReads => ({
  color: (at) => `textureLoad(current,${at},0)`,
  flag: (at) =>
    blended ? `textureLoad(flags,${at},0).r` : `f32(textureLoad(flags,${at},0).r==${AS_IS_FLAG}u)`,
})

/**
 * Where this pixel was on the previous frame, in history texture coordinates, and whether that
 * position is readable. The pixel is rebuilt in homogeneous from its depth (`pixelPoint`) — the
 * background, at zero depth (reversed, infinite far plane), is a direction and reprojects too, which
 * keeps the silhouette stable when the camera turns. Its point then goes back to where its surface
 * stood (`pointBefore`): a geometry pixel through its own motion matrix — `previous·current⁻¹`,
 * identity for those that have not moved; otherwise nothing is read, neither identifier, nor record,
 * nor matrix. `coord` is the display pixel, `id` the identifier of the render texel its depth was
 * read at, read once by the resolve for its identity, its motion and its deformation.
 */
export const taaReprojectWgsl = (deformation = true) =>
  wgslBlock(
    `taaReprojectWgsl(${deformation})`,
    [pixelToNdcInv, clipToUv, transformHomogeneousPoint],
    `
fn placementOf(id:u32)->u32{return pages[(id>>8u)-1u].placement;}
fn pixelPoint(coord:vec2i,depthValue:f32)->vec4f{
 let ndc=pixelToNdcInv(vec2f(coord)+0.5,view.viewport.zw);
 return transformHomogeneousPoint(view.invViewProj,vec3f(ndc,depthValue));
}
fn pointBefore(here:vec4f,id:u32)->vec4f{
 var position=here;
 // A deformed surface was elsewhere in the last frame: its point moves back first.
${deformation ? ' if(view.eye.w!=0.0){position=deformedPrevious(id,position);}' : ''}
 if(view.params.z!=0.0&&id!=0u){position=motion[placementOf(id)]*position;}
 return position;
}
fn previousProjected(position:vec4f)->vec4f{
 let previous=view.prevViewProj*position;
 if(previous.w<=0.0){return vec4f(0.0);}
 let uv=clipToUv(previous);
 let inside=all(uv>=vec2f(0.0))&&all(uv<=vec2f(1.0));
 return vec4f(uv,previous.z/previous.w,select(0.0,1.0,inside));
}
fn previousSample(coord:vec2i,depthValue:f32,id:u32)->vec4f{
 return previousProjected(pointBefore(pixelPoint(coord,depthValue),id));
}
fn previousUv(coord:vec2i,depthValue:f32,id:u32)->vec3f{
 let p=previousSample(coord,depthValue,id);return vec3f(p.xy,p.w);
}`,
  )

const TAA_REPROJECT_WGSL = taaReprojectWgsl()

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
 * as-is pixel in the frame (`asIs` false) that share is exactly 0 wherever the colour is
 * finite — each neighbour 0, and history clamped to [0, 0] —: the flagless resolve writes 0 and
 * reads neither the flags nor the as-is share history, its colour the same text. Every resolve
 * writes, beside the share, the pixel's geometry an uncovered pixel is told by (`historyWgsl.ts`).
 */
export const taaShader = (asIs: boolean, blended = false, filtered = false, reactive = true) => {
  const share = shareText(asIs),
    read = texelReads(blended)
  return wgslProgram(
    `@fragment fn resolve(@builtin(position) pixel:vec4f)->TaaOut{
 let coord=vec2i(pixel.xy);
 let last=vec2i(view.viewport.xy)-vec2i(1);
 var filtered=vec4f(0.0);
 var lo=vec4f(1e9);var hi=vec4f(-1e9);var blur=vec3f(0.0);
${share(' var share=0.0;var shareLo=1.0;var shareHi=0.0;\n')}${layer.layerText(filtered, 'vars')} var k=0u;
 for(var dy=-1;dy<=1;dy++){for(var dx=-1;dx<=1;dx++){
  let at=clamp(coord+vec2i(dx,dy),vec2i(0),last);
  let sample=${read.color('at')};
  let weight=view.weights[k>>2u][k&3u];k++;
  filtered+=sample*weight;
  let y=vec4f(toYcocg(sample.rgb),sample.a);
  lo=min(lo,y);hi=max(hi,y);
${BLUR_TAP}${taaShareTap(asIs, read)}${layer.layerText(filtered, 'tap')} }}
 let centre=coord;let reach=1.0;
 let closest=closestSurface(coord,last);let nearDepth=closest.depth;let depthSlack=closest.slope;
 let id=closest.id;let page=pageOf(id);let geometry=vec2u(page.identity,bitcast<u32>(nearDepth));
${MEASURES}
 if(view.params.y==0.0){return ${layer.taaOut(asIs, filtered)};}
 let here=pixelPoint(coord,nearDepth);let before=pointBefore(here,id);let previous=previousProjected(before);
${taaHistoryBlend(asIs, filtered, false, 'page', reactive)}
}`,
    [taaPrelude(asIs, blended, filtered)],
  )
}

/** What both resolves measure once their 3×3 is read and `filtered` known (`shadingHistoryWgsl.ts`):
 *  the image's luma, linear and in the measurement curve, the blurred luma and the box of the
 *  blurred lumas over the 3×3 — exact for a luma that varies linearly across it —, and the outputs
 *  a pixel without history writes: a fresh flicker measure, one sample, no gradient. */
export const MEASURES = ` let lumaNow=toYcocg(filtered.rgb).x;let now=shadingLuma(lumaNow);
 let blurLuma=blur.x/16.0;let blurSpread=(abs(blur.y)+abs(blur.z))/8.0;
 let blurred=shadingLuma(blurLuma);let blurRange=vec2f(shadingLuma(blurLuma-blurSpread),shadingLuma(blurLuma+blurSpread));
 var moire=shadingPack(shadingFresh(blurred));var historyCount=1.0;var gradient=0.0;`

/** One neighbour's as-is share, weighed like its colour, in both resolves, read through `read`;
 *  nothing in the flagless one. */
export const taaShareTap = (asIs: boolean, read: TexelReads) =>
  shareText(asIs)(
    `  let asIs=${read.flag('at')};\n  share+=asIs*weight;shareLo=min(shareLo,asIs);shareHi=max(shareHi,asIs);\n`,
  )

/** What both resolves open with: bindings, uniform, the full-screen triangle, YCoCg, reprojection,
 *  the history's own functions (`historyWgsl.ts`) and their output (`taaOut`, `layers.ts`). */
export const taaPrelude = (asIs: boolean, blended: boolean, filtered = false) => {
  const at = (location: number) => `@location(${location}) `
  return wgslBlock(
    `taaPrelude(${asIs}, ${blended}, ${filtered})`,
    [
      TAA_DEFORM_WGSL,
      TAA_REPROJECT_WGSL,
      BINDINGS_WGSL,
      ...(asIs ? [shareBindingsWgsl(blended)] : []),
      FULLSCREEN_VERTEX,
      YCOCG_WGSL,
      CATMULL_ROM_WGSL,
      PAGE_OF_WGSL,
      HISTORY_TEXEL_WGSL,
      HISTORY_CAP_WGSL,
      GEOMETRY_HISTORY_WGSL,
      SHADING_HISTORY_WGSL,
      NEAREST_OF_WGSL,
      CLOSEST_SURFACE_WGSL,
      CURRENT_SHARE_WGSL,
    ],
    `${layer.layerText(filtered, 'bindings')}
struct TaaOut{${at(0)}color:vec4f,${at(1)}share:vec4f,${at(2)}geometry:vec2u,${at(3)}moire:u32,${filtered ? `${at(4)}tint:vec4f,${at(5)}add:vec4f,` : ''}}`,
  )
}
