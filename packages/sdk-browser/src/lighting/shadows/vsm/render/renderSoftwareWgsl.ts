/**
 * THE SHADOW RASTER'S SOFTWARE HALF: the records of the clusters small enough in their map's mip view
 * (`vsmRenderSoftware`), rastered in compute by the engine's one
 * software raster (`../../../../visibility/raster/clusterWgsl.ts`, `clusterRasterKernels`): a group
 * of sixty-four threads a record, the cluster's corners transformed once into the group's memory,
 * a thread a triangle, the camera raster's setup (`setupSubpixel`, its subpixel grid and fill rule)
 * and its pixel walks, on the frame of its window (`rasterViewport`, `VSM_RENDER_WINDOW_PAGES_SOFTWARE`
 * pages a side) — as the reference's software raster draws a cluster's window of pages (its pixels
 * written by a 32-bit `InterlockedMax` into the physical pool, each through the page table entry
 * of its page, which the group keeps in its own memory).
 *
 * What differs from the camera's is the target's alone (`SHADOW_CLUSTER_TARGET`): the record names
 * the row, the map and its window of pages — the page table's index of the first, from which a lane
 * of the group reads each page's word into the group's memory as the pool origin of its page
 * (`vsmRenderPageOrigin`), as the reference's group keeps its page table cache —; a corner is
 * placed as the hardware raster's vertex places it (`vsmRenderWorld`, `vsmRenderShifted`,
 * `vsmRenderClip`) on the window (`vsmRenderWindowAt`), by the view of its map (`vsmSoftwareView`);
 * a face toward the light is the front one (the record's swapped bit turns the winding the setup
 * reads, `det`); a pixel joins the pool by `atomicMax` where its page is one to draw and a masked
 * row's cutout keeps it, as the hardware fragment does (`renderRasterWgsl.ts`), its dither at the
 * map's virtual pixel: the window's first texel plus the pixel's offset in the window, at its
 * centre; the cutout is evaluated only for a depth greater than the texel holds.
 *
 * The dynamic layer's records write the pool's slice 0, what every reader samples; the static layer's
 * the static slice, merged into slice 0 after the raster (`vsmMergePages`). The cull bins the two
 * layers apart (`VSM_RENDER_SOFTWARE_BIN`, `_STATIC_BIN`): a group launches a record, the dynamic
 * layer's first, and a static record exists only where the set keeps a static slice (a static layer
 * needs a cached map). Where the device grants nine storage buffers a stage (`merged`,
 * `vsmSoftwareMerged`) one entry point, `vsmRenderSoftware`, rasters both layers' records in one
 * dispatch, as the reference's software raster does, binding both pool slices, each record writing
 * the slice of its layer. Otherwise two entry points each bind the one slice they write:
 * `vsmRenderSoftware` the dynamic layer's records, `vsmRenderSoftwareStatic` the static layer's. The
 * stage holds the eight storage buffers every device has — the page rows' five, the sorted records,
 * the page table and the pool's slice, the two slices' nine with the second —; a device with one
 * more binds the projection data too (`native`) and reads the record of the map, one with none reads
 * the views of the maps the bin laid in the sorted list, after its counts
 * (`VSM_RENDER_SOFTWARE_VIEWS_WGSL`): the same words either way.
 *
 * Group 0: the shadow page group's compute twin (`../../casters/pageGroup.ts`). Group 1: 0 the sorted
 * records, the software records first, the dynamic layer's then the static layer's, their two counts
 * at the capacity's place and the views of the pass's maps after it where they are laid; 1 the page
 * table; 2 the pool slice (atomic; 2 and 3 the two slices where merged); 3 the uniforms (5 where
 * merged); 4 the parameters (uniform, dynamic); 5 the projection data where the device has a
 * ninth buffer (6 where merged).
 */
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { wgslFn } from '../../../../../../math/src/wgsl/decl.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../../gpu/dispatch/grid.ts'
import { VIS_BINDINGS } from '../../../../gpu/bind/bindLayout.ts'
import {
  clusterRasterKernels,
  type ClusterRasterTarget,
} from '../../../../visibility/raster/clusterWgsl.ts'
import { RASTER_TRI_WGSL } from '../../../../visibility/raster/triWgsl.ts'
import { PAGE_GEOMETRY_WGSL } from '../../../../visibility/shader/pageGeometryWgsl.ts'
import { maskUvWgsl } from '../../../../visibility/shader/pageUvSetWgsl.ts'
import {
  PAGE_BINDING,
  PAGE_INFO_WGSL,
  maskKeepWgsl,
} from '../../../../visibility/shader/pageWgsl.ts'
import { wpoGraphWgsl } from '../../../../visibility/shader/wpoGraphWgsl.ts'
import { FLAG_BACK, FLAG_MASK } from '../../../../visibility/types.ts'
import {
  colorSampleWgsl,
  maskAlphaWgsl,
  materialDeclarations,
  SHADOW_TILE_POOL_WGSL,
} from '../../../../materials/virtual/wgsl.ts'
import { NO_MASKS, maskKnowsPixel, type MaskSet } from '../../../../materials/graph/maskProgram.ts'
import { NO_WPO, type WpoSet } from '../../../../materials/graph/wpoProgram.ts'
import { VSM_CONSTANTS_WGSL, VSM_PAGE_TEXELS } from '../constants.ts'
import { VSM_PAGE_ADDRESS_WGSL } from '../pageTableWgsl.ts'
import { VSM_PROJECTION_RECORD_WGSL } from '../projection/projectionDataWgsl.ts'
import { type VsmBindingSpec, vsmBindingsWgsl } from '../resources.ts'
import type { VsmLayout } from '../layout.ts'
import { VSM_CASTER_PROJECTION_WGSL } from './renderCasterWgsl.ts'
import {
  VSM_RENDER_DEPTH_WGSL,
  VSM_RENDER_PAGE_ORIGIN_WGSL,
  VSM_RENDER_WINDOW_WGSL,
} from './renderRasterWgsl.ts'
import {
  VSM_RENDER_PARAMS_WGSL,
  VSM_RENDER_RECORD_WGSL,
  VSM_RENDER_SOFTWARE_VIEW_RECORDS,
  VSM_RENDER_SOFTWARE_VIEWS_WGSL,
  VSM_RENDER_WINDOW_PAGES_SOFTWARE,
} from './renderParamsWgsl.ts'

