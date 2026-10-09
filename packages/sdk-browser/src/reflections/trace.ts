import { computeBufferEntry, computeTextureEntry } from '../gpu/core/computeBindings.ts'
import { sameEntries } from '../gpu/core/sameEntries.ts'
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
import { residentProxyWgsl } from '../bounce/nodeWgsl.ts'
import { SURFACE_MODEL_LIGHT_WGSL, surfaceReflects } from '../scene/surfaceModel.ts'
import { PHYSICAL_SURFACE_FLAG } from '../scene/physicalLobes.ts'
import { ENVIRONMENT_COEFFICIENTS } from '../../../sdk-core/src/scene/core/environment.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { f0Of } from '../../../math/src/wgsl/lighting.ts'
import { srgbToLinear } from '../../../math/src/wgsl/color.ts'
import { storageEntry } from './bindings.ts'
import { REFLECTION_FORMAT, REFLECTION_SIDE as SIDE } from './constants.ts'
import { REFLECTION_GROUP, REFLECTION_VIEW_WGSL, reflectionLightViewWgsl } from './viewLayout.ts'
import { reflectionShareWgsl } from './weight.ts'
import { VIEW_WGSL } from '../lighting/deferred/worldAtWgsl.ts'

/** The binding of the resident proxy in the trace's group 0. */
const PROXY_BINDING = 11

/**
 * The opaque surfaces' reflection, in the compute pass of the image: where a tile of
 * `SIDE × SIDE` pixels holds a surface with a specular lobe (`classifyReflections`: one thread a
 * pixel, a tile listed once, in `traceList`), the trace (`traceReflections`) runs over the listed
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
  `@group(0) @binding(0) var traceFlags:texture_2d<u32>;
@group(0) @binding(1) var traceNormals:texture_2d<f32>;
@group(0) @binding(2) var traceOut:texture_storage_2d<${REFLECTION_FORMAT},write>;
@group(0) @binding(3) var<storage,read> directLights:DirectLights;
@group(0) @binding(4) var traceLobes:texture_2d<u32>;
@group(0) @binding(5) var<uniform> bounce:BounceGrid;
@group(0) @binding(6) var probes:texture_2d_array<f32>;
@group(0) @binding(7) var<storage,read_write> work:array<atomic<u32>>;
@group(0) @binding(8) var<storage,read_write> traceList:array<u32>;
@group(0) @binding(9) var<storage,read> traceCount:array<u32>;
@group(0) @binding(10) var traceBase:texture_2d<f32>;
var<workgroup> reflecting:atomic<u32>;
@compute @workgroup_size(${SIDE},${SIDE})
fn classifyReflections(@builtin(global_invocation_id) id:vec3u,@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_index) lane:u32){
 if(all(vec2f(id.xy)<view.viewport.xy)&&surfaceReflects(textureLoad(traceFlags,vec2i(id.xy),0).r)){atomicOr(&reflecting,1u);}
 workgroupBarrier();
 if(lane==0u&&atomicLoad(&reflecting)!=0u){
  let rank=atomicAdd(&work[3],1u);
  traceList[rank]=wg.x|(wg.y<<16u);
  openSlice(0u,rank);
 }
}
@compute @workgroup_size(${SIDE},${SIDE})
fn traceReflections(@builtin(workgroup_id) wg:vec3u,@builtin(num_workgroups) rows:vec3u,@builtin(local_invocation_id) lid:vec3u){
 let rank=flatIndex(wg,rows,1u);
 if(rank>=traceCount[3]){return;}
 let tile=traceList[rank];
 let id=vec2u(tile&65535u,tile>>16u)*${SIDE}u+lid.xy;
 if(any(vec2f(id)>=view.viewport.xy)){return;}
 let coord=vec2i(id);
 let flags=textureLoad(traceFlags,coord,0).r;
 if(!surfaceReflects(flags)){return;}
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
    residentProxyWgsl(PROXY_BINDING),
    reflectionLightViewWgsl(REFLECTION_GROUP),
    reflectionShareWgsl(REFLECTION_GROUP, true),
    FLAT_INDEX_WGSL,
    OPEN_SLICE_WGSL,
    surfaceReflects,
    f0Of,
  ],
)

/**
 * The frame's reflection state, one thread: the radiance around the scene a miss adds to the
 * environment's coefficients (`surroundings`, `reflectionEnvironment`) — where the scene declares no
 * light around it, its nine coefficients all zero, the background the view shows, as a mirror must
 * show it: the display value of the view (`view.background`, held below white, which no byte tells
 * from the display's one at an infinite radiance, decoded once) turned back, by the exposure and
 * the display curve of the view, into the radiance that shows it (`toneUnmap`); zero where it
 * declares one, which then answers alone — and the tile list emptied, its indirect arguments set
 * (`TRACE_SHADER`).
 */
