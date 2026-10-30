import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { wgslBlock, wgslStruct } from '../../../../math/src/wgsl/decl.ts'
import { PLACEMENT_INFO } from '../../geometry/dag/info/placementInfoLayout.ts'
import {
  CUSTOM_DEPTH_MASK_SHIFT,
  CUSTOM_DEPTH_VALUE_MASK,
} from '../../../../sdk-core/src/contracts/customDepthAbi.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../shader/pageWgsl.ts'
import { visPageIndex, visRowIn } from '../visWords.ts'

/** The format of the custom stencil target: two unsigned 16-bit channels, the stencil value in the second (where a combined depth and stencil texture reads it). */
export const CUSTOM_STENCIL_FORMAT: GPUTextureFormat = 'rg16uint'

const PLACEMENT_STRUCT = wgslStruct('PlacementInfo', [], PLACEMENT_INFO.wgsl)

/** What the emission reads of a drawn row: the cluster a pixel shows and the stencil its object's word writes. */
const CUSTOM_DEPTH_READ = wgslBlock(
  'CUSTOM_DEPTH_READ',
  [PAGE_INFO_STRUCT_WGSL, PLACEMENT_STRUCT, visPageIndex, visRowIn],
  `${wgslConsts({ CUSTOM_DEPTH_MASK_SHIFT, CUSTOM_DEPTH_VALUE_MASK })}
const NO_ROW:u32=0xffffffffu;
@group(0) @binding(0) var ids:texture_2d<u32>;
@group(0) @binding(1) var drawn:texture_depth_2d;
@group(0) @binding(2) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(3) var<storage,read> placements:array<PlacementInfo>;
// The row of the cluster a pixel shows, none for the background.
fn rowAt(at:vec2i)->u32{
 let id=textureLoad(ids,at,0).r;
 return select(NO_ROW,visPageIndex(id),visRowIn(id,arrayLength(&pages)));
}
// The stencil an object's word writes: its value under its mask, the whole value for the default mask (zero). One surface a pixel, so no
// merge of the bits of a surface behind.
fn stencilOf(word:u32)->u32{
 var mask=(word>>CUSTOM_DEPTH_MASK_SHIFT)&CUSTOM_DEPTH_VALUE_MASK;
 if(mask==0u){mask=CUSTOM_DEPTH_VALUE_MASK;}
 return word&mask;
}`,
)

/**
 * The emission of the custom depth and stencil from the visibility of the view that drew only the objects asking for it
 * (`ViewOverrides.customDepthCapture`): a full-screen pass that writes the depth of each pixel that shows a cluster into the
 * custom depth target, the background keeping the cleared far, and, with a stencil target, the value its object's word writes
 * (`stencilOf`) into the second channel of the stencil target, zero for the background. `emitDepth` writes the depth alone,
 * `emitDepthStencil` both.
 */
export const CUSTOM_DEPTH_EMIT_WGSL = wgslProgram(
  `
struct DepthStencil{@location(0) stencil:vec4u,@builtin(frag_depth) depth:f32,}
@fragment fn emitDepth(@builtin(position) pixel:vec4f)->@builtin(frag_depth) f32{
 let at=vec2i(pixel.xy);
 if(rowAt(at)==NO_ROW){return 0.0;}
 return textureLoad(drawn,at,0);
}
@fragment fn emitDepthStencil(@builtin(position) pixel:vec4f)->DepthStencil{
 let at=vec2i(pixel.xy);
 let row=rowAt(at);
 if(row==NO_ROW){return DepthStencil(vec4u(0u),0.0);}
 let placement=pages[row].placement;
 var stencil=0u;
 if(placement<arrayLength(&placements)){stencil=stencilOf(placements[placement].customDepth);}
 return DepthStencil(vec4u(0u,stencil,0u,0u),textureLoad(drawn,at,0));
}`,
  [CUSTOM_DEPTH_READ, FULLSCREEN_VERTEX],
)
