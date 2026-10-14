import { createWebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import {
  FLAT_INDEX_WGSL,
  OPEN_SLICE_WGSL,
  groupWidth,
  DEFAULT_GROUP_WIDTH,
} from '../gpu/dispatch/grid.ts'
import { directLightWgsl } from '../lighting/direct/lightWgsl.ts'
import { RECT_SHADING_WGSL } from '../lighting/direct/rectLightWgsl.ts'
import { LOBES_DECODE_WGSL, LOBES_LIGHTING_WGSL } from '../lighting/direct/lobesWgsl.ts'
import { STANDARD_LIGHTING_WGSL } from '../lighting/standardLighting.ts'
import { BOUNCE_GRID_WGSL } from '../bounce/gridWgsl.ts'
import { SURFACE_MODEL_LIGHT_WGSL, surfaceReflects } from '../scene/surfaceModel.ts'
import { PHYSICAL_SURFACE_FLAG } from '../scene/physicalLobes.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { f0Of } from '../../../math/src/wgsl/lighting.ts'
import { REFLECTION_FORMAT, REFLECTION_SIDE } from './constants.ts'
import { REFLECTION_GROUP, reflectionLightViewWgsl } from './viewLayout.ts'
import { reflectionShareWgsl } from './weight.ts'
import { buildComputeStages } from '../gpu/core/computeStages.ts'
import { RUNTIME_BINDINGS, TRACE_BINDINGS, traceLayouts } from './traceBindings.ts'
import type { TraceGroups } from './traceEncode.ts'
import { TRACE_LIST, TRACE_LIST_FIRST } from '../bounce/runtimeLayout.ts'
import { TRACE_SURFACE_WGSL } from './traceSurfaceWgsl.ts'
import { FRONT_TRACED_FORMAT } from './frontLayer.ts'

/**
 * The surfaces' reflection, in the compute pass of the image, for each pixel's two surfaces — the opaque
 * one and the transparents' front one (`frontLayer.ts`), where the image drew it: where a tile of
 * `REFLECTION_SIDE`² pixels holds a surface with a specular lobe (`classifyReflections`: a thread a pixel,
 * a tile listed once for each of its surfaces that reflects, the surface in the word's top bit), the trace
 * (`traceReflections`) runs over the listed tiles alone: each opaque pixel of such a surface writes the share
 * of the radiance it reflects (`reflectedShare`: both its lobes, traced, weighed on its reflectance and
 * coated), each front pixel the radiance its lobes reflect, which the transparent fragment of its depth
 * weighs (`forwardReflectionWgsl`); any other pixel writes nothing
 * and the resolve reads nothing of it (`resolvedReflection`). The tiles are dispatched indirectly, in rows
 * (`work`: the workgroups along x and y, then 1, then the count of tiles): the classification opens a slice
 * for each tile it lists (`openSlice`), so that an image of any size, whose tiles outnumber what a dimension
 * of a dispatch holds, is traced whole; the trace finds its tile by the rank of its workgroup in the rows
 * (`flatIndex`) and leaves where it is past the count. Both surfaces' tiles share one list, one rotating
 * offset and one frame budget of the proxy's rays (`rtAnswer`), each surface in its own cell of the one
 * store (`rtLayer`). Its lobes are the ones its lights read: where the surface carries the physical lobes
 * (`PHYSICAL_SURFACE_FLAG`), those its lobes target holds (`lobesAt`). Its radiance is the chain of the
 * screen, the proxy, the probes and the environment (`reflectedRadiance`).
 */
export const TRACE_SHADER = wgslProgram(
  `@group(0) @binding(${TRACE_BINDINGS.target}) var traceOut:texture_storage_2d<${REFLECTION_FORMAT},write>;
@group(0) @binding(${TRACE_BINDINGS.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${TRACE_BINDINGS.bounceGrid}) var<uniform> bounce:BounceGrid;
@group(0) @binding(${TRACE_BINDINGS.probes}) var probes:texture_2d_array<f32>;
@group(0) @binding(${TRACE_BINDINGS.work}) var<storage,read_write> work:array<atomic<u32>>;
@group(0) @binding(${TRACE_BINDINGS.base}) var traceBase:texture_2d<f32>;
@group(0) @binding(${TRACE_BINDINGS.lightLists}) var<storage,read> tileLights:array<u32>;
@group(0) @binding(${TRACE_BINDINGS.frontTarget}) var frontOut:texture_storage_2d<${FRONT_TRACED_FORMAT},write>;
var<workgroup> reflecting:atomic<u32>;
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn classifyReflections(@builtin(global_invocation_id) id:vec3u,@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_index) lane:u32){
 let inside=all(vec2f(id.xy)<view.viewport.xy);
 let coord=vec2i(id.xy);
 if(inside&&surfaceReflects(textureLoad(traceFlags,coord,0).r)){atomicOr(&reflecting,1u);}
 if(inside&&reflectionFrontTraced()&&surfaceReflects(textureLoad(frontFlags,coord,0).r)){atomicOr(&reflecting,2u);}
 workgroupBarrier();
 if(lane!=0u){return;}
 // The tile's surfaces listed at once: one rank, one count and one slice for both.
 let layers=atomicLoad(&reflecting);
 let n=countOneBits(layers);
 if(n==0u){return;}
 let first=atomicAdd(&work[3],n);
 var rank=first;
 for(var layer=0u;layer<2u;layer++){
  if((layers&(1u<<layer))==0u){continue;}
  atomicStore(&traceList[${TRACE_LIST_FIRST}u+rank],wg.x|(wg.y<<16u)|(layer<<31u));
  rank++;
 }
 atomicMax(&traceList[${TRACE_LIST.count}u],first+n);
 openSlice(0u,first+n-1u);
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn traceReflections(@builtin(workgroup_id) wg:vec3u,@builtin(num_workgroups) rows:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(local_invocation_index) lane:u32){
 rtRank=flatIndex(wg,rows,1u);
 tracePixel(rtRank,lid.xy);
 // The run-time proxy's frame counters, one atomic of each a workgroup.
 rtShare(lane);
}
/** The pixel \`lid\` of the listed tile of rank \`rank\`, traced on the tile's surface (\`rtLayer\`). */
fn tracePixel(rank:u32,lid:vec2u){
 let count=atomicLoad(&traceList[${TRACE_LIST.count}u]);
 if(rank>=count){return;}
 // The run-time proxy's budget goes to the first tiles it meets, and the next frame's start where this
 // one's ended (the list's offset).
 let tile=atomicLoad(&traceList[${TRACE_LIST_FIRST}u+(rank+atomicLoad(&traceList[${TRACE_LIST.offset}u]))%count]);
 rtLayer=tile>>31u;
 let id=vec2u(tile&65535u,(tile>>16u)&32767u)*${REFLECTION_SIDE}u+lid;
 if(any(vec2f(id)>=view.viewport.xy)){return;}
 let coord=vec2i(id);
 let flags=traceFlagsAt(coord);
 if(!surfaceReflects(flags)){return;}
 rtPixel=id;
 rtCalls=0u;
 let depth=traceDepthAt(coord);
 let P=worldAt(vec2f(id)+vec2f(0.5),depth);
 let normal=traceNormalAt(coord);
 let N=normalize(normal.xyz);
 let V=viewToEye(P);
 if((flags&${PHYSICAL_SURFACE_FLAG}u)!=0u){lobesAt(traceLobesAt(coord),1.0,N,V,normal.a);}
 if(rtLayer!=0u){
  // The front's radiance as its lobes reflect it, weighed by the fragment that reads it.
  let traced=reflectionTrace(P,N,V,normal.a);
  textureStore(frontOut,coord,vec4u(rtPackShared(traced.base),rtPackShared(traced.coat),0u,0u));
  return;
 }
 let base=textureLoad(traceBase,coord,0);
 textureStore(traceOut,coord,vec4f(reflectedShare(f0Of(base.rgb,base.a),normal.a,N,V,P),1.0));
}`,
  [
    directLightWgsl(),
    STANDARD_LIGHTING_WGSL,
    SURFACE_MODEL_LIGHT_WGSL,
    RECT_SHADING_WGSL,
    LOBES_LIGHTING_WGSL,
    LOBES_DECODE_WGSL,
    BOUNCE_GRID_WGSL,
    reflectionLightViewWgsl(REFLECTION_GROUP),
    reflectionShareWgsl(REFLECTION_GROUP, true, RUNTIME_BINDINGS),
    TRACE_SURFACE_WGSL,
    FLAT_INDEX_WGSL,
    OPEN_SLICE_WGSL,
    surfaceReflects,
    f0Of,
  ],
)

/** The trace's kernels on the shaders' modules: the frame state, the tile classification and the
 *  trace, over the reflection group's layout `groupLayout` (`reflectionLayout`). The rows of the
 *  indirect dispatch are cut at the device's limit. */
export async function createTraceStages(
  device: GPUDevice,
  modules: { trace: GPUShaderModule; begin: GPUShaderModule },
  groupLayout: GPUBindGroupLayout,
) {
  const { traceLayout, classifyLayout, beginLayout } = traceLayouts(device)
  const width = groupWidth(device.limits)
  const rows = width === DEFAULT_GROUP_WIDTH ? undefined : { GROUP_WIDTH: width }
  const [{ reflectionBegin }, { classifyReflections }, { traceReflections }] = await Promise.all([
    buildComputeStages(device, [beginLayout], modules.begin, ['reflectionBegin']),
    buildComputeStages(
      device,
      [classifyLayout, groupLayout],
      modules.trace,
      ['classifyReflections'],
      rows,
    ),
    buildComputeStages(device, [traceLayout, groupLayout], modules.trace, ['traceReflections']),
  ])
  return {
    traceLayout,
    classifyLayout,
    beginLayout,
    beginPipeline: reflectionBegin,
    classifyPipeline: classifyReflections,
    tracePipeline: traceReflections,
  }
}

/** A view's trace groups, none made yet: made at the first trace (`traceGroups`). */
export const createTraceGroups = () => ({
  identity: createWebgpuBindIdentity(),
  groups: undefined as TraceGroups | undefined,
})
