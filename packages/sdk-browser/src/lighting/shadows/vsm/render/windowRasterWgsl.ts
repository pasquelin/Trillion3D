import { wgslBlock, wgslFn } from '../../../../../../math/src/wgsl/decl.ts'
import { PAGE_INFO_WGSL } from '../../../../visibility/shader/pageWgsl.ts'
import { FLAG_BACK } from '../../../../visibility/types.ts'
import { VSM_PAGE_TEXELS } from '../constants.ts'
import { VSM_PROJECTION_RECORD_WGSL } from '../projection/projectionDataWgsl.ts'
import { VSM_CASTER_PROJECTION_WGSL } from './renderCasterWgsl.ts'
import { VSM_RENDER_NO_PAGE_WGSL, VSM_RENDER_WINDOW_WGSL } from './renderRasterWgsl.ts'
import { VSM_RENDER_RECORD_WGSL, VSM_RENDER_WINDOW_PAGES_SOFTWARE } from './renderParamsWgsl.ts'

/**
 * THE WINDOW THE SOFTWARE RASTER DRAWS ON, shared by its two users: the casters' records
 * (`renderSoftwareWgsl.ts`) and the displaced surfaces' patches (`../tessellation/shadowDiceWgsl.ts`). It owns the group's
 * state — the record the group rasters (`swGroup`, read by its first lane), its map's view for each lane (`swRaw`) and the pool origin
 * of each page of the window (`swPool`, `SW_SIDE` pages a side; the page's physical address, x | y << 16, or `VSM_RENDER_NO_PAGE`
 * where it is not one to draw or past the record's rect: the group's page table cache) —, the frame the setup rasters on, a world
 * point's clip position on the record's window as the hardware raster's vertex places it (`vsmSoftwarePlace`), and the write of a
 * covered pixel (`vsmSoftwarePixelText`).
 */
export const VSM_SOFTWARE_WINDOW_FRAME = wgslFn(
  'rasterViewport',
  [],
  `fn rasterViewport()->vec2f{return vec2f(${VSM_RENDER_WINDOW_PAGES_SOFTWARE * VSM_PAGE_TEXELS}.0);}`,
)

/** The slots of the group's table of page origins: the window's pages, `SW_SIDE` a side. */
export const VSM_SOFTWARE_SLOTS =
  VSM_RENDER_WINDOW_PAGES_SOFTWARE * VSM_RENDER_WINDOW_PAGES_SOFTWARE

/** The group's state and the placing of a point on the window (see above). */
export const VSM_SOFTWARE_PLACE_WGSL = wgslBlock(
  'VSM_SOFTWARE_PLACE_WGSL',
  [
    PAGE_INFO_WGSL,
    VSM_CASTER_PROJECTION_WGSL,
    VSM_PROJECTION_RECORD_WGSL,
    VSM_RENDER_NO_PAGE_WGSL,
    VSM_RENDER_RECORD_WGSL,
    VSM_RENDER_WINDOW_WGSL,
  ],
  `const SW_SIDE:u32=${VSM_RENDER_WINDOW_PAGES_SOFTWARE}u;
const SW_SLOTS:u32=${VSM_SOFTWARE_SLOTS}u;
var<workgroup> swGroup:vec4u;
var<workgroup> swPool:array<u32,SW_SLOTS>;
var<private> swRaw:VsmProjectionRecord;
fn vsmSoftwarePlace(world:vec3f)->vec4f{
 let shifted=vsmRenderShifted(swRaw,world);
 return vsmRenderWindowAt(vsmRenderClip(swRaw,shifted),swGroup,${VSM_RENDER_WINDOW_PAGES_SOFTWARE}u);
}
/** The sides the setup reads of a row: its back-side flag left out, as the record's swapped bit
 *  holds it with the placement's mirroring (\`vsmRenderSwapped\`), a two-sided row's kept. */
fn vsmSoftwareSides(page:PageInfo)->PageInfo{var p=page;p.flags&=~${FLAG_BACK}u;return p;}`,
)

/**
 * A covered pixel of the record's window (`writePixel`, the one the setup's rasters call —
 * `../../../../visibility/raster/clusterWgsl.ts`): on a page of it that is one to draw, kept by the program's
 * `pixelKeeps(t, pixel, c, texel, slice, depth)` (the casters' masked rows are cut here; the patches' are cut at their vertices and keep
 * every pixel), its depth joins the texel of its layer's slice — the bound one, or where `merged` the dynamic or the static one
 * by the record — by `atomicMax` (`vsmRenderJoin`'s rule).
 */
export const vsmSoftwarePixelText = (merged: boolean) => /* wgsl */ `
fn writePixel(t:Tri,pixel:vec2i,c:vec3f,mode:u32){
 if(pixel.x>t.maxPixel.x||pixel.y>t.maxPixel.y){return;}
 let local=vec2u(pixel)>>vec2u(VSM_LOG2_PAGE);
 let origin=swPool[local.y*SW_SIDE+local.x];
 if(origin==VSM_RENDER_NO_PAGE){return;}
 let texel=vec2u(origin&0xFFFFu,origin>>16u)*VSM_PAGE_TEXELS+(vec2u(pixel)&vec2u(VSM_PAGE_TEXEL_MASK));
 let slice=${merged ? 'select(0u,vsm.staticSlice,vsmRecordStatic(swGroup)!=0u)' : '0u'};
 let depth=vsmRenderDepth(t.depth.x+t.depth.y*c.y+t.depth.z*c.z);
 if(!pixelKeeps(t,pixel,c,texel,slice,depth)){return;}
 vsmPoolAtomicMax(texel,slice,depth);
}
`
