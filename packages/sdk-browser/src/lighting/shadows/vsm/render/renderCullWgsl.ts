import { FLOAT32_MAX } from '../../../../../../math/src/wgsl/constants.ts'
import { WORKGROUP_THREADS_WGSL } from '../../../../gpu/dispatch/grid.ts'
import { VSM_BOX_CULL_WGSL } from '../invalidation/boxCullWgsl.ts'
import { VSM_CONSTANTS_WGSL } from '../constants.ts'
import { VSM_HANDLE_WGSL } from '../pageTableWgsl.ts'
import { VSM_PROJECTION_DATA_READ_WGSL } from '../projection/projectionDataWgsl.ts'
import { type VsmBindingSpec, vsmBindingsWgsl } from '../resources.ts'
import type { VsmLayout } from '../layout.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { VSM_RENDER_PARAMS_WGSL } from './renderParamsWgsl.ts'
import { VSM_RENDER_OVERLAP_WGSL } from './renderOverlapWgsl.ts'

/**
 * Step 5, culling half: the per-page draw commands of the non-cluster raster, on the engine's
 * resident cluster rows — the cull kernel alone: the page overlap and page cache it reads live in
 * `renderOverlapWgsl.ts`, the box cull in `../invalidation/boxCullWgsl.ts`, the other kernels of the step in
 * `renderCandidatesWgsl.ts`, `renderExpandWgsl.ts` and `renderParamsWgsl.ts`.
 *
 * Caster source: every row of the visibility page table (resident clusters), at the MAIN VIEW's
 * level of detail, and culls the instances against each VSM
 * view, never against the camera frustum. The level test is the engine's cut rule
 * (`../../../../geometry/cut/rule.ts`) on the row's world errors (`lighting/shadows/casters/rowLods.ts`, residency folded
 * in) projected by the camera, without any frustum term: an off-screen caster is kept at the level
 * the camera's distance wants.
 *
 * The step's kernels (one module each, see `renderPass.ts` for the order):
 * - `vsmRenderCandidates` (per row): the caster list. Drops rows that never cast
 *   (no corners, blended-caster rows, sprites — translucent / sprite proxies do not render into
 *   VSM depth —, and rows whose placement casts no shadow: `castShadow = false`, hidden or parked,
 *   `MOBILITY_SHADOWLESS`) — and rows the camera's cut does not select — its level of detail, and
 *   its world switch: an HLOD cell's actor or placements it does not draw (`worldDraws`) —, and
 *   appends the rest with their world sphere (split double), corner count, cache-as-dynamic bit
 *   (engine mobility, `lighting/shadows/casters/mobility.ts`), deforming bit
 *   (`vsmRenderCandidateFlags`), and far-shadow flags and depth (`vsmRenderFarFlags`,
 *   `vsmRenderFarDepth`), leaving out a caster no map view takes (`farDrop`).
 * - `vsmRenderCull` (per candidate × map view): the per-page draw commands:
 *   far-shadow test of a sun's views (`vsmFarShadowSkipped`), distance cull, static-layer test,
 *   frustum (the box frustum test with
 *   the dynamic depth cull range), then per mip: screen rect, fine caster, stale rect
 *   clip, overlap with any valid page (page-mark pyramid + receiver cover), and one command (row,
 *   mip view, static, page rect, flag mask, dirty flags).
 * - `vsmRenderExpand` (one workgroup per command) = the marking loop: it marks the pages dirty
 *   over the command's page rect into the raster marks, and does the raster's page selection: one
 *   (row, page) pair per page of the rect valid for rendering, the clip planes being the uncached
 *   rect.
 * - `vsmRenderArgs*`: indirect arguments of the next stage (one thread).
 *
 * Bounds: the engine keeps a world sphere per row (`lighting/shadows/casters/spheres.ts`), no local box;
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
 * 1 views (vec4u: the listed lights' groups — run start, run length, first listed map, flags —,
 * then, from `params.lightCount`, their runs of listed maps — id, mip count, flags, stale layers —,
 * `vsmRenderViews`), 2 candidates, 3 counters (rw atomic), 4 commands (rw). Dispatch: x over the
 * chunk's candidates (64 each), y = listed light (group) index: a thread a (caster, light) tests the
 * light's culling volume — the range sphere of a local light, the far-shadow distance of a sun —
 * once, and only a caster the volume holds goes on to cull against each of the light's listed maps
 * (`vsmRenderCullView`), the volume's tests no map repeats.
 *
 * Command (vec4u): x row; y VSM id | mip << 16 | static << 19 | clamp-to-near << 20 | swapped << 21
 * (\`vsmRenderSwapped\`);
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
/**
 * Whether the raster emits the candidate's triangles in this map with corners 1 and 2 swapped, so
 * that a face toward the light is counter-clockwise on the framebuffer (\`vsmRenderVs\`). A
 * triangle's projected winding is its facing times the sign of D: for a perspective map, D = −det
 * of the UV matrix's u, v, w rows (the light at the shifted origin, those rows linear), for an
 * orthographic one det of its u, v, z rows (z toward the light, reversed Z); the page's NDC y and
 * the framebuffer's y each turn it once. Swapped where D < 0, against a row whose faces turn
 * (\`VSM_RENDER_CAND_FLIPPED\`); a two-sided row's second copy swaps once more.
 */
