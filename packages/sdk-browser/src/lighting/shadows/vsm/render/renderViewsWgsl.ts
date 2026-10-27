/**
 * THE RASTER'S VIEWS, LISTED ON THE GPU (`renderEncode.ts`, each view pass): a thread a
 * light of the frame (`lights`, the CPU's table: its first map's id and its map count, laid by
 * `vsmWriteLights`), of those whose maps lie in the view pass (`params.viewFirst`,
 * `params.viewCount`: the ids of its maps, all the frame's in a pass that holds every light), which
 * lists the light as a group where one of its maps has a page to draw this frame (a stale rect,
 * `vsmStaleRects`, not empty; `layers` bit 0 where one of its dynamic layer, bit 1 its static
 * layer's: the cull drops a caster of a layer it has none of) — the groups the cull runs over,
 * their count in the counters' `VSM_RENDER_COUNT_VIEWS` word. A group is its run of listed maps
 * (id, mips, flags, layers), laid one after the other from `params.lightCount` in `views`, the
 * counters' `VSM_RENDER_COUNT_RUNS` word reserving them: the run's start and length, its first
 * map's id and its flags are the group's own entry, at the light's rank in the groups listed

 * (`views[0 .. lightCount)`), its flags carrying the light's lighting channels from `VSM_RENDER_VIEW_CHANNELS_SHIFT`
 * (the light's table holds them, `vsmWriteLights`). A light whose maps are all cached is no group: a still far light
 * costs the raster nothing, however many lights the frame holds. A map's mips are those the raster
 * draws of it (`vsmMapViewMips`, `../mapViews.ts`): one for a clipmap level, every mip from its
 * finest for a local map.
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
import { VSM_RENDER_PARAMS_WGSL } from './renderParamsWgsl.ts'

/** Group 0 of `vsmRenderViews`: the frame's uniforms, stale rects and records. */
export const VSM_RENDER_VIEWS_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'staleRects', binding: 1 },
  { resource: 'projectionData', binding: 2 },
]

/** A map's view as the raster lists it (\`vsmRenderMapView\`): the views' and the shadow views'
 *  descent's, which leaves a light with no page to draw out and lists a view of each mip with one
 *  (\`vsmRenderMapMips\`, \`../traversal/traversalWgsl.ts\`). */
export const VSM_RENDER_MAP_VIEW_WGSL = wgslBlock(
  'VSM_RENDER_MAP_VIEW_WGSL',
  [VSM_CONSTANTS_WGSL, VSM_STALE_RECT_INDEX_WGSL],
  `/** Whether mip \`m\` of map \`id\` has a page to draw in a layer (1: the static layer): its stale rect
 *  is not empty. */
fn vsmRenderMipStale(id:u32,m:u32,layer:u32)->bool{
 let r=vsmStaleRects[vsmStaleRectIndex(id,m,layer==1u)];
 return all(r.xy<=r.zw);
}
/** The mips the raster draws of map \`id\` (\`vsmMapViewMips\`): one for a clipmap level, every mip from
 *  its finest for a local map. */
fn vsmRenderMapMipsEnd(id:u32)->u32{
 return select(VSM_MIPS,1u,vsmProjectionData[id].lightKind==LIGHT_KIND_DIRECTIONAL);
}
/** Map \`id\`'s view: its id, its mips, its flags and its stale layers (0 when no mip has a page to draw). */
fn vsmRenderMapView(id:u32)->vec4u{
 let pd=vsmProjectionData[id];
 let directional=pd.lightKind==LIGHT_KIND_DIRECTIONAL;
 let mips=vsmRenderMapMipsEnd(id);
 var layers=0u;
 for(var m=pd.finestMip;m<mips;m++){
  for(var layer=0u;layer<2u;layer++){
   if(vsmRenderMipStale(id,m,layer)){layers|=1u<<layer;}
  }
 }
 return vec4u(id,mips,select(0u,VSM_RENDER_VIEW_DIRECTIONAL,directional),layers);
}
/** The mips of map \`id\` with a page to draw in a layer at least, a bit each (bit \`m\`): the views the
 *  shadow views' descent lists of it. */
fn vsmRenderMapMips(id:u32)->u32{
 var bits=0u;
 for(var m=vsmProjectionData[id].finestMip;m<vsmRenderMapMipsEnd(id);m++){
  if(vsmRenderMipStale(id,m,0u)||vsmRenderMipStale(id,m,1u)){bits|=1u<<m;}
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
 var first=vec4u(0u);
 for(var id=light.x;id<end;id++){
  let view=vsmRenderMapView(id);
  if(view.w!=0u){
   if(listed==0u){first=view;}
   listed++;
  }
 }
 if(listed==0u){return;}
 let at=atomicAdd(&counts[VSM_RENDER_COUNT_RUNS],listed);
 var next=at;
 for(var id=light.x;id<end;id++){
  let view=vsmRenderMapView(id);
  if(view.w!=0u){
   views[params.lightCount+next]=view;
   next++;
  }
 }
 let slot=atomicAdd(&counts[VSM_RENDER_COUNT_VIEWS],1u);
 views[slot]=vec4u(at,listed,first.x,first.z|(light.z<<VSM_RENDER_VIEW_CHANNELS_SHIFT));
}
`,
    [
      VSM_RENDER_MAP_VIEW_WGSL,
      vsmBindingsWgsl(0, VSM_RENDER_VIEWS_SPECS, layout),
      VSM_RENDER_PARAMS_WGSL,
      FLAT_INDEX_WGSL,
      WORKGROUP_THREADS_WGSL,
    ],
  )