/** Group 1's VSM resources: the page table, the one pool slice the entry writes, the uniforms. */
export const VSM_RENDER_SOFTWARE_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'pageTable', binding: 1 },
  { resource: 'pagePool', binding: 2, slices: 1, access: 'atomic' },
  { resource: 'uniforms', binding: 3 },
]
/** And the projection data, where the device grants the ninth storage buffer (`vsmViewsLaid` false). */
export const VSM_RENDER_SOFTWARE_PROJECTION_SPEC: VsmBindingSpec = {
  resource: 'projectionData',
  binding: 5,
}
/** The stage's VSM resources where it binds both pool slices (`merged`, group 1's bindings 2 and 3, the
 *  uniforms and the projection data after the parameters'). */
const VSM_RENDER_SOFTWARE_MERGED_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'pageTable', binding: 1 },
  { resource: 'pagePool', binding: 2, access: 'atomic' },
  { resource: 'uniforms', binding: 5 },
]
const VSM_RENDER_SOFTWARE_MERGED_PROJECTION_SPEC: VsmBindingSpec = {
  resource: 'projectionData',
  binding: 6,
}
/** The stage's VSM resources on a device that does (`native`) or does not bind the projection data, and
 *  that does (`merged`) or does not bind both pool slices. */
export const vsmSoftwareSpecs = (native: boolean, merged = false): readonly VsmBindingSpec[] =>
  merged
    ? [
        ...VSM_RENDER_SOFTWARE_MERGED_SPECS,
        ...(native ? [VSM_RENDER_SOFTWARE_MERGED_PROJECTION_SPEC] : []),
      ]
    : native
      ? [...VSM_RENDER_SOFTWARE_SPECS, VSM_RENDER_SOFTWARE_PROJECTION_SPEC]
      : VSM_RENDER_SOFTWARE_SPECS