fn vsmRenderSwapped(m:mat4x4f,ortho:bool,flags:u32)->bool{
 let r3=select(vec3f(m[0].w,m[1].w,m[2].w),vec3f(m[0].z,m[1].z,m[2].z),ortho);
 let d=dot(vec3f(m[0].x,m[1].x,m[2].x),cross(vec3f(m[0].y,m[1].y,m[2].y),r3));
 return select(d>0.0,d<0.0,ortho)!=((flags&VSM_RENDER_CAND_FLIPPED)!=0u);
}
/**
 * One caster against one listed map of a light that holds it (\`vsmRenderCull\`): the map's layer,
 * its frustum, then per mip the page rect and a command.
 */
fn vsmRenderCullView(cand:VsmRenderCandidate,view:vec4u,directional:bool){
 let h=vsmHandleFromId(view.x);
 let pd=vsmProjectionOf(h);
 // A map redrawn whole leaves out a caster too small on the main view (\`shadowRadiusThreshold\`).
 if(vsmRadiusCulled(cand.screenRatio,params.radiusThresholdSq,pd.uncached)){return;}
 let nearClip=!directional;
 let viewToClip=pd.lightViewToClip;
 let isOrtho=viewToClip[3][3]>=1.0;
 let shiftedToClip=vsmShiftedToClip(pd.shiftedToMapUv);
 let center=(cand.c.xyz+pd.originShiftHigh)+(cand.l+pd.originShiftLow);
 let radius=cand.c.w;
 var visible=true;
 // The static layer takes a caster that stands still (the engine's mobility) in a cached map; a
 // moving one draws into the dynamic layer: its mobility decides it, frame by frame.
 let staticLayer=!pd.uncached&&(cand.flags&VSM_RENDER_CAND_DYNAMIC)==0u;
 // The receiver cover and the mark mask depend on the cache state.
 let useCover=pd.useCover&&!staticLayer;
 let markMask=select(VSM_PAGE_DYNAMIC_STALE,VSM_PAGE_STATIC_STALE,staticLayer);
 // A view with no stale page of the caster's layer draws nothing of it (\`vsmRenderViews\`).
 if((view.w&select(1u,2u,staticLayer))==0u){return;}
 // One caster rule for every map, cached or not: a caster's size is judged in the map's own
 // pixels alone (\`vsmIsFineCaster\`, per mip below), never by its distance to the eye, which a
 // cached page would hold from the frame it was drawn.
 // Frustum cull; non-static geometry also within the depth range (0, the largest float).
 let extent=vec3f(radius);
 let boxPoint=vsmBoxCullPoint(center,extent,isOrtho,nearClip);
 let cull=vsmBoxInView(shiftedToClip*vec4f(boxPoint,1.0),shiftedToClip[0],shiftedToClip[1],shiftedToClip[2],extent,viewToClip,isOrtho,nearClip);
 visible=cull.inMapView;
 if(visible&&!staticLayer){
  visible=cull.clipHigh.z>0.0&&cull.clipLow.z<FLOAT32_MAX;
 }
 if(!visible){return;}
 let deformsNow=(cand.flags&VSM_RENDER_CAND_DEFORMING)!=0u;
 ${marksDirty ? 'let dirtyFlags=vsmRasterMarkBits(staticLayer,deformsNow);' : 'let dirtyFlags=0u;'}
 let swapped=select(0u,1u<<21u,vsmRenderSwapped(pd.shiftedToMapUv,isOrtho,cand.flags));
 // A displaced surface goes to the tessellation where this kind of light's maps ask it: its pairs
 // are marked (bit 22 of the command, bit 23 of the pair).
 let kind=select(VSM_RENDER_TESSELLATE_LOCAL,VSM_RENDER_TESSELLATE_DIRECTIONAL,directional);
 let tessellated=select(0u,1u<<22u,(cand.flags&VSM_RENDER_CAND_TESSELLATED)!=0u&&(params.tessellated&kind)!=0u);
 let mips=min(view.y,VSM_MIPS);
 // The map's mips from its finest on: its table holds no finer one (\`vsmTableLevelOrigin\`).
 var pixelRadius=vsmClipRadius(isOrtho,radius,center,viewToClip)*f32(VSM_LEVEL0_TEXELS>>pd.finestMip);
 for(var mipLevel=pd.finestMip;mipLevel<mips;mipLevel++){
  let levelTexels=i32(VSM_LEVEL0_TEXELS>>mipLevel);
  var pixels=vsmRectPixels(vec4i(0,0,levelTexels,levelTexels),cull);
  let fineCaster=vsmIsFineCaster(staticLayer,pixelRadius);
  pixelRadius*=0.5;
  pixels=vsmClipToStaleRect(pixels,h,mipLevel,staticLayer);
  if(!vsmTouchesMappedPixels(h,mipLevel,pixels,markMask,fineCaster,useCover)){continue;}
  let pagesRect=vec4u(pixels)>>vec4u(VSM_LOG2_PAGE);
  let slot=atomicAdd(&counts[vsmRenderChunkCounter(params.chunk,0u)],1u);
  if(slot>=params.cmdCapacity){continue;}
  // Its tier's count: the expand of each tier runs over its own commands (\`vsmRenderBin\`).
  atomicAdd(&counts[vsmRenderChunkCounter(params.chunk,VSM_RENDER_TIER_CMDS+vsmRenderTierOf(cand.corners))],1u);
  cmds[slot]=vec4u(
   cand.row,
   view.x|(mipLevel<<16u)|select(0u,1u<<19u,staticLayer)|select(0u,1u<<20u,directional)|swapped|tessellated,
   pagesRect.x|(pagesRect.y<<7u)|(pagesRect.z<<14u)|(pagesRect.w<<21u),
   (cand.corners&0xFFFFu)|(markMask<<16u)|(dirtyFlags<<24u));
 }
}
@compute @workgroup_size(WORKGROUP_THREADS) fn vsmRenderCull(@builtin(workgroup_id) wid:vec3u,@builtin(local_invocation_index) lane:u32){
 let local=wid.x*WORKGROUP_THREADS+lane;
 let k=params.chunkFirst+local;
 if(local>=params.chunkRows||k>=atomicLoad(&counts[0])||wid.y>=min(atomicLoad(&counts[VSM_RENDER_COUNT_VIEWS]),params.lightCount)){return;}
 let cand=candidates[k];
 let listing=views[wid.y];
 let pd=vsmProjectionOf(vsmHandleFromId(listing.z));
 let directional=(listing.w&VSM_RENDER_VIEW_DIRECTIONAL)!=0u;
 // A caster past a sun's far-shadow distance, along the main view, that does not cast far shadows,
 // is left out of every level of the sun's clipmap.
 if(directional&&vsmFarShadowSkipped(cand.flags,cand.farDepth,pd.farShadowDistance)){return;}
 // Local views enable distance cull and near clip.
 let distanceCull=!directional;
 let center=(cand.c.xyz+pd.originShiftHigh)+(cand.l+pd.originShiftLow);
 let radius=cand.c.w;
 var visible=true;
 // Range-based culling distance = the light's radius: its culling volume, one for all its maps (they
 // share the light's origin and range).
 if(distanceCull){visible=dot(center,center)<=(pd.lightRange+radius)*(pd.lightRange+radius);}
 if(!visible){return;}
 for(var run=0u;run<listing.y;run++){vsmRenderCullView(cand,views[params.lightCount+listing.x+run],directional);}
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
