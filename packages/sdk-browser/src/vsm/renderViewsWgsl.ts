/**
 * THE RASTER'S VIEWS, LISTED ON THE GPU (`chunkGroups.ts` `encodeVsmCandidates`): a thread a map of
 * the frame, which lists the map as a view (VSM id, mips, flags, 0) where one of its mips has a page
 * to draw this frame (its stale rect, `vsmStaleRects`, not empty) — the views the cull runs over,
 * their count in the counters' `VSM_RENDER_COUNT_VIEWS` word. A map whose pages are all cached is
 * no view: a still far light costs the raster nothing, however many lights the frame holds. A
 * map's mips are those the raster draws of it (`vsmMapViewMips`, `mapViews.ts`): one for a clipmap
 * level, every mip from its finest for a local map. The list holds `params.viewCount` views at
 * most, the CPU's bound (`vsmRenderViewBound`).
 *
 * Group 0: `VSM_RENDER_VIEWS_SPECS`; group 1: 0 params (uniform, dynamic), 1 views (rw), 2 counters
 * (rw atomic).
 */
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../gpu/dispatch/grid.ts'
import { VSM_CONSTANTS_WGSL } from './constants.ts'
import { type VsmBindingSpec, vsmBindingsWgsl } from './resources.ts'
import type { VsmLayout } from './layout.ts'
import { VSM_RENDER_PARAMS_WGSL } from './renderParamsWgsl.ts'

/** Group 0 of `vsmRenderViews`: the frame's uniforms, stale rects and records. */
export const VSM_RENDER_VIEWS_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'staleRects', binding: 1 },
  { resource: 'projectionData', binding: 2 },
]

export const vsmRenderViewsWgsl = (layout: VsmLayout) =>
  wgslProgram(
    /* wgsl */ `
@group(1) @binding(0) var<uniform> params:VsmRenderParams;
@group(1) @binding(1) var<storage,read_write> views:array<vec4u>;
@group(1) @binding(2) var<storage,read_write> counts:array<atomic<u32>>;
@compute @workgroup_size(WORKGROUP_THREADS) fn vsmRenderViews(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let id=flatIndex(wid,nwg,1u)*WORKGROUP_THREADS+lane;
 if(id>=vsm.mapCount){return;}
 let pd=vsmProjectionData[id];
 let directional=pd.lightKind==LIGHT_KIND_DIRECTIONAL;
 let mips=select(VSM_MIPS,1u,directional);
 var drawn=false;
 for(var m=pd.finestMip;m<mips;m++){
  let r=vsmStaleRects[id*VSM_MIPS+m];
  if(all(r.xy<=r.zw)){drawn=true;}
 }
 if(!drawn){return;}
 let at=atomicAdd(&counts[VSM_RENDER_COUNT_VIEWS],1u);
 if(at<params.viewCount){views[at]=vec4u(id,mips,select(0u,VSM_RENDER_VIEW_DIRECTIONAL,directional),0u);}
}
`,
    [
      VSM_CONSTANTS_WGSL,
      vsmBindingsWgsl(0, VSM_RENDER_VIEWS_SPECS, layout),
      VSM_RENDER_PARAMS_WGSL,
      FLAT_INDEX_WGSL,
      WORKGROUP_THREADS_WGSL,
    ],
  )