export const BEGIN_SHADER = wgslProgram(
  `@group(0) @binding(0) var<storage,read> directLights:DirectLights;
@group(0) @binding(1) var<storage,read_write> reflectionView:ReflectionView;
@group(0) @binding(2) var<storage,read_write> work:array<u32>;
@group(0) @binding(3) var<uniform> view:View;
const BACKGROUND_WHITE:f32=${254.5 / 255};
@compute @workgroup_size(1)
fn reflectionBegin(){
 var declared=false;
 for(var k=0u;k<${ENVIRONMENT_COEFFICIENTS}u;k++){declared=declared||any(directLights.environment[k].rgb!=vec3f(0.0));}
 let shown=toneUnmap(srgbToLinear(min(view.background.rgb,vec3f(BACKGROUND_WHITE))),u32(view.display.x))/view.lightParams.w;
 reflectionView.surroundings=vec4f(select(shown,vec3f(0.0),declared),0.0);
 work[0]=0u;work[1]=1u;work[2]=1u;work[3]=0u;
}`,
  [directLightWgsl(), REFLECTION_VIEW_WGSL, VIEW_WGSL, TONE_UNMAPPING_WGSL, srgbToLinear],
)

/** Bytes of the indirect arguments: the workgroups along x and y, 1, then the count of tiles. */
export const TRACE_ARGS_BYTES = 16

