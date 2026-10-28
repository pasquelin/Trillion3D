import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../../gpu/dispatch/grid.ts'
import { VIS_BINDINGS } from '../../../../gpu/bind/bindLayout.ts'
import {
  SHADOW_TILE_POOL_WGSL,
  colorSampleWgsl,
  dataSampleWgsl,
  maskAlphaWgsl,
  materialDeclarations,
  tileDeclarations,
} from '../../../../materials/virtual/wgsl.ts'
import { NO_MASKS, type MaskSet } from '../../../../materials/graph/maskProgram.ts'
import { NO_WPO, type WpoSet } from '../../../../materials/graph/wpoProgram.ts'
import { materialTableWgsl } from '../../../../materials/table/materialWgsl.ts'
import { TRIANGLE_RASTERS_TEXT } from '../../../../visibility/raster/clusterWgsl.ts'
import { RASTER_TRI_WGSL } from '../../../../visibility/raster/triWgsl.ts'
import {
  PAGE_GEOMETRY_WGSL,
  PAGE_NORMAL_WGSL,
} from '../../../../visibility/shader/pageGeometryWgsl.ts'
import { PAGE_UV_OR_FIRST_WGSL, maskUvWgsl } from '../../../../visibility/shader/pageUvSetWgsl.ts'
import {
  PAGE_BINDING,
  PAGE_INFO_WGSL,
  maskKeepWgsl,
} from '../../../../visibility/shader/pageWgsl.ts'
import { wpoGraphWgsl } from '../../../../visibility/shader/wpoGraphWgsl.ts'
import { TESS_BINDINGS as B } from '../../../../visibility/tessellation/bindings.ts'
import {
  DISPATCH_DICE,
  DISPATCH_DICE_STATIC,
  NEAR_CUT,
  NEAR_KEEP,
  PATCH_WORDS,
  WINDOW_LENS_AT,
  WINDOW_POOL_AT,
  WINDOW_VIEW_AT,
  WINDOW_WORDS,
} from '../../../../visibility/tessellation/contract.ts'
import { diceKernelText, type DiceTarget } from '../../../../visibility/tessellation/diceWgsl.ts'
import {
  DICE_CUTOUT_WGSL,
  DICE_PATCH_WGSL,
} from '../../../../visibility/tessellation/diceSetupWgsl.ts'
import { pointDisplacement } from '../../../../visibility/tessellation/domainWgsl.ts'
import { PATTERN_PLAIN_WGSL } from '../../../../visibility/tessellation/patchWgsl.ts'
import {
  TESS_LISTS_WGSL,
  TESS_READ_PLAIN_WGSL,
} from '../../../../visibility/tessellation/queueWgsl.ts'
import { visTriangle } from '../../../../visibility/visWords.ts'
import { VSM_CONSTANTS_WGSL } from '../constants.ts'
import type { VsmLayout } from '../layout.ts'
import { VSM_CASTER_PROJECTION_WGSL } from '../render/renderCasterWgsl.ts'
import { VSM_RENDER_RECORD_WGSL, VSM_VIEW_WORDS_WGSL } from '../render/renderParamsWgsl.ts'
import { VSM_RENDER_DEPTH_WGSL, VSM_RENDER_NO_PAGE_WGSL } from '../render/renderRasterWgsl.ts'
import {
  VSM_SOFTWARE_PLACE_WGSL,
  VSM_SOFTWARE_WINDOW_FRAME,
  vsmSoftwarePixelText,
} from '../render/windowRasterWgsl.ts'
import { vsmBindingsWgsl, type VsmBindingSpec } from '../resources.ts'
import { VSM_TESS_VIEW_WGSL } from './shadowViewWgsl.ts'

/** Group 2 of the dicing's stages: the pool's slice the entry writes (atomic; the layer's, which the group names)
 *  and the maps' uniforms. */
export const VSM_TESS_DICE_POOL_BINDING = 0
export const VSM_TESS_DICE_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'pagePool', binding: VSM_TESS_DICE_POOL_BINDING, slices: 1, access: 'atomic' },
  { resource: 'uniforms', binding: 1 },
]
/** The group the dicing binds the `tess` buffer and the data atlas in, and the one it binds the pool in. */
export const VSM_TESS_DICE_TESS_GROUP = 1
export const VSM_TESS_DICE_POOL_GROUP = 2

