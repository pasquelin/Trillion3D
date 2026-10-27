/**
 * THE SHADOW RASTER'S SOFTWARE HALF: the records of the clusters small enough in their map's mip view
 * (`vsmRenderSoftware`), rastered in compute by the engine's one
 * software raster (`../../../../visibility/raster/clusterWgsl.ts`, `clusterRasterKernels`): a group
 * of sixty-four threads a record, the cluster's corners transformed once into the group's memory,
 * a thread a triangle, the camera raster's setup (`setupSubpixel`, its subpixel grid and fill rule)
 * and its pixel walks, on the frame of one page (`rasterViewport`) — as the reference's software
 * raster draws a cluster's page (a one-page window; its pixels written
 * by a 32-bit `InterlockedMax` into the physical pool).
 *
 * What differs from the camera's is the target's alone (`SHADOW_CLUSTER_TARGET`): the record names
 * the row, the map and its page — the page table word the bin put in its mask's place
 * (`renderBinWgsl.ts`) —; a corner is placed as the hardware raster's vertex places it
 * (`vsmRenderWorld`, `vsmRenderShifted`, `vsmRenderClip`) on the page's window
 * (`vsmRenderWindowAt`, one page a side); a face toward the light is the front one (the record's
 * swapped bit turns the winding the setup reads, `det`); a pixel joins the pool by `atomicMax`
 * where a masked row's cutout keeps it, as the hardware fragment does
 * (`renderRasterWgsl.ts`), its dither at the map's virtual pixel: the page's first texel plus the
 * pixel's offset in the page, at its centre; the cutout is evaluated only for a depth greater than
 * the texel holds.
 *
 * Two entry points: `vsmRenderSoftware` writes the dynamic layer's records into the pool's slice 0,
 * what every reader samples; `vsmRenderSoftwareStatic` writes the static layer's records into the
 * static slice, merged into slice 0 after the raster (`vsmMergePages`). The cull bins the two layers
 * apart (`VSM_RENDER_SOFTWARE_BIN`, `_STATIC_BIN`): a layer's dispatch launches a group a record of
 * its own, and a static record exists only where the set keeps a static slice (a static layer
 * needs a cached map). Each binds the one slice it writes: the stage holds eight storage buffers —
 * the page rows' five, the sorted records, the projection data and that slice —, so a static caster
 * is rastered once a slice.
 *
 * Group 0: the shadow page group's compute twin (`../../casters/pageGroup.ts`). Group 1: 0 the sorted
 * records, the software records first, the dynamic layer's then the static layer's, their two counts
 * at the capacity's place; 1 the projection data; 2 the pool slice (atomic); 3 the uniforms; 4 the
 * parameters (uniform, dynamic).
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
import { VSM_PROJECTION_DATA_WGSL } from '../projection/projectionDataWgsl.ts'
import { type VsmBindingSpec, vsmBindingsWgsl } from '../resources.ts'
import type { VsmLayout } from '../layout.ts'
import { VSM_CASTER_PROJECTION_WGSL } from './renderCasterWgsl.ts'
import { VSM_RENDER_DEPTH_WGSL, VSM_RENDER_WINDOW_WGSL } from './renderRasterWgsl.ts'
import { VSM_RENDER_PARAMS_WGSL, VSM_RENDER_RECORD_WGSL } from './renderParamsWgsl.ts'

/** Group 1's VSM resources: the projection data, the one pool slice the entry writes, the
 *  uniforms. */
export const VSM_RENDER_SOFTWARE_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'projectionData', binding: 1 },
  { resource: 'pagePool', binding: 2, slices: 1, access: 'atomic' },
  { resource: 'uniforms', binding: 3 },
]
/** The entry points: the dynamic layer's records into slice 0, the static layer's into the static slice. */
export const VSM_RENDER_SOFTWARE_ENTRY = 'vsmRenderSoftware'
export const VSM_RENDER_SOFTWARE_STATIC_ENTRY = 'vsmRenderSoftwareStatic'

/** The frame the setup rasters on: one page. */
const PAGE_FRAME = wgslFn(
  'rasterViewport',
  [],
  `fn rasterViewport()->vec2f{return vec2f(${VSM_PAGE_TEXELS}.0);}`,
)

/** The shadow raster's target of the one cluster kernel (`ClusterRasterTarget`), `wpo` naming
 *  whether the module holds the offsets' graph (whose threshold the map sets). */
const shadowClusterTarget = (wpo: boolean): ClusterRasterTarget => ({
  // The group's record of its layer, if its page is to be drawn.
  item: `if(at<vsmSoftwareCount(mode)&&vsmUnpackTableEntry(vsmSoftwareRecords[vsmSoftwareAt(at,mode)].w).thisLevelDrawable){
   groupRow=vsmSoftwareRecords[vsmSoftwareAt(at,mode)].x;
  }`,
  itemOwn: `swRecord=vsmSoftwareRecords[vsmSoftwareAt(at,mode)];
 swRaw=vsmProjectionData[vsmRecordMap(swRecord)];${
   wpo ? '\n wpoThreshold=swRaw.wpoThreshold;' : ''
 }`,
  frame: 'let det=select(1.0,-1.0,vsmRecordSwapped(swRecord));',
  clip: (v) => `vsmSoftwareClip(page,h,${v})`,
  setupPage: 'vsmSoftwareSides(page)',
  triangle: `if(t.ok!=0u&&masked){
    t.ua=vec3f(pageMaskUv(page,h,k.x),1.0);t.ub=vec3f(pageMaskUv(page,h,k.y),1.0);t.uc=vec3f(pageMaskUv(page,h,k.z),1.0);
   }`,
  entries: `@compute @workgroup_size(WORKGROUP_THREADS) fn ${VSM_RENDER_SOFTWARE_ENTRY}(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) n:vec3u){clusterGroup(g,lane,n,0u);}
@compute @workgroup_size(WORKGROUP_THREADS) fn ${VSM_RENDER_SOFTWARE_STATIC_ENTRY}(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) n:vec3u){clusterGroup(g,lane,n,1u);}`,
})

