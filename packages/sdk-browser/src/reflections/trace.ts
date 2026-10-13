import {
  computeBufferEntry,
  computeTextureEntry,
  namedEntries,
} from '../gpu/core/computeBindings.ts'
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import {
  FLAT_INDEX_WGSL,
  OPEN_SLICE_WGSL,
  groupWidth,
  DEFAULT_GROUP_WIDTH,
} from '../gpu/dispatch/grid.ts'
import { buildComputeStages } from '../lighting/deferred/fullscreen.ts'
import { directLightWgsl } from '../lighting/direct/lightWgsl.ts'
import { RECT_SHADING_WGSL } from '../lighting/direct/rectLightWgsl.ts'
import { LOBES_DECODE_WGSL, LOBES_LIGHTING_WGSL } from '../lighting/direct/lobesWgsl.ts'
import { STANDARD_LIGHTING_WGSL } from '../lighting/standardLighting.ts'
import { TONE_UNMAPPING_WGSL } from '../lighting/toneMappingWgsl.ts'
import { BOUNCE_GRID_WGSL } from '../bounce/gridWgsl.ts'
import { SURFACE_MODEL_LIGHT_WGSL, surfaceReflects } from '../scene/surfaceModel.ts'
import { PHYSICAL_SURFACE_FLAG } from '../scene/physicalLobes.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { f0Of } from '../../../math/src/wgsl/lighting.ts'
import { srgbToLinear } from '../../../math/src/wgsl/color.ts'
import { storageEntry, storeEntry } from './bindings.ts'
import { REFLECTION_FORMAT, REFLECTION_SIDE } from './constants.ts'
import { REFLECTION_GROUP, REFLECTION_VIEW_WGSL, reflectionLightViewWgsl } from './viewLayout.ts'
import { reflectionShareWgsl } from './weight.ts'
import type { RuntimeBindings } from '../bounce/runtimeTraceWgsl.ts'
import { TRACE_LIST, TRACE_LIST_FIRST } from '../bounce/runtimeLayout.ts'
import { VIEW_WGSL } from '../lighting/deferred/worldAtWgsl.ts'

/**
 * THE ONE TABLE OF THE TRACE'S GROUP 0, shared by the classification and the trace: the WGSL
 * declarations, the layouts and the entries read their numbers here. The surface targets, the
 * target it writes, the lights, the bounce cascades and their probes, the indirect arguments
 * (`work`), the trace's list with the frame's counters, the store of the run-time proxy's answers,
 * the proxy's buffer and the light grid's buffer, whose world lists the proxy hits walk.
 */
const TRACE_BINDINGS = {
  flags: 0,
  normals: 1,
  target: 2,
  lights: 3,
  lobes: 4,
  bounceGrid: 5,
  probes: 6,
  work: 7,
  list: 8,
  store: 9,
  base: 10,
  proxy: 11,
  lightLists: 17,
} as const

/** The bindings of the proxy in the trace's group 0 (`runtimeTraceWgsl.ts`), the table's. */
const RUNTIME_BINDINGS: RuntimeBindings = {
  group: 0,
  proxy: TRACE_BINDINGS.proxy,
  list: TRACE_BINDINGS.list,
  store: TRACE_BINDINGS.store,
}

/** The frame state's group (`BEGIN_SHADER`): the view uniform, the indirect arguments, the
 *  lighting's view and the trace's list. */
const BEGIN_BINDINGS = { view: 1, work: 2, lightView: 3, list: 4 } as const

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
  atomicStore(&rtList[${TRACE_LIST_FIRST}u+rank],wg.x|(wg.y<<16u));
  atomicMax(&rtList[${TRACE_LIST.count}u],rank+1u);
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
 let count=atomicLoad(&rtList[${TRACE_LIST.count}u]);
 if(rank>=count){return;}
 // The run-time proxy's budget goes to the first tiles it meets, and the next frame's start where this
 // one's ended (the list's offset).
 let tile=atomicLoad(&rtList[${TRACE_LIST_FIRST}u+(rank+atomicLoad(&rtList[${TRACE_LIST.offset}u]))%count]);
 let id=vec2u(tile&65535u,tile>>16u)*${REFLECTION_SIDE}u+lid;
 if(any(vec2f(id)>=view.viewport.xy)){return;}
 let coord=vec2i(id);
 let flags=textureLoad(traceFlags,coord,0).r;
 if(!surfaceReflects(flags)){return;}
 rtPixel=id;
 rtCalls=0u;
 let base=textureLoad(traceBase,coord,0);
 let P=worldAt(vec2f(id)+vec2f(0.5),textureLoad(hizDepth,coord,0).r);
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

/**
 * The frame's reflection state, one thread: the radiance around the scene (`surroundings`,
 * `reflectionEnvironment`) — the background the view shows, as a mirror must show it: the display
 * value of the view (`view.background`, held below white, which no byte tells from the display's
 * one at an infinite radiance, decoded once) turned back, by the exposure and the display curve of
 * the view, into the radiance that shows it (`toneUnmap`) — and the tile list emptied, its indirect
 * arguments set (`TRACE_SHADER`); the run-time proxy's frame counters started again and its schedule
 * moved on.
 */