/** The dicing's layers, in the order of the pool's slices and of the lists of visible patches (`VISIBLE_LISTS`): the entry point that dices the layer's
 *  patches and the word of the chain's dispatches that launches it. */
export const DICE_LAYERS = [
  { entry: 'vsmTessDice0', dispatchWord: DISPATCH_DICE },
  { entry: 'vsmTessDice1', dispatchWord: DISPATCH_DICE_STATIC },
] as const

/** The vectors of a window's view, as `vsmUnpackView` takes them. */
const windowView = Array.from(
  { length: 6 },
  (_, k) => `tw4(windowAt+${WINDOW_VIEW_AT + 4 * k}u)`,
).join(',')

/** The shadow maps' target of the dicing (`DiceTarget`). The patches of a layer lie in a list of its own (the dynamic
 *  layer's from the start of the visible list, the static layer's from its end: `listVisible`). A patch names its record's window in the
 *  `tess` buffer, from which the group takes the record, the map's view and the pool origin of each page, once for as long as
 *  the patches it takes name the same window; a vertex is placed on the record's window as a caster's corner is
 *  (`vsmSoftwarePlace`), a micro-triangle rastered by the casters' box walk (`rasterRect`) into the pool by their pixel
 *  write (`writePixel`). The winding of a face is the record's swapped bit; a map with no near clip keeps what lies before its near plane. */
const shadowTarget = (wpo: boolean): DiceTarget => ({
  functions: `var<private> diceSeen:u32=0xFFFFFFFFu;
var<private> diceRecord:vec4u;
var<private> diceView:TessView;
fn diceCount(mode:u32)->u32{return min(tw(tu.args+listCounter(mode)),tu.maxVisible);}
fn dicePatchWord(mode:u32,i:u32)->u32{return tu.visible+listSlot(mode,i)*${PATCH_WORDS}u;}
fn diceOpen(piece:vec4u,lane:u32,mode:u32)->DiceItem{
 let window=piece.x>>8u;
 if(window!=diceSeen){
  diceSeen=window;
  let windowAt=tu.windowsAt+window*${WINDOW_WORDS}u;
  diceRecord=tw4(windowAt);
  if(lane==0u){swGroup=diceRecord;}
  for(var slot=lane;slot<SW_SLOTS;slot+=WORKGROUP_THREADS){
   var origin=VSM_RENDER_NO_PAGE;
   if(vsmRenderWindowHas(diceRecord,slot)){origin=tw(windowAt+${WINDOW_POOL_AT}u+slot);}
   swPool[slot]=origin;
  }
  swRaw=vsmUnpackView(array<vec4u,VSM_RENDER_SOFTWARE_VIEW_RECORDS>(${windowView}));${
    wpo ? '\n  wpoThreshold=swRaw.wpoThreshold;' : ''
  }
  let lens=tw4(windowAt+${WINDOW_LENS_AT}u);
  diceView=vsmTessViewWith(swRaw,VsmViewLens(bitcast<f32>(lens.x),bitcast<f32>(lens.y),lens.z!=0u));
 }
 return DiceItem(diceRecord.x,diceView,select(1.0,-1.0,vsmRecordSwapped(diceRecord)),select(${NEAR_CUT}u,${NEAR_KEEP}u,vsmRecordNoNearClip(diceRecord)));
}
fn diceSides(page:PageInfo)->PageInfo{return vsmSoftwareSides(page);}
fn diceClip(item:DiceItem,at:DiceVertex,d:DicePatch,rec:DisplacementRecord)->vec4f{
 return vsmSoftwarePlace(at.point.world+at.point.normal*pointDisplacement(at.point,at.height,rec.scale,d.fade,true));
}
fn diceDraw(micro:Tri,mode:u32){rasterRect(micro,mode);}`,
  cuts: true,
  entries: DICE_LAYERS.map(
    ({ entry }, layer) =>
      `@compute @workgroup_size(WORKGROUP_THREADS) fn ${entry}(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) l:u32,@builtin(num_workgroups) n:vec3u){diceGroup(g,l,n,${layer}u);}`,
  ).join('\n'),
})

