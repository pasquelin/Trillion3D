import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { transformHalfExtent } from '../../../../../../math/src/wgsl/geometry.ts'
import { BOX3 } from '../../../../visibility/tessellation/patchWgsl.ts'
import { TESS_VIEW } from '../../../../visibility/tessellation/viewWgsl.ts'
import { VSM_CONSTANTS_WGSL } from '../constants.ts'
import { VSM_BOX_VIEW_WGSL, VSM_VIEW_LENS_WGSL } from '../invalidation/boxCullWgsl.ts'
import { VSM_PROJECTION_DATA_WGSL } from '../projection/projectionDataWgsl.ts'
import { VSM_RENDER_RECORD_WGSL } from '../render/renderParamsWgsl.ts'

/**
 * THE VIEW OF A SHADOW MAP WINDOW, for the patches of a displaced surface (`TessView`): a record of
 * the raster (`vsmRenderCull`) names the map view that draws it — its projection record, `raw`, and
 * its mip — and the window of pages of that mip it draws.
 *
 * `vsmTessView`: the matrix taking the world to the map's clip space, its translation folded in; the
 * direction depth is measured along (the weight row of the matrix: a perspective view's weight is its
 * depth) and the point it is zero at, the light; the near plane, taken from the projection's depth
 * terms; and the pixels a unit subtends at depth one per pixel an edge may span — the projection's
 * scale over the map's mip, in pixels, over the cut's threshold (`tu.edgesPerPixel`). An
 * orthographic view (a sun's) has no depth to scale by.
 *
 * `vsmTessOnWindow`: whether a patch's box — in a row's local space, `world` its placement — reaches
 * the window the record draws: the box in the map's clip space by the render cull's own test of a
 * caster's box (`vsmBoxInView`), its pixels at the record's mip against the window's. A patch past
 * the map's frustum, or off the window, is gone. The program declares `tu`.
 */
export const VSM_TESS_VIEW_WGSL = wgslBlock(
  'VSM_TESS_VIEW_WGSL',
  [
    TESS_VIEW,
    BOX3,
    VSM_CONSTANTS_WGSL,
    VSM_PROJECTION_DATA_WGSL,
    VSM_BOX_VIEW_WGSL,
    VSM_VIEW_LENS_WGSL,
    transformHalfExtent,
    VSM_RENDER_RECORD_WGSL,
  ],
  `fn vsmTessView(raw:VsmProjectionRecord,mip:u32)->TessView{
 let shift=raw.originShiftHigh+raw.originShiftLow;
 var clip=raw.shiftedToMapUv;
 clip[3]=raw.shiftedToMapUv*vec4f(shift,1.0);
 let lens=vsmViewLens(raw.lightViewToClip,mip);
 return TessView(clip,vec3f(clip[0].w,clip[1].w,clip[2].w),-shift,lens.near,lens.focal*tu.edgesPerPixel,lens.perspective);
}
fn vsmTessOnWindow(box:Box3,world:mat4x4f,raw:VsmProjectionRecord,record:vec4u)->bool{
 let ortho=raw.lightViewToClip[3][3]>=1.0;
 let nearClip=!vsmRecordNoNearClip(record);
 let extent=transformHalfExtent(world,0.5*(box.hi-box.lo));
 let center=(world*vec4f(0.5*(box.lo+box.hi),1.0)).xyz+(raw.originShiftHigh+raw.originShiftLow);
 let toClip=vsmShiftedToClip(raw.shiftedToMapUv);
 let point=vsmBoxCullPoint(center,extent,ortho,nearClip);
 let cull=vsmBoxInView(toClip*vec4f(point,1.0),toClip[0],toClip[1],toClip[2],extent,raw.lightViewToClip,ortho,nearClip);
 if(!cull.inMapView){return false;}
 let level=i32(VSM_LEVEL0_TEXELS>>vsmRecordMip(record));
 let pixels=vsmRectPixels(vec4i(0,0,level,level),cull);
 let first=vec2i(vsmRecordFirstPage(record))*i32(VSM_PAGE_TEXELS);
 let last=(vec2i(vsmRecordLastPage(record))+vec2i(1))*i32(VSM_PAGE_TEXELS)-vec2i(1);
 return all(pixels.xy<=last)&&all(pixels.zw>=first);
}`,
)
