import { wgslBlock, wgslVariants } from '../../../../../../math/src/wgsl/decl.ts'
import { transformHalfExtent } from '../../../../../../math/src/wgsl/geometry.ts'
import { BOX3 } from '../../../../visibility/tessellation/patchWgsl.ts'
import { TESS_VIEW } from '../../../../visibility/tessellation/viewWgsl.ts'
import { VSM_CONSTANTS_WGSL } from '../constants.ts'
import { VSM_BOX_VIEW_WGSL, VSM_VIEW_LENS_WGSL } from '../invalidation/boxCullWgsl.ts'
import { VSM_PROJECTION_RECORD_WGSL, vsmShiftedToClip } from '../projection/projectionDataWgsl.ts'
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
 * scale over the map's mip, in pixels, over the cut's threshold (`tu.edgesPerPixel`), times the
 * shadow maps' level-of-detail scale (`tu.lodScale`, from `shadowLodScale`), which also scales the
 * fade distance. An orthographic view (a sun's) has no depth to scale by.
 *
 * `vsmTessRecordOf`: what every kernel that judges or draws a patch starts from, for the record
 * that names it (`VsmTessRecord`): its page, the page's displacement record, its map view's
 * projection record and the view (`vsmTessView`, at the record's mip); where the program wires a
 * world position offset, it also sets the level the offset is judged by (`wpoThreshold`) from that
 * projection. The program declares `pages` and the page geometry, `displacementOf` and the maps'
 * projections (`vsmProjectionData`).
 *
 * `vsmPatchRecordOf`: what a record gives every patch of its surface, worked out once for it (`VsmPatchRecord`).
 * `vsmPatchBox` and `vsmTessOnWindow`: a patch's box — in a row's local space, `world` its placement — in
 * the map's view by the render cull's own test of a caster's box (`vsmBoxInView`), and whether it reaches the
 * window the record draws: its pixels at the record's mip against the window's. A patch past the map's
 * frustum, or off the window, is gone. The program declares `tu`.
 */
export const VSM_TESS_VIEW_WGSL = wgslBlock(
  'VSM_TESS_VIEW_WGSL',
  [
    TESS_VIEW,
    BOX3,
    VSM_CONSTANTS_WGSL,
    VSM_PROJECTION_RECORD_WGSL,
    vsmShiftedToClip,
    VSM_BOX_VIEW_WGSL,
    VSM_VIEW_LENS_WGSL,
    transformHalfExtent,
    VSM_RENDER_RECORD_WGSL,
  ],
  `/** The view of a map whose record is \`raw\` and whose lens at the mip drawn is \`lens\` (\`vsmViewLens\`); the dicing,
 *  which holds the lens apart (\`WINDOW_VIEW_WORDS\`), reads it so. */
fn vsmTessViewWith(raw:VsmProjectionRecord,lens:VsmViewLens)->TessView{
 let shift=raw.originShiftHigh+raw.originShiftLow;
 var clip=raw.shiftedToMapUv;
 clip[3]=raw.shiftedToMapUv*vec4f(shift,1.0);
 return TessView(clip,vec3f(clip[0].w,clip[1].w,clip[2].w),-shift,lens.near,lens.focal*tu.edgesPerPixel*tu.lodScale,lens.perspective);
}
fn vsmTessView(raw:VsmProjectionRecord,mip:u32)->TessView{return vsmTessViewWith(raw,vsmViewLens(raw.lightViewToClip,mip));}
// What a record gives every patch of its surface, worked out once for the record: the map's matrices and shift, whether it cuts at a near plane, and the
// record's window of pages at its mip, as a rect of the map's pixels.
struct VsmPatchRecord{viewToClip:mat4x4f,toClip:mat4x4f,shift:vec3f,ortho:bool,nearClip:bool,level:i32,first:vec2i,last:vec2i,}
fn vsmPatchRecordOf(raw:VsmProjectionRecord,record:vec4u)->VsmPatchRecord{
 let level=i32(VSM_LEVEL0_TEXELS>>vsmRecordMip(record));
 let first=vec2i(vsmRecordFirstPage(record))*i32(VSM_PAGE_TEXELS);
 let last=(vec2i(vsmRecordLastPage(record))+vec2i(1))*i32(VSM_PAGE_TEXELS)-vec2i(1);
 return VsmPatchRecord(raw.lightViewToClip,vsmShiftedToClip(raw.shiftedToMapUv),raw.originShiftHigh+raw.originShiftLow,raw.lightViewToClip[3][3]>=1.0,!vsmRecordNoNearClip(record),level,first,last);
}
// A patch's box in a map's view: the box in the map's clip space by the render cull's own test of a caster's box, and
// its centre and half extents in the map's shifted space, which the occlusion test projects again under the previous view.
struct VsmPatchBox{cull:VsmBoxInView,center:vec3f,extent:vec3f,}
fn vsmPatchBox(box:Box3,world:mat4x4f,rec:VsmPatchRecord)->VsmPatchBox{
 let extent=transformHalfExtent(world,0.5*(box.hi-box.lo));
 let center=(world*vec4f(0.5*(box.lo+box.hi),1.0)).xyz+rec.shift;
 let point=vsmBoxCullPoint(center,extent,rec.ortho,rec.nearClip);
 return VsmPatchBox(vsmBoxInView(rec.toClip*vec4f(point,1.0),rec.toClip[0],rec.toClip[1],rec.toClip[2],extent,rec.viewToClip,rec.ortho,rec.nearClip),center,extent);
}
fn vsmTessOnWindow(placed:VsmPatchBox,rec:VsmPatchRecord)->bool{
 if(!placed.cull.inMapView){return false;}
 let pixels=vsmRectPixels(vec4i(0,0,rec.level,rec.level),placed.cull);
 return all(pixels.xy<=rec.last)&&all(pixels.zw>=rec.first);
}
`,
)

/** The start of a kernel that judges or draws a patch (`vsmTessRecordOf`), for a program that wires
 *  a world position offset (`wpo`) or not. */
export const vsmTessRecordWgsl = wgslVariants((wpo: boolean) =>
  wgslBlock(
    wpo ? 'VSM_TESS_RECORD_WPO_WGSL' : 'VSM_TESS_RECORD_WGSL',
    [VSM_TESS_VIEW_WGSL],
    `struct VsmTessRecord{page:PageInfo,rec:DisplacementRecord,raw:VsmProjectionRecord,view:TessView,}
fn vsmTessRecordOf(record:vec4u)->VsmTessRecord{
 let page=pages[record.x];
 let raw=vsmProjectionData[vsmRecordMap(record)];
${wpo ? ' wpoThreshold=raw.wpoThreshold;\n' : ''} return VsmTessRecord(page,displacementOf(page),raw,vsmTessView(raw,vsmRecordMip(record)));
}`,
  ),
)