export const BEGIN_SHADER = wgslProgram(
  `@group(0) @binding(${BEGIN_BINDINGS.view}) var<storage,read_write> reflectionView:ReflectionView;
@group(0) @binding(${BEGIN_BINDINGS.work}) var<storage,read_write> work:array<u32>;
@group(0) @binding(${BEGIN_BINDINGS.lightView}) var<uniform> view:View;
@group(0) @binding(${BEGIN_BINDINGS.list}) var<storage,read_write> traceList:array<u32>;
const BACKGROUND_WHITE:f32=${254.5 / 255};
@compute @workgroup_size(1)
fn reflectionBegin(){
 let shown=toneUnmap(srgbToLinear(min(view.background.rgb,vec3f(BACKGROUND_WHITE))),u32(view.display.x))/view.lightParams.w;
 reflectionView.surroundings=vec4f(shown,0.0);
 work[0]=0u;work[1]=1u;work[2]=1u;work[3]=0u;
 // The budget ran out at the cursor: the next frame starts there; when every pixel holds its samples, where it is.
 traceList[${TRACE_LIST.count}u]=0u;
 if(traceList[${TRACE_LIST.left}u]!=0u){traceList[${TRACE_LIST.offset}u]+=traceList[${TRACE_LIST.cursor}u];}
 traceList[${TRACE_LIST.cursor}u]=0u;
 traceList[${TRACE_LIST.left}u]=0u;traceList[${TRACE_LIST.spent}u]=0u;
}`,
  [REFLECTION_VIEW_WGSL, VIEW_WGSL, TONE_UNMAPPING_WGSL, srgbToLinear],
)

/** Bytes of the indirect arguments: the workgroups along x and y, 1, then the count of tiles. */
export const TRACE_ARGS_BYTES = 16

/** The trace's bind group 0 and the frame state's layouts. */
function traceLayouts(device: GPUDevice) {
  return {
    traceLayout: device.createBindGroupLayout({
      entries: [
        computeTextureEntry(TRACE_BINDINGS.flags, 'uint'),
        computeTextureEntry(TRACE_BINDINGS.normals, 'unfilterable-float'),
        storageEntry(TRACE_BINDINGS.target),
        computeBufferEntry(TRACE_BINDINGS.lights, 'read-only-storage'),
        computeTextureEntry(TRACE_BINDINGS.lobes, 'uint'),
        computeBufferEntry(TRACE_BINDINGS.bounceGrid, 'uniform'),
        computeTextureEntry(TRACE_BINDINGS.probes, 'unfilterable-float', '2d-array'),
        computeBufferEntry(TRACE_BINDINGS.list, 'storage'),
        storeEntry(TRACE_BINDINGS.store),
        computeTextureEntry(TRACE_BINDINGS.base, 'unfilterable-float'),
        computeBufferEntry(TRACE_BINDINGS.lightLists, 'read-only-storage'),
        computeBufferEntry(TRACE_BINDINGS.proxy, 'read-only-storage'),
      ],
    }),
    classifyLayout: device.createBindGroupLayout({
      entries: [
        computeTextureEntry(TRACE_BINDINGS.flags, 'uint'),
        computeBufferEntry(TRACE_BINDINGS.work, 'storage'),
        computeBufferEntry(TRACE_BINDINGS.list, 'storage'),
      ],
    }),
    beginLayout: device.createBindGroupLayout({
      entries: [
        computeBufferEntry(BEGIN_BINDINGS.view, 'storage'),
        computeBufferEntry(BEGIN_BINDINGS.work, 'storage'),
        computeBufferEntry(BEGIN_BINDINGS.lightView, 'uniform'),
        computeBufferEntry(BEGIN_BINDINGS.list, 'storage'),
      ],
    }),
  }
}

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

/** Bytes of the list of a view at `width × height`: the counters, then a tile a word. */
export const traceListBytes = (width: number, height: number) =>
  TRACE_LIST_FIRST * 4 + ceilDiv(width, REFLECTION_SIDE) * ceilDiv(height, REFLECTION_SIDE) * 4

/** The tiles of a view: the indirect arguments (`TRACE_ARGS_BYTES`), and the list the trace reads and
 *  writes with the frame's counters (`TRACE_LIST`). */
export const createTraceTiles = (device: GPUDevice, width: number, height: number) => ({
  args: device.createBuffer({
    label: 'Trillion3D reflection tile count',
    size: TRACE_ARGS_BYTES,
    // Its count is copied to the settle sample (`settle.ts`).
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC,
  }),
  // Not an indirect argument, so that the trace may write it, and a stage of it binds no more than
  // eight storage buffers (`RUNTIME_BINDINGS`).
  list: device.createBuffer({
    label: 'Trillion3D reflection tile list',
    size: traceListBytes(width, height),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  }),
})
type TraceTiles = ReturnType<typeof createTraceTiles>

