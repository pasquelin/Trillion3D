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
import { HIZ_OPAQUE_LAYER } from '../gpu/hiz/pyramidTexture.ts'
import { REFLECTION_FORMAT, REFLECTION_SIDE } from './constants.ts'
import { REFLECTION_GROUP, reflectionLightViewWgsl } from './viewLayout.ts'
import { reflectionShareWgsl } from './weight.ts'
import { buildComputeStages } from '../gpu/core/computeStages.ts'
import { RUNTIME_BINDINGS, TRACE_BINDINGS, traceLayouts } from './traceBindings.ts'
import type { TraceGroups } from './traceEncode.ts'
import { TRACE_LIST, TRACE_LIST_FIRST } from '../bounce/runtimeLayout.ts'

/**
 * The opaque surfaces' reflection, in the compute pass of the image: where a tile of
 * `REFLECTION_SIDE`² pixels holds a surface with a specular lobe (`classifyReflections`: a thread a
 * pixel, a tile listed once, in the tile list), the trace (`traceReflections`) runs over the listed
 * tiles alone, and each pixel of such a surface writes the share of the radiance it reflects
 * (`reflectedShare`: both its lobes, traced, weighed on its reflectance and coated); any other
 * pixel writes nothing and the resolve reads nothing of it (`resolvedReflection`). The tiles are
 * dispatched indirectly, in rows (`work`: the workgroups along x and y, then 1, then the count of
 * tiles): the classification opens a slice for each tile it lists (`openSlice`), so that an image of
 * any size, whose tiles outnumber what a dimension of a dispatch holds, is traced whole; the trace
 * finds its tile by the rank of its workgroup in the rows (`flatIndex`) and leaves where it is past
 * the count. Its lobes are the ones its lights read: where the surface carries the physical lobes
 * (`PHYSICAL_SURFACE_FLAG`), those the lobes target holds (`lobesAt`). Its radiance is the chain of
 * the screen, the proxy, the probes and the environment (`reflectedRadiance`).
 */
export const TRACE_SHADER = wgslProgram(
  `@group(0) @binding(${TRACE_BINDINGS.flags}) var traceFlags:texture_2d<u32>;
@group(0) @binding(${TRACE_BINDINGS.normals}) var traceNormals:texture_2d<f32>;
@group(0) @binding(${TRACE_BINDINGS.target}) var traceOut:texture_storage_2d<${REFLECTION_FORMAT},write>;
@group(0) @binding(${TRACE_BINDINGS.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${TRACE_BINDINGS.lobes}) var traceLobes:texture_2d<u32>;
@group(0) @binding(${TRACE_BINDINGS.bounceGrid}) var<uniform> bounce:BounceGrid;
@group(0) @binding(${TRACE_BINDINGS.probes}) var probes:texture_2d_array<f32>;
@group(0) @binding(${TRACE_BINDINGS.work}) var<storage,read_write> work:array<atomic<u32>>;
@group(0) @binding(${TRACE_BINDINGS.base}) var traceBase:texture_2d<f32>;
@group(0) @binding(${TRACE_BINDINGS.lightLists}) var<storage,read> tileLights:array<u32>;
var<workgroup> reflecting:atomic<u32>;
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn classifyReflections(@builtin(global_invocation_id) id:vec3u,@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_index) lane:u32){
 if(all(vec2f(id.xy)<view.viewport.xy)&&surfaceReflects(textureLoad(traceFlags,vec2i(id.xy),0).r)){atomicOr(&reflecting,1u);}
 workgroupBarrier();
 if(lane==0u&&atomicLoad(&reflecting)!=0u){
  let rank=atomicAdd(&work[3],1u);
  atomicStore(&traceList[${TRACE_LIST_FIRST}u+rank],wg.x|(wg.y<<16u));
  atomicMax(&traceList[${TRACE_LIST.count}u],rank+1u);
  openSlice(0u,rank);
 }
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn traceReflections(@builtin(workgroup_id) wg:vec3u,@builtin(num_workgroups) rows:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(local_invocation_index) lane:u32){
 rtRank=flatIndex(wg,rows,1u);
 tracePixel(rtRank,lid.xy);
 // The run-time proxy's frame counters, one atomic of each a workgroup.
 rtShare(lane);
}
/** The pixel \`lid\` of the listed tile of rank \`rank\`, traced. */
fn tracePixel(rank:u32,lid:vec2u){
 let count=atomicLoad(&traceList[${TRACE_LIST.count}u]);
 if(rank>=count){return;}
 // The run-time proxy's budget goes to the first tiles it meets, and the next frame's start where this
 // one's ended (the list's offset).
 let tile=atomicLoad(&traceList[${TRACE_LIST_FIRST}u+(rank+atomicLoad(&traceList[${TRACE_LIST.offset}u]))%count]);
 let id=vec2u(tile&65535u,tile>>16u)*${REFLECTION_SIDE}u+lid;
 if(any(vec2f(id)>=view.viewport.xy)){return;}
 let coord=vec2i(id);
 let flags=textureLoad(traceFlags,coord,0).r;
 if(!surfaceReflects(flags)){return;}
 rtPixel=id;
 rtCalls=0u;
 let base=textureLoad(traceBase,coord,0);
 let P=worldAt(vec2f(id)+vec2f(0.5),textureLoad(hizDepth,coord,${HIZ_OPAQUE_LAYER},0).r);
 let normal=textureLoad(traceNormals,coord,0);
 let N=normalize(normal.xyz);
 let V=viewToEye(P);
 if((flags&${PHYSICAL_SURFACE_FLAG}u)!=0u){lobesAt(textureLoad(traceLobes,coord,0),1.0,N,V,normal.a);}
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
