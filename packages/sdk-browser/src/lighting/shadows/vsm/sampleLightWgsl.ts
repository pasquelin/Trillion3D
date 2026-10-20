/**
 * THE ONE-SAMPLE READ OF A LIGHT'S MAP, the default for translucent surfaces
 * (`LIGHT_SETTINGS.translucentShadowQuality` 0): a single depth compare at the receiver, with no ray
 * start and no optimal bias, cheap enough for every layer of a blend. The receiver's map is the trace's own (`vsmLightMapAt`: a sun's clipmap level, a spot's
 * map, a point light's cube face), one page-table read and one depth read at its texel, falling back
 * to a coarser level or mip as the trace's samples do.
 */
import { type WgslDecl, wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { perspectiveDivide } from '../../../../../math/src/wgsl/projection.ts'
import { vsmTraceMapWgsl } from './trace/traceMapWgsl.ts'
import { VSM_TRACE_KINDS_BOTH, vsmTraceLightWgsl } from './trace/traceWgsl.ts'

/** `vsmSampleLight`, sampling the pages of `pool`, for the light kinds `kinds`. The host declares
 *  the view `vsmView`. */
export const vsmSampleLightWgsl = (pool: WgslDecl, kinds = VSM_TRACE_KINDS_BOTH) =>
  wgslBlock(
    `vsmSampleLightWgsl(${kinds})`,
    [vsmTraceLightWgsl(kinds), vsmTraceMapWgsl(pool), perspectiveDivide],
    `
/** Light \`light\`'s share at the receiver \`shifted\` (the view's shifted frame): 0 where its map's
 *  stored depth lies nearer the light than the receiver, 1 elsewhere — where no level or mip maps
 *  it too: a page no level holds casts nothing. A sun's reads the page its map already read, at the
 *  level the receiver's distance asks (\`vsmLightMapAt\`): one page-table read a sample. */
fn vsmSampleLight(light:VsmProjectionLight,shifted:vec3f)->f32{
 let m=vsmLightMapAt(light,shifted);
 if(!m.valid){return 1.0;}
 let uvz=perspectiveDivide(m.mapPoint);
 if(any(uvz.xy!=saturate(uvz.xy))){return 1.0;}
 if(m.clipmap){
  let read=vsmReadClipmapPage(m.level,m.page,m.levelPoint.xy);
  return select(1.0,0.0,read.valid&&read.depth>m.levelPoint.z);
 }
 let read=vsmReadMap(m.handle,uvz.xy,m.mip);
 return select(1.0,0.0,read.valid&&read.depth>uvz.z);
}`,
  )
