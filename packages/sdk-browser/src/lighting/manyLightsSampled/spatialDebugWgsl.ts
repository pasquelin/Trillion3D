/**
 * THE SPATIAL FILTER'S DEBUG OUTPUT: what the debug views of the denoiser (`debug/visualizeWgsl.ts`) read of the pixel, written beside the filter's own result by a variant of its kernel
 * that is made only while a view asks. A pixel owns a block of 2 by 2 texels of one `rgba32float` texture (`DEBUG_PIXEL_BLOCK`):
 * - (0, 0): the deviation of the diffuse and of the specular light over their mean (the measure that decides whether the filter runs), the disocclusion factor, and which of the
 *   two lights the filter ran on (1 diffuse, 2 specular, 3 both);
 * - (1, 0): the diffuse demodulation factor and the grey the view paints the surface (its shaded colours under a fixed light);
 * - (0, 1): the specular demodulation factor and the deviation of the history's own confidence for the diffuse light;
 * - (1, 1): the same for the specular light, and what the pixel is (1 a lit surface, 2 the sky, 0 anything else).
 * A pixel that is no lit surface writes zeros, the sky marked.
 */
import { SAMPLED_BINDINGS } from './bindings.ts'

/** The texels along x and y one pixel owns in the debug texture. */
export const DEBUG_PIXEL_BLOCK = 2

/** The binding the debug texture is written through. */
export const DEBUG_PIXELS_DECLARATION = `@group(0) @binding(${SAMPLED_BINDINGS.debugPixels}) var debugPixels:texture_storage_2d<rgba32float,write>;`

/** What a pixel of the debug texture is, as its last texel holds it. */
export const DEBUG_PIXEL_KIND = { none: 0, surface: 1, sky: 2 } as const

/** The statements that write a pixel `screen` that is no lit surface (the sky marked): zeros. */
export const DEBUG_EMPTY = `{
  let dbgAt=vec2i(screen)*${DEBUG_PIXEL_BLOCK};
  let dbgKind=select(${DEBUG_PIXEL_KIND.none}.0,${DEBUG_PIXEL_KIND.sky}.0,textureLoad(depth,vec2i(screen),0)<=0.0);
  textureStore(debugPixels,dbgAt,vec4f(0.0));
  textureStore(debugPixels,dbgAt+vec2i(1,0),vec4f(0.0));
  textureStore(debugPixels,dbgAt+vec2i(0,1),vec4f(0.0));
  textureStore(debugPixels,dbgAt+vec2i(1,1),vec4f(0.0,dbgKind,0.0,0.0));
 }
 `

/** The direction the surface is lit from in the view of the surfaces' colours. */
const PREVIEW_LIGHT = 'vec3f(0.707,0.0,0.707)'

/** Replaces `anchor`, which the filter's text holds once, by `text`. */
function replaceOnce(code: string, anchor: string, text: string) {
  if (code.split(anchor).length !== 2) throw new Error(`SPATIAL_DEBUG_ANCHOR_MISSING ${anchor}`)
  return code.replace(anchor, () => text)
}

/** The filter's text with the debug texture, the values it keeps about the pixel and their writes added. */
export function withDebugPixels(code: string) {
  let out = `${DEBUG_PIXELS_DECLARATION}\n${code}`
  out = replaceOnce(
    out,
    ' var specular=centreSpecular.rgb;',
    ' var specular=centreSpecular.rgb;\n var dbgStd=vec2f(0.0);var dbgHist=vec2f(0.0);var dbgFlags=0u;',
  )
  out = replaceOnce(
    out,
    'if(params.spatialU.z!=0u){noisy=historyDeviation(lx,ly)>vec2f(params.spatial.w);}',
    'if(params.spatialU.z!=0u){dbgHist=historyDeviation(lx,ly);noisy=dbgHist>vec2f(params.spatial.w);}',
  )
  out = replaceOnce(
    out,
    'filterSpecular=stdSpecular/max(centreMoments.z,0.1)>0.2&&maxByConfidence>=4.0;',
    'filterSpecular=stdSpecular/max(centreMoments.z,0.1)>0.2&&maxByConfidence>=4.0;\n   dbgStd=vec2f(stdDiffuse/max(centreMoments.x,0.1),stdSpecular/max(centreMoments.z,0.1));',
  )
  out = replaceOnce(
    out,
    'filterDiffuse=stdDiffuse/max(centreMoments.x,0.1)>0.5||noisy.x;',
    'dbgStd=vec2f(stdDiffuse/max(centreMoments.x,0.1),stdSpecular/max(centreMoments.z,0.1));\n    filterDiffuse=stdDiffuse/max(centreMoments.x,0.1)>0.5||noisy.x;',
  )
  out = replaceOnce(
    out,
    '  var diffuseSum=diffuse;',
    '  dbgFlags=select(0u,1u,filterDiffuse)|select(0u,2u,filterSpecular);\n  var diffuseSum=diffuse;',
  )
  return replaceOnce(
    out,
    ' textureStore(composite,vec2i(screen),vec4f(diffuse+max(specular,vec3f(0.0)),scatterable));',
    ` {
  let dbgAt=vec2i(screen)*${DEBUG_PIXEL_BLOCK};
  let dbgLit=0.5*dot(${PREVIEW_LIGHT},N)+0.5;
  let dbgGrey=sqrt(lum(diffuseColour+0.3*f0)*dbgLit*1.5);
  textureStore(debugPixels,dbgAt,vec4f(dbgStd,disocclusion,f32(dbgFlags)));
  textureStore(debugPixels,dbgAt+vec2i(1,0),vec4f(mix(vec3f(0.04),vec3f(1.0),diffuseColour),dbgGrey));
  textureStore(debugPixels,dbgAt+vec2i(0,1),vec4f(mix(vec3f(0.02),vec3f(1.0),environment),dbgHist.x));
  textureStore(debugPixels,dbgAt+vec2i(1,1),vec4f(dbgHist.y,${DEBUG_PIXEL_KIND.surface}.0,0.0,0.0));
 }
 textureStore(composite,vec2i(screen),vec4f(diffuse+max(specular,vec3f(0.0)),scatterable));`,
  )
}
