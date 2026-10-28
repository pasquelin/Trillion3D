/**
 * THE RASTER'S VIEWS, LISTED ON THE GPU (`renderEncode.ts`, each view pass): a thread a light, which
 * lists its maps' mip views where a layer's stale rect is not empty (`vsmRenderMapMips`), in the order
 * of the maps then their mips, a map's contiguous. A map with a view is a group, in the first
 * `params.viewCount` places of `views`: its run's start and length, its id, the stale layers of its views together
 * (`VSM_RENDER_VIEW_LAYERS_MASK`) and its light's channels (`VSM_RENDER_VIEW_CHANNELS_SHIFT`). The runs lie after the groups, a view four words: the map, the mip,
 * its stale layers (bit 0 the dynamic layer's, bit 1 the static's), the bits of its level of detail's
 * scale. The counters' `VSM_RENDER_COUNT_VIEWS` and `_RUNS` words count the groups and the views.
 *
 * Group 0: `VSM_RENDER_VIEWS_SPECS`; group 1: 0 params (uniform, dynamic), 1 views (rw),
 * 2 counters (rw atomic), 3 lights (read).
 */
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../../gpu/dispatch/grid.ts'
import { VSM_CONSTANTS_WGSL, VSM_STALE_RECT_INDEX_WGSL } from '../constants.ts'
import { type VsmBindingSpec, vsmBindingsWgsl } from '../resources.ts'
import type { VsmLayout } from '../layout.ts'
import { VSM_VIEW_LENS_WGSL } from '../invalidation/boxCullWgsl.ts'
import { VSM_RENDER_PARAMS_WGSL } from './renderParamsWgsl.ts'

/** Group 0 of `vsmRenderViews`: the frame's uniforms, stale rects and records. */
export const VSM_RENDER_VIEWS_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'staleRects', binding: 1 },
  { resource: 'projectionData', binding: 2 },
]

/** The mips the raster draws of a map and the stale rects that say which have a page to draw: the
 *  views' kernel's (\`vsmRenderViews\`) and the shadow views' descent's (\`vsmRenderMapMips\`,
 *  \`../traversal/traversalWgsl.ts\`). */
export const VSM_RENDER_MAP_VIEW_WGSL = wgslBlock(
  'VSM_RENDER_MAP_VIEW_WGSL',
  [VSM_CONSTANTS_WGSL, VSM_STALE_RECT_INDEX_WGSL],
  `/** The layers of map \`id\`'s mip \`m\` that have a page to draw, a bit each (0 the dynamic layer's, 1 the
 *  static layer's): the layer's stale rect is not empty. */
fn vsmRenderMipLayers(id:u32,m:u32)->u32{
 let dynamicRect=vsmStaleRects[vsmStaleRectIndex(id,m,false)];
 let staticRect=vsmStaleRects[vsmStaleRectIndex(id,m,true)];
 return select(0u,1u,all(dynamicRect.xy<=dynamicRect.zw))|select(0u,2u,all(staticRect.xy<=staticRect.zw));
}
/** The mips the raster draws of map \`id\` (\`vsmMapViewMips\`): one for a clipmap level, every mip from
 *  its finest for a local map. */
fn vsmRenderMapMipsEnd(id:u32)->u32{
 return select(VSM_MIPS,1u,vsmProjectionData[id].lightKind==LIGHT_KIND_DIRECTIONAL);
}
/** The mips of map \`id\` with a page to draw in a layer at least, a bit each (bit \`m\`): the views the
 *  shadow views' descent lists of it. */
fn vsmRenderMapMips(id:u32)->u32{
 var bits=0u;
 for(var m=vsmProjectionData[id].finestMip;m<vsmRenderMapMipsEnd(id);m++){
  if(vsmRenderMipLayers(id,m)!=0u){bits|=1u<<m;}
 }
 return bits;
}
`,
)

export const vsmRenderViewsWgsl = (layout: VsmLayout) =>
  wgslProgram(
    /* wgsl */ `
@group(1) @binding(0) var<uniform> params:VsmRenderParams;
@group(1) @binding(1) var<storage,read_write> views:array<vec4u>;
@group(1) @binding(2) var<storage,read_write> counts:array<atomic<u32>>;
@group(1) @binding(3) var<storage,read> lights:array<vec4u>;
@compute @workgroup_size(WORKGROUP_THREADS) fn vsmRenderViews(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let rank=flatIndex(wid,nwg,1u)*WORKGROUP_THREADS+lane;
 if(rank>=params.lightCount){return;}
 let light=lights[rank];
 if(light.x<params.viewFirst||light.x>=params.viewFirst+params.viewCount){return;}
 let end=min(light.x+light.y,vsm.mapCount);
 var listed=0u;
 for(var id=light.x;id<end;id++){listed+=countOneBits(vsmRenderMapMips(id));}
 if(listed==0u){return;}
 var at=atomicAdd(&counts[VSM_RENDER_COUNT_RUNS],listed);
 for(var id=light.x;id<end;id++){
  var mips=vsmRenderMapMips(id);
  if(mips==0u){continue;}
  let group=atomicAdd(&counts[VSM_RENDER_COUNT_VIEWS],1u);
  let start=at;
  var layersOfMap=0u;
  while(mips!=0u){
   let m=firstTrailingBit(mips);
   mips&=mips-1u;
   let focal=vsmViewLens(vsmProjectionData[id].lightViewToClip,m).focal;
   let layers=vsmRenderMipLayers(id,m);
   layersOfMap|=layers;
   views[params.viewCount+at]=vec4u(id,m,layers,bitcast<u32>(focal));
   at++;
  }
  views[group]=vec4u(start,at-start,id,layersOfMap|(light.z<<VSM_RENDER_VIEW_CHANNELS_SHIFT));
 }
}
`,
    [
      VSM_RENDER_MAP_VIEW_WGSL,
      VSM_VIEW_LENS_WGSL,
      vsmBindingsWgsl(0, VSM_RENDER_VIEWS_SPECS, layout),
      VSM_RENDER_PARAMS_WGSL,
      FLAT_INDEX_WGSL,
      WORKGROUP_THREADS_WGSL,
    ],
  )
