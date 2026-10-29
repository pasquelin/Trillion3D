/**
 * THE CLASSIC SHADOW MAPS' DEPTH PASS (`shadowVirtualEnable` off): the casters' records the cull sorted (`vsm/render/renderBinWgsl.ts`) drawn by the hardware raster
 * into a depth atlas, one tile a map (`atlasPlan.ts`), where the virtual shadow maps' raster joins them to the pool through the page table. The vertex stage is the pool raster's
 * (`renderRasterVertex`) but for the placing: a record's map pixel goes to its tile of the atlas, the tile's corner in the map taken from the page rect the dense marking wrote
 * (`vsmMarkDense`), and the depth bias of its map (`DrawBias`) taken off the vertex's depth from the slope of its normal against the light's axis. The records a pass is given are its own: sorted by the texture layer of their tile (`atlasBinWgsl.ts`), which leaves out those whose map has no tile, of another mip than the tile's, or a movable caster's in a map that leaves them out. The fragment writes
 * the depth, tested against what the attachment holds: the static layer's cache copied in and the casters drawn before.
 *
 * Group 0 = the engine's shadow page group, group 1: 0 the sorted records (vertex), 1 projection data (vertex), 5 the uniforms and 6 the atlas buffer (both stages).
 */
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { VIS_BINDINGS } from '../../../../gpu/bind/bindLayout.ts'
import { NO_MASKS, maskKnowsPixel, type MaskSet } from '../../../../materials/graph/maskProgram.ts'
import { NO_WPO, type WpoSet } from '../../../../materials/graph/wpoProgram.ts'
import {
  colorSampleWgsl,
  maskAlphaWgsl,
  SHADOW_TILE_POOL_WGSL,
} from '../../../../materials/virtual/wgsl.ts'
import { PAGE_GEOMETRY_WGSL } from '../../../../visibility/shader/pageGeometryWgsl.ts'
import { maskUvWgsl } from '../../../../visibility/shader/pageUvSetWgsl.ts'
import { PAGE_INFO_WGSL, maskKeepWgsl } from '../../../../visibility/shader/pageWgsl.ts'
import { wpoGraphWgsl } from '../../../../visibility/shader/wpoGraphWgsl.ts'
import { VSM_CONSTANTS_WGSL } from '../../vsm/constants.ts'
import {
  VSM_PROJECTION_DATA_WGSL,
  VSM_PROJECTION_RECORD_WGSL,
} from '../../vsm/projection/projectionDataWgsl.ts'
import { VSM_CASTER_PROJECTION_WGSL } from '../../vsm/render/renderCasterWgsl.ts'
import { VSM_RENDER_RECORD_WGSL } from '../../vsm/render/renderParamsWgsl.ts'
import {
  VSM_RENDER_OUT_WGSL,
  VSM_RENDER_RASTER_SHARED_SPECS,
  VSM_RENDER_RASTER_VERTEX_SPECS,
  POOL_PLACE,
  renderRasterVertex,
  type RasterPlace,
} from '../../vsm/render/renderRasterWgsl.ts'
import { vsmBindingsWgsl } from '../../vsm/resources.ts'
import type { VsmLayout } from '../../vsm/layout.ts'
import { DRAW_BIAS_WGSL } from './atlasTileWgsl.ts'

/** The target's format: 32-bit depth, the greater the nearer the light, cleared to zero as the pool's words are. */
export const ATLAS_DEPTH_FORMAT: GPUTextureFormat = 'depth32float'

/** The atlas raster's placing of a record, in the pool raster's vertex stage (the depth bias is the pool's). */
const ATLAS_PLACE: RasterPlace = {
  ...POOL_PLACE,
  window: 'vsmAtlasWindowOf(record)',
  position: 'vsmAtlasPosition(clip,record)',
}