/** The entry points: the dynamic layer's records into slice 0, the static layer's into the static slice
 *  (both layers' by the first where `merged`). */
export const VSM_RENDER_SOFTWARE_ENTRY = 'vsmRenderSoftware'
export const VSM_RENDER_SOFTWARE_STATIC_ENTRY = 'vsmRenderSoftwareStatic'

/** The frame the setup rasters on: the window. */
const WINDOW_FRAME = wgslFn(
  'rasterViewport',
  [],
  `fn rasterViewport()->vec2f{return vec2f(${VSM_RENDER_WINDOW_PAGES_SOFTWARE * VSM_PAGE_TEXELS}.0);}`,
)

/** The shadow raster's target of the one cluster kernel (`ClusterRasterTarget`), `wpo` naming
 *  whether the module holds the offsets' graph (whose threshold the map sets). */
const shadowClusterTarget = (wpo: boolean, merged: boolean): ClusterRasterTarget => ({
  // The group's record of its layer (of either layer's, the dynamic layer's first, where merged), read once into the
  // group's memory by its first lane.
  item: merged
    ? `if(at<vsmSoftwareCount(0u)+vsmSoftwareCount(1u)){
   swGroup=vsmSoftwareRecords[at];
   groupRow=swGroup.x;
  }`
    : `if(at<vsmSoftwareCount(mode)){
   swGroup=vsmSoftwareRecords[vsmSoftwareAt(at,mode)];
   groupRow=swGroup.x;
  }`,
  // What each lane holds of the record: its map's view, and a lane of the group the pool origin of a
  // slot of the window's table, none past the record's pages.
  itemOwn: `swRaw=vsmSoftwareView(vsmRecordMap(swGroup));${
    wpo ? '\n wpoThreshold=swRaw.wpoThreshold;' : ''
  }
 let extent=vsmRecordLastPage(swGroup)-vsmRecordFirstPage(swGroup);
 for(var i=lane;i<SW_SLOTS;i+=WORKGROUP_THREADS){
  let local=vec2u(i%SW_SIDE,i/SW_SIDE);
  var origin=VSM_RENDER_NO_PAGE;
  if(all(local<=extent)){origin=vsmRenderPageOrigin(swGroup.w,local);}
  swPool[i]=origin;
 }`,
  frame: 'let det=select(1.0,-1.0,vsmRecordSwapped(swGroup));',
  clip: (v) => `vsmSoftwareClip(page,h,${v})`,
  setupPage: 'vsmSoftwareSides(page)',
  triangle: `if(t.ok!=0u&&masked){
    t.ua=vec3f(pageMaskUv(page,h,k.x),1.0);t.ub=vec3f(pageMaskUv(page,h,k.y),1.0);t.uc=vec3f(pageMaskUv(page,h,k.z),1.0);
   }`,
  entries: `@compute @workgroup_size(WORKGROUP_THREADS) fn ${VSM_RENDER_SOFTWARE_ENTRY}(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) n:vec3u){clusterGroup(g,lane,n,0u);}${
    merged
      ? ''
      : `
@compute @workgroup_size(WORKGROUP_THREADS) fn ${VSM_RENDER_SOFTWARE_STATIC_ENTRY}(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) n:vec3u){clusterGroup(g,lane,n,1u);}`
  }`,
})

/** The slots of the group's table of page origins: the window's pages, `SW_SIDE` a side. */
const SW_SIDE = VSM_RENDER_WINDOW_PAGES_SOFTWARE

