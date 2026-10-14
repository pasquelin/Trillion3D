import { FLOAT32_MAX } from '../../../math/src/wgsl/constants.ts'
import { WORKGROUP_THREADS_WGSL } from '../gpu/dispatch/grid.ts'
import { VSM_BOX_CULL_WGSL } from './boxCullWgsl.ts'
import { VSM_CONSTANTS_WGSL } from './constants.ts'
import { VSM_HANDLE_WGSL } from './pageTableWgsl.ts'
import { VSM_PROJECTION_DATA_READ_WGSL } from './projectionDataWgsl.ts'
import { type VsmBindingSpec, vsmBindingsWgsl } from './resources.ts'
import type { VsmLayout } from './layout.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { VSM_RENDER_PARAMS_WGSL } from './renderParamsWgsl.ts'
import { VSM_RENDER_OVERLAP_WGSL } from './renderOverlapWgsl.ts'

/**
 * Step 5, culling half: the per-page draw commands of the non-cluster raster, on the engine's
 * resident cluster rows — the cull kernel alone: the page overlap and page cache it reads live in
 * `renderOverlapWgsl.ts`, the box cull in `boxCullWgsl.ts`, the other kernels of the step in
 * `renderCandidatesWgsl.ts`, `renderExpandWgsl.ts` and `renderParamsWgsl.ts`.
 *
 * Caster source: every row of the visibility page table (resident clusters), at the MAIN VIEW's
 * level of detail, and culls the instances against each VSM
 * view, never against the camera frustum. The level test is the engine's cut rule
 * (`../page/cut/rule.ts`) on the row's world errors (`webgpu/shadow/rowLods.ts`, residency folded
 * in) projected by the camera, without any frustum term: an off-screen caster is kept at the level
 * the camera's distance wants.
 *
 * The step's kernels (one module each, see `renderPass.ts` for the order):
 * - `vsmRenderCandidates` (per row): the caster list. Drops rows that never cast
 *   (no corners, blended-caster rows, sprites — translucent / sprite proxies do not render into
 *   VSM depth —, and rows whose placement casts no shadow: `castShadow = false`, hidden or parked,
 *   `MOBILITY_SHADOWLESS`) — and rows the camera's cut does not select, and appends the rest with
 *   their world sphere (split double), corner count, cache-as-dynamic bit (engine mobility,
 *   `webgpu/shadow/mobility.ts`) and deforming bit (`vsmRenderCandidateFlags`).
 * - `vsmRenderCull` (per candidate × map view): the per-page draw commands:
 *   distance cull, static-layer test, small-caster test, frustum (the box frustum test with
 *   the dynamic depth cull range), then per mip: screen rect, fine caster, stale rect
 *   clip, overlap with any valid page (page-mark pyramid + receiver cover), and one command (row,
 *   mip view, static, page rect, flag mask, dirty flags).
 * - `vsmRenderExpand` (one workgroup per command) = the marking loop: it marks the pages dirty
 *   over the command's page rect into the raster marks, and does the raster's page selection: one
 *   (row, page) pair per page of the rect valid for rendering, the clip planes being the uncached
 *   rect.
 * - `vsmRenderArgs*`: indirect arguments of the next stage (one thread).
 *
 * Bounds: the engine keeps a world sphere per row (`webgpu/shadow/spheres.ts`), no local box;
 * the instance box is the sphere's axis-aligned box in shifted space (local to shifted
 * world = identity, extent = radius), and the instance radius (|local bounds extent · scale|) is
 * the sphere radius.
 */
/** Group 0 of `vsmRenderCull` (VSM resources of the current frame). */
export const VSM_RENDER_CULL_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'pageMarks', binding: 1 },
  { resource: 'receiverCover', binding: 2 },
  { resource: 'staleRects', binding: 3 },
  { resource: 'projectionData', binding: 4 },
]

/**
 * `vsmRenderCull`: group 0 = `VSM_RENDER_CULL_SPECS`; group 1: 0 params (uniform, dynamic),
 * 1 map views (vec4u: id, mip count, flags, pad), 2 candidates, 3 counters (rw atomic),
 * 4 commands (rw). Dispatch: x over the chunk's candidates (64 each), y = map view index.
 *
 * Command (vec4u): x row; y VSM id | mip << 16 | static << 19 | clamp-to-near << 20;
 * z page rect x0 | y0 << 7 | x1 << 14 | y1 << 21 (inclusive, pages of the mip);
 * w corners (16 bits) | mark mask << 16 | mark-page-dirty flags << 24.
 */