/** A view's trace groups, none made yet: made at the first trace (`traceGroups`). */
export const createTraceGroups = () => ({
  identity: createWebgpuBindIdentity(),
  groups: undefined as TraceGroups | undefined,
})

/** What the trace reads of the frame: its surface targets, the lights, the bounce cascades and the
 *  resident proxy, the deferred lighting's view. */
export type TraceInputs = {
  base: GPUTextureView
  flags: GPUTextureView
  normals: GPUTextureView
  lobes: GPUTextureView
  lights: GPUBuffer
  /** The light grid's buffer, whose world lists the proxy hits walk (`bounceLightSlice`). */
  lightLists: GPUBuffer
  bounceGrid: GPUBuffer
  probes: GPUTextureView
  /** The proxy's buffers, or the empty one in each place (`gpu/dag/proxyInstances.ts`). */
  proxy: GPUBuffer
  /** The store of the run-time proxy's answers, or its stand-in (`proxyStore.ts`). */
  store: GPUTextureView
  lightView: GPUBuffer
}

/** The groups of a trace: the trace's, the classification's and the frame state's. */
type TraceGroups = { trace: GPUBindGroup; classify: GPUBindGroup; begin: GPUBindGroup }

/** What a view's trace holds: the target it writes, its view uniform, its tile list, and its groups
 *  under the identity of the resources they name (`createWebgpuBindIdentity`). */
type TraceResources = {
  device: GPUDevice
  targetView: GPUTextureView
  uniform: GPUBuffer
  tiles: TraceTiles
  trace: { identity: WebgpuBindIdentity; groups?: TraceGroups }
}

/** The bind groups of `reflection`'s trace over `inputs`, made again when a resource they name is
 *  not the one they were made over. */
function traceGroups(
  reflection: TraceResources,
  stages: Awaited<ReturnType<typeof createTraceStages>>,
  inputs: TraceInputs,
) {
  const { device, targetView, uniform, tiles, trace } = reflection
  const { next } = trace.identity
  next.length = 0
  next.push(
    stages,
    inputs.base,
    inputs.flags,
    inputs.normals,
    inputs.lobes,
    inputs.lights,
    inputs.bounceGrid,
    inputs.probes,
    inputs.proxy,
    inputs.store,
    inputs.lightView,
    inputs.lightLists,
  )
  if (!trace.identity.moved() && trace.groups) return trace.groups
  return (trace.groups = {
    trace: device.createBindGroup({
      layout: stages.traceLayout,
      entries: namedEntries(TRACE_BINDINGS, {
        flags: inputs.flags,
        normals: inputs.normals,
        target: targetView,
        lights: { buffer: inputs.lights },
        lobes: inputs.lobes,
        bounceGrid: { buffer: inputs.bounceGrid },
        probes: inputs.probes,
        list: { buffer: tiles.list },
        store: inputs.store,
        base: inputs.base,
        lightLists: { buffer: inputs.lightLists },
        proxy: { buffer: inputs.proxy },
      }),
    }),
    classify: device.createBindGroup({
      layout: stages.classifyLayout,
      entries: namedEntries(TRACE_BINDINGS, {
        flags: inputs.flags,
        work: { buffer: tiles.args },
        list: { buffer: tiles.list },
      }),
    }),
    begin: device.createBindGroup({
      layout: stages.beginLayout,
      entries: namedEntries(BEGIN_BINDINGS, {
        view: { buffer: uniform },
        work: { buffer: tiles.args },
        lightView: { buffer: inputs.lightView },
        list: { buffer: tiles.list },
      }),
    }),
  })
}

/**
 * The frame state, the tile classification and the opaque trace, over the pixels of `size`, in the
 * open compute `pass`: `depthGroup` is the reflection group over the depth pyramid.
 */
export function encodeReflectionTrace(
  pass: GPUComputePassEncoder,
  reflection: TraceResources,
  stages: Awaited<ReturnType<typeof createTraceStages>>,
  inputs: TraceInputs,
  depthGroup: GPUBindGroup,
  size: readonly [number, number],
) {
  const groups = traceGroups(reflection, stages, inputs)
  pass.setPipeline(stages.beginPipeline)
  pass.setBindGroup(0, groups.begin)
  pass.dispatchWorkgroups(1)
  pass.setPipeline(stages.classifyPipeline)
  pass.setBindGroup(0, groups.classify)
  pass.setBindGroup(1, depthGroup)
  pass.dispatchWorkgroups(ceilDiv(size[0], REFLECTION_SIDE), ceilDiv(size[1], REFLECTION_SIDE))
  pass.setPipeline(stages.tracePipeline)
  pass.setBindGroup(0, groups.trace)
  pass.dispatchWorkgroupsIndirect(reflection.tiles.args, 0)
}