/** The view of map \`map\` the corners are placed by, as the fields of its projection record that
 *  \`vsmRenderShifted\` and \`vsmRenderClip\` read: the record itself where the stage binds the projection
 *  data (\`native\`), else the view the bin laid in the sorted list (\`vsmSoftwareViewAt\`). */
const softwareViewText = (native: boolean) =>
  native
    ? 'fn vsmSoftwareView(map:u32)->VsmProjectionRecord{return vsmProjectionData[map];}'
    : `fn vsmSoftwareView(map:u32)->VsmProjectionRecord{
 let at=vsmSoftwareViewAt(map);
 var view:array<vec4u,${VSM_RENDER_SOFTWARE_VIEW_RECORDS}>;
 for(var k=0u;k<VSM_RENDER_SOFTWARE_VIEW_RECORDS;k++){view[k]=vsmSoftwareRecords[at+k];}
 return vsmUnpackView(view);
}`

const softwareDeclarations = (native: boolean) => /* wgsl */ `${PAGE_BINDING.indices}
${PAGE_BINDING.positions}
${PAGE_BINDING.pages}
${materialDeclarations()}
@group(1) @binding(0) var<storage,read> vsmSoftwareRecords:array<vec4u>;
@group(1) @binding(4) var<uniform> params:VsmRenderParams;
const SW_SIDE:u32=${SW_SIDE}u;
const SW_SLOTS:u32=${SW_SIDE * SW_SIDE}u;
/** The records of a layer (\`mode\`: 0 the dynamic layer's, 1 the static layer's): their count, and
 *  the place of the layer's record \`at\` among the sorted ones, the static layer's after the dynamic. */
fn vsmSoftwareCount(mode:u32)->u32{return vsmSoftwareRecords[params.recordCapacity][mode];}
fn vsmSoftwareAt(at:u32,mode:u32)->u32{return select(0u,vsmSoftwareRecords[params.recordCapacity].x,mode==1u)+at;}
/** The record the group rasters (read by its first lane), its map's view for each lane, and the pool
 *  origin of each page of the window, \`SW_SIDE\` a side — the page's physical address, x | y << 16 —
 *  or \`VSM_RENDER_NO_PAGE\` where it is not one to draw or past the record's rect: the group's page
 *  table cache. */
var<workgroup> swGroup:vec4u;
var<workgroup> swPool:array<u32,SW_SLOTS>;
var<private> swRaw:VsmProjectionRecord;
${softwareViewText(native)}
/** Corner \`v\`'s clip position on the record's page, as the hardware raster's vertex places it. */
fn vsmSoftwareClip(page:PageInfo,h:ClusterHeader,v:u32)->vec4f{
 let shifted=vsmRenderShifted(swRaw,vsmRenderWorld(page,h,v));
 return vsmRenderWindowAt(vsmRenderClip(swRaw,shifted),swGroup,${VSM_RENDER_WINDOW_PAGES_SOFTWARE}u);
}
/** The sides the setup reads of a row: its back-side flag left out, as the record's swapped bit
 *  holds it with the placement's mirroring (\`vsmRenderSwapped\`), a two-sided row's kept. */
fn vsmSoftwareSides(page:PageInfo)->PageInfo{var p=page;p.flags&=~${FLAG_BACK}u;return p;}`