/**
 * THE SHADOW MAPS' SOFTWARE RASTER OF THE PATCHES, one compute kernel as the image's dicing is
 * (`../../../../visibility/tessellation/diceWgsl.ts`, whose group it shares: `diceKernelText`): a group takes
 * `patchesPerGroup` visible patches of the chain's list one after another (`vsmTessSplit` listed them), dices
 * each into the group's memory — a vertex a thread, its barycentric point of the source triangle (`diceVertex`),
 * pushed along its normal by the displacement (`pointDisplacement`) and placed on its record's window of pages
 * (`vsmSoftwarePlace`, the casters' own) — then rasters its micro-triangles a thread each: the setup of
 * the camera's raster (`setupSubpixel`, its subpixel grid and fill rule), the casters' box walk and pixel write
 * (`rasterRect`, `writePixel`: the pixel's page through the group's table of origins, its depth joined to the
 * pool's slice by `atomicMax`). No displaced surface is given the hardware path.
 *
 * A masked row is cut at the vertices of its micro-triangles (`dicedKept`), never at the pixels, as the image's
 * dicing cuts it. A micro-triangle crossing the map's near plane is cut by it (`diceNear`), the part in front kept, unless the map has no
 * near clip (a directional one's levels), where what lies before the plane is kept whole. The two layers' patches lie in two lists
 * and have an entry point each (`DICE_LAYERS`), each binding the one slice of the pool it writes, as the casters'
 * software raster does where the device has no storage buffer for both.
 *
 * Group 0 the shadow page group's compute twin (`../../casters/pageGroup.ts`: the page rows' five storage buffers),
 * 1 the tessellation's (`TESS_PROGRAMS.shadowDice`: its uniform, `tess` and the data atlas's page table), 2
 * the pool's slice and the maps' uniforms (`VSM_TESS_DICE_SPECS`): the eight storage buffers every device holds, the
 * records, the maps' projections and the page table being read from the windows (`WINDOW_WORDS`).
 */
export const vsmTessDiceWgsl = (
  layout: VsmLayout,
  masks: MaskSet = NO_MASKS,
  wpo: WpoSet = NO_WPO,
) =>
  wgslProgram(
    /* wgsl */ `${PAGE_BINDING.indices}
${PAGE_BINDING.positions}
${PAGE_BINDING.pages}
${materialDeclarations()}
@group(${VSM_TESS_DICE_TESS_GROUP}) @binding(${B.tessUniform}) var<uniform> tu:TessUni;
@group(${VSM_TESS_DICE_TESS_GROUP}) @binding(${B.tess}) var<storage,read> tess:array<u32>;
${tileDeclarations(B.data, 'data', VSM_TESS_DICE_TESS_GROUP)}
${TRIANGLE_RASTERS_TEXT}
${vsmSoftwarePixelText(false)}
fn pixelKeeps(t:Tri,pixel:vec2i,c:vec3f,texel:vec2u,slice:u32,depth:u32)->bool{return true;}
${diceKernelText(shadowTarget(wpo.programs.length > 0))}
`,
    [
      VSM_SOFTWARE_WINDOW_FRAME,
      RASTER_TRI_WGSL,
      PAGE_INFO_WGSL,
      PAGE_GEOMETRY_WGSL,
      PAGE_NORMAL_WGSL,
      maskUvWgsl(VIS_BINDINGS.normals),
      PAGE_UV_OR_FIRST_WGSL,
      VSM_CASTER_PROJECTION_WGSL,
      VSM_SOFTWARE_PLACE_WGSL,
      VSM_RENDER_DEPTH_WGSL,
      VSM_RENDER_NO_PAGE_WGSL,
      VSM_RENDER_RECORD_WGSL,
      VSM_VIEW_WORDS_WGSL,
      VSM_TESS_VIEW_WGSL,
      VSM_CONSTANTS_WGSL,
      SHADOW_TILE_POOL_WGSL,
      dataSampleWgsl(SHADOW_TILE_POOL_WGSL),
      colorSampleWgsl(SHADOW_TILE_POOL_WGSL),
      maskKeepWgsl(maskAlphaWgsl(true, SHADOW_TILE_POOL_WGSL), masks, true),
      vsmBindingsWgsl(VSM_TESS_DICE_POOL_GROUP, VSM_TESS_DICE_SPECS, layout),
      TESS_READ_PLAIN_WGSL,
      TESS_LISTS_WGSL,
      PATTERN_PLAIN_WGSL,
      DICE_PATCH_WGSL,
      DICE_CUTOUT_WGSL,
      pointDisplacement,
      visTriangle,
      FLAT_INDEX_WGSL,
      WORKGROUP_THREADS_WGSL,
      ...(wpo.programs.length ? [materialTableWgsl(wpo.table), wpoGraphWgsl(wpo)] : []),
    ],
  )