export const vsmRenderCullWgsl = (layout: VsmLayout, { marksDirty = true } = {}) =>
  wgslProgram(
    /* wgsl */ `
@group(1) @binding(0) var<uniform> params:VsmRenderParams;
@group(1) @binding(1) var<storage,read> views:array<vec4u>;
@group(1) @binding(2) var<storage,read> candidates:array<VsmRenderCandidate>;
@group(1) @binding(3) var<storage,read_write> counts:array<atomic<u32>>;
@group(1) @binding(4) var<storage,read_write> cmds:array<vec4u>;
@compute @workgroup_size(WORKGROUP_THREADS) fn vsmRenderCull(@builtin(workgroup_id) wid:vec3u,@builtin(local_invocation_index) lane:u32){
 let local=wid.x*WORKGROUP_THREADS+lane;
 let k=params.chunkFirst+local;
 if(local>=params.chunkRows||k>=atomicLoad(&counts[0])||wid.y>=params.viewCount){return;}
 let cand=candidates[k];
 let view=views[wid.y];
 let h=vsmHandleFromId(view.x);
 let pd=vsmProjectionOf(h);
 let directional=(view.z&VSM_RENDER_VIEW_DIRECTIONAL)!=0u;
 // Local views enable distance cull and near clip.
 let nearClip=!directional;
 let distanceCull=!directional;
 let viewToClip=pd.lightViewToClip;
 let isOrtho=viewToClip[3][3]>=1.0;
 let shiftedToClip=vsmShiftedToClip(pd.shiftedToMapUv);
 let center=(cand.c.xyz+pd.originShiftHigh)+(cand.l+pd.originShiftLow);
 let radius=cand.c.w;
 var visible=true;
 // Range-based culling distance = the light's radius.
 if(distanceCull){visible=dot(center,center)<=(pd.lightRange+radius)*(pd.lightRange+radius);}
 if(!visible){return;}
 // The static layer takes a caster that stands still (the engine's mobility) in a cached map; a
 // moving one draws into the dynamic layer: its mobility decides it, frame by frame.
 let staticLayer=!pd.uncached&&(cand.flags&VSM_RENDER_CAND_DYNAMIC)==0u;
 // The receiver cover and the mark mask depend on the cache state.
 let useCover=pd.useCover&&!staticLayer;
 let markMask=select(VSM_PAGE_DYNAMIC_STALE,VSM_PAGE_STATIC_STALE,staticLayer);
 // The small-caster cull on uncached maps, an
 // instance test: the whole object's radius, not the cluster's, so a small part of a large object
 // is never dropped alone. Its centre is not kept per row: the distance is the cluster's less the
 // object's radius, nearer than the object's centre can be — it never drops what the object's own test keeps.
 if(pd.uncached){
  let objectRadius=bitcast<f32>(cand.objectRadius);
  let d=(cand.c.xyz-params.eyeHigh)+(cand.l-params.eyeLow);
  if(objectRadius>0.0){
   let near=max(length(d)-objectRadius,0.0);
   if(objectRadius*objectRadius<params.smallCasterSq*near*near){return;}
  }else if(radius*radius<params.smallCasterSq*dot(d,d)){return;}
 }
 // Frustum cull; non-static geometry also within the depth range (0, the largest float).
 let extent=vec3f(radius);
 let boxPoint=vsmBoxCullPoint(center,extent,isOrtho,nearClip);
 let cull=vsmBoxInView(shiftedToClip*vec4f(boxPoint,1.0),shiftedToClip[0],shiftedToClip[1],shiftedToClip[2],extent,viewToClip,isOrtho,nearClip);
 visible=cull.inMapView;
 if(visible&&!staticLayer){
  visible=cull.clipHigh.z>0.0&&cull.clipLow.z<FLOAT32_MAX;
 }
 if(!visible){return;}
 var pixelRadius=vsmClipRadius(isOrtho,radius,center,viewToClip)*f32(VSM_LEVEL0_TEXELS);
 let deformsNow=(cand.flags&VSM_RENDER_CAND_DEFORMING)!=0u;
 ${marksDirty ? 'let dirtyFlags=vsmRasterMarkBits(staticLayer,deformsNow);' : 'let dirtyFlags=0u;'}
 let mips=min(view.y,VSM_MIPS);
 for(var mipLevel=0u;mipLevel<mips;mipLevel++){
  let levelTexels=i32(VSM_LEVEL0_TEXELS>>mipLevel);
  var pixels=vsmRectPixels(vec4i(0,0,levelTexels,levelTexels),cull);
  let fineCaster=vsmIsFineCaster(staticLayer,pixelRadius);
  pixelRadius*=0.5;
  pixels=vsmClipToStaleRect(pixels,h,mipLevel);
  if(!vsmTouchesMappedPixels(h,mipLevel,pixels,markMask,fineCaster,useCover)){continue;}
  let pagesRect=vec4u(pixels)>>vec4u(VSM_LOG2_PAGE);
  let slot=atomicAdd(&counts[vsmRenderChunkCounter(params.chunk,0u)],1u);
  if(slot>=params.cmdCapacity){continue;}
  cmds[slot]=vec4u(
   cand.row,
   view.x|(mipLevel<<16u)|select(0u,1u<<19u,staticLayer)|select(0u,1u<<20u,directional),
   pagesRect.x|(pagesRect.y<<7u)|(pagesRect.z<<14u)|(pagesRect.w<<21u),
   (cand.corners&0xFFFFu)|(markMask<<16u)|(dirtyFlags<<24u));
 }
}
`,
    [
      VSM_RENDER_OVERLAP_WGSL,
      VSM_CONSTANTS_WGSL,
      VSM_HANDLE_WGSL,
      vsmBindingsWgsl(0, VSM_RENDER_CULL_SPECS, layout),
      VSM_PROJECTION_DATA_READ_WGSL,
      VSM_RENDER_PARAMS_WGSL,
      VSM_BOX_CULL_WGSL,
      FLOAT32_MAX,
      WORKGROUP_THREADS_WGSL,
    ],
  )