/** The trace's bind group 0 and the frame state's layouts. */
function traceLayouts(device: GPUDevice) {
  const layout = (entries: GPUBindGroupLayoutEntry[]) => device.createBindGroupLayout({ entries })
  return {
    traceLayout: layout([
      computeTextureEntry(0, 'uint'),
      computeTextureEntry(1, 'unfilterable-float'),
      storageEntry(2),
      computeBufferEntry(3, 'read-only-storage'),
      computeTextureEntry(4, 'uint'),
      computeBufferEntry(5, 'uniform'),
      computeTextureEntry(6, 'unfilterable-float', '2d-array'),
      computeBufferEntry(8, 'storage'),
      computeBufferEntry(9, 'read-only-storage'),
      computeTextureEntry(10, 'unfilterable-float'),
      computeBufferEntry(PROXY_BINDING, 'read-only-storage'),
    ]),
    classifyLayout: layout([
      computeTextureEntry(0, 'uint'),
      computeBufferEntry(7, 'storage'),
      computeBufferEntry(8, 'storage'),
    ]),
    beginLayout: layout([
      computeBufferEntry(0, 'read-only-storage'),
      computeBufferEntry(1, 'storage'),
      computeBufferEntry(2, 'storage'),
      computeBufferEntry(3, 'uniform'),
    ]),
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
  const layout = (...bindGroupLayouts: GPUBindGroupLayout[]) =>
    device.createPipelineLayout({ bindGroupLayouts })
  const width = groupWidth(device.limits)
  const rows = width === DEFAULT_GROUP_WIDTH ? undefined : { GROUP_WIDTH: width }
  const [{ reflectionBegin }, { classifyReflections }, { traceReflections }] = await Promise.all([
    buildComputeStages(device, layout(beginLayout), modules.begin, ['reflectionBegin']),
    buildComputeStages(
      device,
      layout(classifyLayout, groupLayout),
      modules.trace,
      ['classifyReflections'],
      rows,
    ),
    buildComputeStages(device, layout(traceLayout, groupLayout), modules.trace, [
      'traceReflections',
    ]),
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

/** Bytes of the tile list of a view at `width × height`: a tile a word. */
export const traceListBytes = (width: number, height: number) =>
  ceilDiv(width, SIDE) * ceilDiv(height, SIDE) * 4

/** The tile list of a view and its indirect arguments (`TRACE_ARGS_BYTES`). */
export const createTraceTiles = (device: GPUDevice, width: number, height: number) => ({
  args: device.createBuffer({
    label: 'Trillion3D reflection tile count',
    size: TRACE_ARGS_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
  }),
  list: device.createBuffer({
    label: 'Trillion3D reflection tiles',
    size: traceListBytes(width, height),
    usage: GPUBufferUsage.STORAGE,
  }),
})
type TraceTiles = ReturnType<typeof createTraceTiles>

/** What the trace reads of the frame: its surface targets, the lights, the bounce cascades and the
 *  resident proxy, the deferred lighting's view. */
export type TraceInputs = {
  base: GPUTextureView
  flags: GPUTextureView
  normals: GPUTextureView
  lobes: GPUTextureView
  lights: GPUBuffer
  bounceGrid: GPUBuffer
  probes: GPUTextureView
  proxy: GPUBuffer
  lightView: GPUBuffer
}

/** The groups of a trace over inputs, kept while every input stays. */
export type TraceGroups = {
  key: unknown[]
  trace: GPUBindGroup
  classify: GPUBindGroup
  begin: GPUBindGroup
}

/** What a view's trace holds: the target it writes, its view uniform, its tile list and its groups. */
type TraceResources = {
  device: GPUDevice
  targetView: GPUTextureView
  uniform: GPUBuffer
  tiles: TraceTiles
  traceGroups?: TraceGroups
}
const probe: unknown[] = []

/** The bind groups of `reflection`'s trace over `inputs`, made when an input is not the one they
 *  were made for. */
function traceGroups(
  reflection: TraceResources,
  stages: Awaited<ReturnType<typeof createTraceStages>>,
  inputs: TraceInputs,
) {
  const { device, targetView, uniform, tiles } = reflection
  probe.length = 0
  probe.push(
    inputs.base,
    inputs.flags,
    inputs.normals,
    inputs.lobes,
    inputs.lights,
    inputs.bounceGrid,
    inputs.probes,
    inputs.proxy,
    inputs.lightView,
    stages,
  )
  if (reflection.traceGroups && sameEntries(reflection.traceGroups.key, probe))
    return reflection.traceGroups
  return (reflection.traceGroups = {
    key: probe.slice(),
    trace: device.createBindGroup({
      layout: stages.traceLayout,
      entries: [
        { binding: 0, resource: inputs.flags },
        { binding: 1, resource: inputs.normals },
        { binding: 2, resource: targetView },
        { binding: 3, resource: { buffer: inputs.lights } },
        { binding: 4, resource: inputs.lobes },
        { binding: 5, resource: { buffer: inputs.bounceGrid } },
        { binding: 6, resource: inputs.probes },
        { binding: 8, resource: { buffer: tiles.list } },
        { binding: 9, resource: { buffer: tiles.args } },
        { binding: 10, resource: inputs.base },
        { binding: PROXY_BINDING, resource: { buffer: inputs.proxy } },
      ],
    }),
    classify: device.createBindGroup({
      layout: stages.classifyLayout,
      entries: [
        { binding: 0, resource: inputs.flags },
        { binding: 7, resource: { buffer: tiles.args } },
        { binding: 8, resource: { buffer: tiles.list } },
      ],
    }),
    begin: device.createBindGroup({
      layout: stages.beginLayout,
      entries: [
        { binding: 0, resource: { buffer: inputs.lights } },
        { binding: 1, resource: { buffer: uniform } },
        { binding: 2, resource: { buffer: tiles.args } },
        { binding: 3, resource: { buffer: inputs.lightView } },
      ],
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
  pass.dispatchWorkgroups(ceilDiv(size[0], SIDE), ceilDiv(size[1], SIDE))
  pass.setPipeline(stages.tracePipeline)
  pass.setBindGroup(0, groups.trace)
  pass.dispatchWorkgroupsIndirect(reflection.tiles.args, 0)
}
