import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { bitIsSet, byteOf } from '../../../../../../math/src/wgsl/integer.ts'
import { transformHalfExtent } from '../../../../../../math/src/wgsl/geometry.ts'
import { BOX3 } from '../../../../visibility/tessellation/patchWgsl.ts'
import { TESS_VIEW } from '../../../../visibility/tessellation/viewWgsl.ts'
import { VSM_CONSTANTS_WGSL } from '../constants.ts'
import { VSM_BOX_VIEW_WGSL } from '../invalidation/boxCullWgsl.ts'
import { VSM_PROJECTION_DATA_WGSL } from '../projection/projectionDataWgsl.ts'

/**
 * THE VIEW OF A SHADOW MAP PAGE, for the patches of a displaced surface (`TessView`): a pair of a
 * chunk (`vsmRenderExpand`) names the map view that draws it — its record, `raw`, and its mip — and
 * the page of that mip it draws.
 *
 * `vsmTessView`: the matrix taking the world to the map's clip space, its translation folded in; the
 * direction depth is measured along (the weight row of the matrix: a perspective view's weight is its
 * depth) and the point it is zero at, the light; the near plane, taken from the projection's depth
 * terms; and the pixels a unit subtends at depth one per pixel an edge may span — the projection's
 * scale over the map's mip, in pixels, over the cut's threshold (`tu.edgesPerPixel`). An
 * orthographic view (a sun's) has no depth to scale by.
 *
 * `vsmTessOnPage`: whether a patch's box — in a row's local space, `world` its placement — reaches
 * the page the pair draws: the box in the map's clip space by the render cull's own test of a
 * caster's box (`vsmBoxInView`), its pixels at the pair's mip against the page's 128. A patch past
 * the map's frustum, or off the page, is gone. The program declares `tu` and the pair's words.
 */
export const VSM_TESS_VIEW_WGSL = wgslBlock(
  'VSM_TESS_VIEW_WGSL',
  [
    TESS_VIEW,
    BOX3,
    VSM_CONSTANTS_WGSL,
    VSM_PROJECTION_DATA_WGSL,
    VSM_BOX_VIEW_WGSL,
    transformHalfExtent,
    bitIsSet,
    byteOf,
  ],
  `fn vsmTessView(raw:VsmProjectionRecord,mip:u32)->TessView{
 let shift=raw.originShiftHigh+raw.originShiftLow;
 var clip=raw.shiftedToMapUv;
 clip[3]=raw.shiftedToMapUv*vec4f(shift,1.0);
 let m=raw.lightViewToClip;
 let perspective=m[3][3]<1.0;
 let near=m[3][2]/(1.0-m[2][2]);
 let pixels=f32(VSM_LEVEL0_TEXELS>>mip);
 return TessView(clip,vec3f(clip[0].w,clip[1].w,clip[2].w),-shift,select(0.0,near,perspective),0.5*abs(m[1][1])*pixels*tu.edgesPerPixel,perspective);
}
fn vsmTessOnPage(box:Box3,world:mat4x4f,raw:VsmProjectionRecord,pair:vec4u)->bool{
 let ortho=raw.lightViewToClip[3][3]>=1.0;
 let nearClip=!bitIsSet(pair.y,20u);
 let extent=transformHalfExtent(world,0.5*(box.hi-box.lo));
 let center=(world*vec4f(0.5*(box.lo+box.hi),1.0)).xyz+(raw.originShiftHigh+raw.originShiftLow);
 let toClip=vsmShiftedToClip(raw.shiftedToMapUv);
 let point=vsmBoxCullPoint(center,extent,ortho,nearClip);
 let cull=vsmBoxInView(toClip*vec4f(point,1.0),toClip[0],toClip[1],toClip[2],extent,raw.lightViewToClip,ortho,nearClip);
 if(!cull.inMapView){return false;}
 let level=i32(VSM_LEVEL0_TEXELS>>((pair.y>>16u)&7u));
 let pixels=vsmRectPixels(vec4i(0,0,level,level),cull);
 let first=vec2i(i32(byteOf(pair.z,0u)),i32(byteOf(pair.z,1u)))*i32(VSM_PAGE_TEXELS);
 let last=first+vec2i(i32(VSM_PAGE_TEXELS)-1);
 return all(pixels.xy<=last)&&all(pixels.zw>=first);
}`,
)
