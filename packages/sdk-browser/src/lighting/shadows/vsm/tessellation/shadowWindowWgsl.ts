import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../../gpu/dispatch/grid.ts'
import { TESS_DECLARATIONS as D } from '../../../../visibility/tessellation/bindings.ts'
import {
  ARG_WINDOWS,
  OCCLUSION_POST,
  WINDOW_LENS_AT,
  WINDOW_LENS_WORDS,
  WINDOW_PAGE_SLOTS,
  WINDOW_POOL_AT,
  WINDOW_VIEW_AT,
  WINDOW_WORDS,
} from '../../../../visibility/tessellation/contract.ts'
import { TESS_STATE_WGSL, TESS_WORD4_WGSL } from '../../../../visibility/tessellation/queueWgsl.ts'
import { VSM_VIEW_LENS_WGSL } from '../invalidation/boxCullWgsl.ts'
import { VSM_PROJECTION_DATA_WGSL } from '../projection/projectionDataWgsl.ts'
import { VSM_RENDER_RECORD_WGSL, VSM_VIEW_WORDS_WGSL } from '../render/renderParamsWgsl.ts'
import { VSM_RENDER_PAGE_ORIGIN_WGSL } from '../render/renderRasterWgsl.ts'
import { VSM_PAGE_ADDRESS_WGSL } from '../pageTableWgsl.ts'
import { VSM_CONSTANTS_WGSL } from '../constants.ts'
import { vsmBindingsWgsl, type VsmBindingSpec } from '../resources.ts'
import type { VsmLayout } from '../layout.ts'

/**
 * THE WINDOWS OF A CHAIN (`WINDOW_WORDS`), as the kernels count them: a chain opens a window for each
 * record the seeding takes (`vsmOpenWindow`, which writes the record's words); the post pass's windows
 * come after the main pass's (`vsmWindowBase`: the count its state says, at `mainArgs`, held to the
 * capacity), which stay for the patches the main pass hid; `vsmWindowCount` is how many this chain opened
 * that fit. Declared with the program's `tu` and its `tess`, written atomically.
 */
export const VSM_WINDOW_STATE_WGSL = wgslBlock(
  'VSM_WINDOW_STATE_WGSL',
  [TESS_STATE_WGSL, TESS_WORD4_WGSL],
  `const VSM_NO_WINDOW:u32=0xFFFFFFFFu;
fn vsmWindowBase()->u32{return select(0u,min(tw(tu.mainArgs+${ARG_WINDOWS}u),tu.maxWindows),tu.occlusion==${OCCLUSION_POST}u);}
fn vsmWindowCount()->u32{return min(tw(tu.args+${ARG_WINDOWS}u),tu.maxWindows-vsmWindowBase());}
fn vsmWindowAt(window:u32)->u32{return tu.windowsAt+window*${WINDOW_WORDS}u;}
fn vsmWindowRecord(window:u32)->vec4u{return tw4(vsmWindowAt(window));}`,
)

/** Group 1 of the kernel that fills the windows: the maps' projections, the page table and the uniforms
 *  the page table's address reads. */
export const VSM_WINDOW_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'projectionData', binding: 0 },
  { resource: 'pageTable', binding: 1 },
  { resource: 'uniforms', binding: 2 },
]

/**
 * THE WINDOWS' FILL, a group a window the chain opened (`vsmTessShadowArgs` sizes it) once the levels are
 * down: the record the seeding wrote names its map and its window of pages; the group lays in the window the
 * map's view (`vsmPackView`, a vector a lane) and the lens of the record's mip (`vsmViewLens`, the lane after them), then, a lane for each page
 * of the window, the pool address of the page (`vsmRenderPageOrigin`, the casters' own lookup through
 * the page table), `VSM_RENDER_NO_PAGE` where the page is not one to draw (the slots past the record's rect are left out). The dicing
 * (`shadowDiceWgsl.ts`) reads them there, binding neither the records nor the projections nor the page table.
 *
 * Group 0 the tessellation's (`TESS_PROGRAMS.shadowWindow`: its uniform and `tess`, never the dispatches it is launched from), 1 the maps'
 * (`VSM_WINDOW_SPECS`).
 */
const FILL = `@compute @workgroup_size(WORKGROUP_THREADS) fn vsmTessWindowFill(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) n:vec3u){
 let index=flatIndex(group,n,1u);
 if(index>=vsmWindowCount()){return;}
 let at=vsmWindowAt(vsmWindowBase()+index);
 let record=vsmWindowRecord(vsmWindowBase()+index);
 let raw=vsmProjectionData[vsmRecordMap(record)];
 var view=vsmPackView(raw);
 if(lane<VSM_RENDER_SOFTWARE_VIEW_RECORDS){
  let words=view[lane];
  for(var k=0u;k<4u;k++){atomicStore(&tess[at+${WINDOW_VIEW_AT}u+lane*4u+k],words[k]);}
 }
 if(lane==VSM_RENDER_SOFTWARE_VIEW_RECORDS){
  let lens=vsmViewLens(raw.lightViewToClip,vsmRecordMip(record));
  let words=vec4u(bitcast<u32>(lens.focal),bitcast<u32>(lens.near),select(0u,1u,lens.perspective),0u);
  for(var k=0u;k<${WINDOW_LENS_WORDS}u;k++){atomicStore(&tess[at+${WINDOW_LENS_AT}u+k],words[k]);}
 }
 // Only the slots in the record's rect are written: the dicing takes the others for none (\`vsmRenderWindowHas\`).
 for(var slot=lane;slot<${WINDOW_PAGE_SLOTS}u;slot+=WORKGROUP_THREADS){
  if(vsmRenderWindowHas(record,slot)){atomicStore(&tess[at+${WINDOW_POOL_AT}u+slot],vsmRenderWindowOrigin(record,slot));}
 }
}`

/** The fill's program: its entry point `vsmTessWindowFill`. */
export const vsmWindowFillSource = (layout: VsmLayout) =>
  wgslProgram(`${D.tessUniform}\n${D.tess}\n${FILL}`, [
    VSM_WINDOW_STATE_WGSL,
    VSM_RENDER_RECORD_WGSL,
    VSM_VIEW_WORDS_WGSL,
    VSM_VIEW_LENS_WGSL,
    VSM_PROJECTION_DATA_WGSL,
    VSM_CONSTANTS_WGSL,
    VSM_PAGE_ADDRESS_WGSL,
    VSM_RENDER_PAGE_ORIGIN_WGSL,
    vsmBindingsWgsl(1, VSM_WINDOW_SPECS, layout),
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
  ])