/** What the vertex stage places a record by: the window the fragment reads (the map, the layer and the mip), the position on the atlas, and the clip position with its depth bias. */
const ATLAS_PLACING_WGSL = wgslBlock(
  'VSM_ATLAS_PLACING_WGSL',
  [
    VSM_CONSTANTS_WGSL,
    VSM_RENDER_RECORD_WGSL,
    PAGE_INFO_WGSL,
    VSM_PROJECTION_RECORD_WGSL,
    DRAW_BIAS_WGSL,
  ],
  `fn vsmAtlasWindowOf(r:vec4u)->vec3u{
 return vec3u(vsmRecordMap(r),vsmRecordStatic(r)|(vsmRecordMip(r)<<1u),0u);
}
/** A clip position of the map on the atlas: the virtual pixel of the tile's mip, minus the tile's corner in the map, plus its corner in the atlas, as the pool raster places a window. */
fn vsmAtlasPosition(clip:vec4f,r:vec4u)->vec4f{
 let t=vsmAtlasTileOf(vsmRecordMap(r));
 let size=f32(VSM_LEVEL0_TEXELS>>t.mip);
 let o=vec2f(t.corner)-vec2f(t.mapCorner);
 let scale=2.0/t.size;
 let p=vec4f(clip.x*size*scale.x+clip.w*(o.x*scale.x-1.0),clip.w*(1.0-o.y*scale.y)-clip.y*size*scale.y,clip.z,clip.w);
 return select(p,vec4f(p.xy,0.5*p.w,p.w),vsmRecordNoNearClip(r));
}`,
)

const atlasFragment = (masks: MaskSet) => /* wgsl */ `
struct VsmAtlasDepth{@builtin(frag_depth) depth:f32,}
/** The depth fragment of the atlas: inside the record's tile, past the material clip of a masked row, its depth. */
@fragment fn vsmRenderFs(in:VsmRenderOut)->VsmAtlasDepth{
 let gx=dpdx(in.uv);let gy=dpdy(in.uv);
 let tile=vsmAtlasTileOf(in.window.x);
 let inside=vec2i(in.position.xy)-vec2i(tile.corner);
 if(any(inside<vec2i(0))||any(inside>=vec2i(i32(tile.side)))){discard;}
 if(in.masked!=0u&&!${
   maskKnowsPixel(masks)
     ? 'maskKeepAt(pages[in.row],in.uv,1.0,gx,gy,vsmRenderMapPixel(in.clip,in.window.y>>1u))'
     : 'maskKeep(pages[in.row],in.uv,1.0,gx,gy)'
 }){discard;}
 var out:VsmAtlasDepth;
 out.depth=clamp(in.clip.z/in.clip.w,0.0,1.0);
 return out;
}`

/** The atlas raster's text (entries `vsmRenderVs` and `vsmRenderFs`, as the pool raster's), its cutouts and offsets those of the session's surfaces (`masks`, `wpo`). */
export const vsmAtlasRasterWgsl = (
  layout: VsmLayout,
  masks: MaskSet = NO_MASKS,
  wpo: WpoSet = NO_WPO,
) =>
  wgslProgram(
    /* wgsl */ `
${renderRasterVertex(wpo, ATLAS_PLACE)}${atlasFragment(masks)}
`,
    [
      VSM_RENDER_OUT_WGSL,
      ATLAS_PLACING_WGSL,
      PAGE_INFO_WGSL,
      VSM_CASTER_PROJECTION_WGSL,
      SHADOW_TILE_POOL_WGSL,
      colorSampleWgsl(SHADOW_TILE_POOL_WGSL),
      maskKeepWgsl(maskAlphaWgsl(true, SHADOW_TILE_POOL_WGSL), masks),
      VSM_CONSTANTS_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      vsmBindingsWgsl(1, VSM_RENDER_RASTER_VERTEX_SPECS, layout),
      vsmBindingsWgsl(1, VSM_RENDER_RASTER_SHARED_SPECS, layout),
      PAGE_GEOMETRY_WGSL,
      maskUvWgsl(VIS_BINDINGS.normals),
      ...(wpo.programs.length ? [wpoGraphWgsl(wpo)] : []),
    ],
  )