const softwareDeclarations = () => /* wgsl */ `${PAGE_BINDING.indices}
${PAGE_BINDING.positions}
${PAGE_BINDING.pages}
${materialDeclarations()}
@group(1) @binding(0) var<storage,read> vsmSoftwareRecords:array<vec4u>;
@group(1) @binding(4) var<uniform> params:VsmRenderParams;
/** The records of a layer (\`mode\`: 0 the dynamic layer's, 1 the static layer's): their count, and
 *  the place of the layer's record \`at\` among the sorted ones, the static layer's after the dynamic. */
fn vsmSoftwareCount(mode:u32)->u32{return vsmSoftwareRecords[params.recordCapacity][mode];}
fn vsmSoftwareAt(at:u32,mode:u32)->u32{return select(0u,vsmSoftwareRecords[params.recordCapacity].x,mode==1u)+at;}
/** The record a thread rasters and its map's record. */
var<private> swRecord:vec4u;
var<private> swRaw:VsmProjectionRecord;
/** Corner \`v\`'s clip position on the record's page, as the hardware raster's vertex places it. */
fn vsmSoftwareClip(page:PageInfo,h:ClusterHeader,v:u32)->vec4f{
 let shifted=vsmRenderShifted(swRaw,vsmRenderWorld(page,h,v));
 return vsmRenderWindowAt(vsmRenderClip(swRaw,shifted),swRecord,1u);
}
/** The sides the setup reads of a row: its back-side flag left out, as the record's swapped bit
 *  holds it with the placement's mirroring (\`vsmRenderSwapped\`), a two-sided row's kept. */
fn vsmSoftwareSides(page:PageInfo)->PageInfo{var p=page;p.flags&=~${FLAG_BACK}u;return p;}`

const softwarePixelAndKernels = (masks: MaskSet, wpo: WpoSet, subgroups: boolean) => /* wgsl */ `
/** A covered pixel of the record's page: kept by a masked row's cutout, its
 *  depth joins the bound slice's texel by \`atomicMax\` (\`vsmRenderJoin\`'s rule). A masked row
 *  evaluates its cutout only for a depth that can win (\`vsmRenderBeats\`). */
fn writePixel(t:Tri,pixel:vec2i,c:vec3f,mode:u32){
 if(pixel.x>t.maxPixel.x||pixel.y>t.maxPixel.y){return;}
 let texel=vsmUnpackTableEntry(swRecord.w).physicalAddress*VSM_PAGE_TEXELS+vec2u(pixel);
 let page=pages[t.row];
 let depth=vsmRenderDepth(t.depth.x+t.depth.y*c.y+t.depth.z*c.z);
 if((page.flags&${FLAG_MASK}u)!=0u){
  if(!vsmRenderBeats(texel,0u,depth)){return;}
  let cut=triCutout(t,c);
  if(!${
    maskKnowsPixel(masks)
      ? `maskKeepAt(page,cut.at.xy,1.0,cut.ddx,cut.ddy,vec2f(vsmRecordFirstPage(swRecord)*${VSM_PAGE_TEXELS}u+vec2u(pixel))+vec2f(0.5))`
      : 'maskKeep(page,cut.at.xy,1.0,cut.ddx,cut.ddy)'
  }){return;}
 }
 vsmPoolAtomicMax(texel,0u,depth);
}
${clusterRasterKernels(subgroups, shadowClusterTarget(wpo.programs.length > 0))}`

/** The software raster of the shadow maps (above), `subgroups` the device's subgroup operations
 *  (the lanes' vote between a triangle's box and its scanlines), `masks` and `wpo` the session's
 *  graphs, as the hardware raster's module holds them (`vsmRasterPipe`). */
export const vsmRenderSoftwareWgsl = (
  layout: VsmLayout,
  masks: MaskSet = NO_MASKS,
  wpo: WpoSet = NO_WPO,
  subgroups = false,
) =>
  wgslProgram(
    /* wgsl */ `
${softwareDeclarations()}${softwarePixelAndKernels(masks, wpo, subgroups)}
`,
    [
      PAGE_FRAME,
      RASTER_TRI_WGSL,
      PAGE_INFO_WGSL,
      PAGE_GEOMETRY_WGSL,
      VSM_CASTER_PROJECTION_WGSL,
      VSM_RENDER_WINDOW_WGSL,
      VSM_RENDER_DEPTH_WGSL,
      VSM_RENDER_RECORD_WGSL,
      VSM_RENDER_PARAMS_WGSL,
      VSM_CONSTANTS_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      SHADOW_TILE_POOL_WGSL,
      colorSampleWgsl(SHADOW_TILE_POOL_WGSL),
      maskKeepWgsl(maskAlphaWgsl(true, SHADOW_TILE_POOL_WGSL), masks),
      maskUvWgsl(VIS_BINDINGS.normals),
      vsmBindingsWgsl(1, VSM_RENDER_SOFTWARE_SPECS, layout),
      FLAT_INDEX_WGSL,
      WORKGROUP_THREADS_WGSL,
      ...(wpo.programs.length ? [wpoGraphWgsl(wpo)] : []),
    ],
  )