const softwarePixelAndKernels = (
  masks: MaskSet,
  wpo: WpoSet,
  subgroups: boolean,
  merged: boolean,
) => /* wgsl */ `
/** A covered pixel of the record's window: on a page of it that is one to draw, kept by a masked row's
 *  cutout, its depth joins the texel of its layer's slice — the bound one, or where merged the dynamic or
 *  the static one by the record — by \`atomicMax\` (\`vsmRenderJoin\`'s rule). A masked row evaluates its
 *  cutout only for a depth that can win (\`vsmRenderBeats\`). */
fn writePixel(t:Tri,pixel:vec2i,c:vec3f,mode:u32){
 if(pixel.x>t.maxPixel.x||pixel.y>t.maxPixel.y){return;}
 let local=vec2u(pixel)>>vec2u(VSM_LOG2_PAGE);
 let origin=swPool[local.y*SW_SIDE+local.x];
 if(origin==VSM_RENDER_NO_PAGE){return;}
 let texel=vec2u(origin&0xFFFFu,origin>>16u)*VSM_PAGE_TEXELS+(vec2u(pixel)&vec2u(VSM_PAGE_TEXEL_MASK));
 let page=pages[t.row];
 let slice=${merged ? 'select(0u,vsm.staticSlice,vsmRecordStatic(swGroup)!=0u)' : '0u'};
 let depth=vsmRenderDepth(t.depth.x+t.depth.y*c.y+t.depth.z*c.z);
 if((page.flags&${FLAG_MASK}u)!=0u){
  if(!vsmRenderBeats(texel,slice,depth)){return;}
  let cut=triCutout(t,c);
  if(!${
    maskKnowsPixel(masks)
      ? `maskKeepAt(page,cut.at.xy,1.0,cut.ddx,cut.ddy,vec2f(vsmRecordFirstPage(swGroup)*${VSM_PAGE_TEXELS}u+vec2u(pixel))+vec2f(0.5))`
      : 'maskKeep(page,cut.at.xy,1.0,cut.ddx,cut.ddy)'
  }){return;}
 }
 vsmPoolAtomicMax(texel,slice,depth);
}
${clusterRasterKernels(subgroups, shadowClusterTarget(wpo.programs.length > 0, merged))}`

/** The software raster of the shadow maps (above), `subgroups` the device's subgroup operations
 *  (the lanes' vote between a triangle's box and its scanlines), `masks` and `wpo` the session's
 *  graphs, as the hardware raster's module holds them (`vsmRasterPipe`), `native` the stage binding the
 *  projection data (`VSM_RENDER_SOFTWARE_PROJECTION_SPEC`; else the views the bin laid are read), `merged`
 *  the stage binding both pool slices and rastering both layers' records in one entry point. */
export const vsmRenderSoftwareWgsl = (
  layout: VsmLayout,
  masks: MaskSet = NO_MASKS,
  wpo: WpoSet = NO_WPO,
  subgroups = false,
  native = false,
  merged = false,
) =>
  wgslProgram(
    /* wgsl */ `
${softwareDeclarations(native)}${softwarePixelAndKernels(masks, wpo, subgroups, merged)}
`,
    [
      WINDOW_FRAME,
      RASTER_TRI_WGSL,
      PAGE_INFO_WGSL,
      PAGE_GEOMETRY_WGSL,
      VSM_CASTER_PROJECTION_WGSL,
      VSM_RENDER_WINDOW_WGSL,
      VSM_RENDER_DEPTH_WGSL,
      VSM_RENDER_PAGE_ORIGIN_WGSL,
      VSM_RENDER_RECORD_WGSL,
      VSM_RENDER_PARAMS_WGSL,
      VSM_CONSTANTS_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      SHADOW_TILE_POOL_WGSL,
      colorSampleWgsl(SHADOW_TILE_POOL_WGSL),
      maskKeepWgsl(maskAlphaWgsl(true, SHADOW_TILE_POOL_WGSL), masks),
      maskUvWgsl(VIS_BINDINGS.normals),
      vsmBindingsWgsl(1, vsmSoftwareSpecs(native, merged), layout),
      ...(native ? [] : [VSM_PROJECTION_RECORD_WGSL, VSM_RENDER_SOFTWARE_VIEWS_WGSL]),
      FLAT_INDEX_WGSL,
      WORKGROUP_THREADS_WGSL,
      ...(wpo.programs.length ? [wpoGraphWgsl(wpo)] : []),
    ],
  )
