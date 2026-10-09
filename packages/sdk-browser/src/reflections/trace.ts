import { computeBufferEntry, computeTextureEntry } from '../gpu/core/computeBindings.ts'
import { sameEntries } from '../gpu/core/sameEntries.ts'
import { buildComputeStages } from '../lighting/deferred/fullscreen.ts'
import { directLightWgsl } from '../lighting/direct/lightWgsl.ts'
import { LOBE_AXIS_WGSL } from '../lighting/lobeAxisWgsl.ts'
import { surfaceReflects } from '../scene/surfaceModel.ts'
import { PHYSICAL_SURFACE_FLAG } from '../scene/physicalLobes.ts'
import { ENVIRONMENT_COEFFICIENTS } from '../../../sdk-core/src/scene/core/environment.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { TONE_UNMAPPING_WGSL } from '../lighting/toneMappingWgsl.ts'
import { storageEntry } from './bindings.ts'
import { REFLECTION_FORMAT, REFLECTION_SIDE as SIDE } from './constants.ts'
import { REFLECTION_GROUP, REFLECTION_VIEW_WGSL } from './viewLayout.ts'
import { reflectedRadianceWgsl } from './wgsl.ts'

/**
 * The opaque surfaces' reflection, in the compute pass of the image: where a tile of
 * `SIDE × SIDE` pixels holds a surface with a specular lobe (`classifyReflections`: one thread a
 * pixel, a tile listed once, in `traceTiles` — whose first words are the indirect dispatch's
 * arguments, the count then 1 and 1), the trace (`traceReflections`) runs over the listed tiles
 * alone, and each pixel of such a surface writes the radiance it reflects (`reflectedRadiance`);
 * any other pixel writes nothing and the resolve reads nothing of it (`resolvedReflection`). The
 * opaque resolve weighs what it reads (`resolvedReflectionWgsl`). Its lobe is the one its lights
 * read: where the surface carries the physical lobes (`PHYSICAL_SURFACE_FLAG`), their axis
 * (`packedLobeAxis`); else a round lobe of rough². Its field reads the bounce cascades the resolve
 * reads (`bounce`, `probes`: zero while bounce is off).
 */
export const TRACE_SHADER = wgslProgram(
  `@group(0) @binding(0) var traceFlags:texture_2d<u32>;
@group(0) @binding(1) var traceNormals:texture_2d<f32>;
@group(0) @binding(2) var traceOut:texture_storage_2d<${REFLECTION_FORMAT},write>;
@group(0) @binding(3) var<storage,read> directLights:DirectLights;
@group(0) @binding(4) var traceLobes:texture_2d<u32>;
@group(0) @binding(5) var<uniform> bounce:BounceGrid;
@group(0) @binding(6) var probes:texture_2d_array<f32>;
struct TraceArgs{count:atomic<u32>,rows:u32,layers:u32,}
@group(0) @binding(7) var<storage,read_write> traceArgs:TraceArgs;
@group(0) @binding(8) var<storage,read_write> traceList:array<u32>;
var<workgroup> reflecting:atomic<u32>;
fn traceLobe(coord:vec2i,flags:u32,N:vec3f,alpha:f32)->vec4f{
 if((flags&${PHYSICAL_SURFACE_FLAG}u)==0u){return vec4f(0.0,0.0,0.0,alpha);}
 return packedLobeAxis(textureLoad(traceLobes,coord,0),N,alpha);
}
@compute @workgroup_size(${SIDE},${SIDE})
fn classifyReflections(@builtin(global_invocation_id) id:vec3u,@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_index) lane:u32){
 if(all(vec2f(id.xy)<reflectionView.screen.xy)&&surfaceReflects(textureLoad(traceFlags,vec2i(id.xy),0).r)){atomicOr(&reflecting,1u);}
 workgroupBarrier();
 if(lane==0u&&atomicLoad(&reflecting)!=0u){
  traceList[atomicAdd(&traceArgs.count,1u)]=wg.x|(wg.y<<16u);
 }
}
@compute @workgroup_size(${SIDE},${SIDE})
fn traceReflections(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) lid:vec3u){
 let tile=traceList[wg.x];
 let id=vec2u(tile&65535u,tile>>16u)*${SIDE}u+lid.xy;
 if(any(vec2f(id)>=reflectionView.screen.xy)){return;}
 let coord=vec2i(id);
 let flags=textureLoad(traceFlags,coord,0).r;
 if(!surfaceReflects(flags)){return;}
 let P=reflectionWorldAt(vec2f(id)+vec2f(0.5),textureLoad(hizDepth,coord,0).r);
 let normal=textureLoad(traceNormals,coord,0);
 let N=normalize(normal.xyz);
 let lobe=traceLobe(coord,flags,N,lobeAlpha(normal.a));
 textureStore(traceOut,coord,vec4f(reflectedRadiance(P,N,reflectionToEye(P),normal.a,lobe),1.0));
}`,
  [directLightWgsl(), reflectedRadianceWgsl(REFLECTION_GROUP), LOBE_AXIS_WGSL, surfaceReflects],
)

/**
 * The frame's reflection state, one thread: the radiance around the scene a miss adds to the
 * environment's coefficients (`surroundings`, `reflectionEnvironment`) — where the scene declares no
 * light around it, its nine coefficients all zero, the background the view shows, as a mirror must
 * show it: the radiance the display curve and the exposure turn into the background's displayed
 * value (`toneUnmap`); zero where it declares one, which then answers alone — and the tile list
 * emptied, its indirect arguments set (`TRACE_SHADER`).
 */
export const BEGIN_SHADER = wgslProgram(
  `@group(0) @binding(0) var<storage,read> directLights:DirectLights;
@group(0) @binding(1) var<storage,read_write> view:ReflectionView;
struct TraceArgs{count:u32,rows:u32,layers:u32,}
@group(0) @binding(2) var<storage,read_write> traceArgs:TraceArgs;
@compute @workgroup_size(1)
fn reflectionBegin(){
 var declared=false;
 for(var k=0u;k<${ENVIRONMENT_COEFFICIENTS}u;k++){declared=declared||any(directLights.environment[k].rgb!=vec3f(0.0));}
 let shown=toneUnmap(view.display.rgb,view.counts.y)/view.display.w;
 view.surroundings=vec4f(select(shown,vec3f(0.0),declared),0.0);
 traceArgs.count=0u;traceArgs.rows=1u;traceArgs.layers=1u;
}`,
  [directLightWgsl(), REFLECTION_VIEW_WGSL, TONE_UNMAPPING_WGSL],
)

/** Bytes of the indirect arguments: three words. */
export const TRACE_ARGS_BYTES = 12

/** The trace's bind group 0 and the frame state's layouts. */
function traceLayouts(device: GPUDevice) {
  const buffer = computeBufferEntry
  const texture = computeTextureEntry
  const layout = (entries: GPUBindGroupLayoutEntry[]) => device.createBindGroupLayout({ entries })
  return {
    traceLayout: layout([
      texture(0, 'uint'),
      texture(1, 'unfilterable-float'),
      storageEntry(2),
      buffer(3, 'read-only-storage'),
      texture(4, 'uint'),
      buffer(5, 'uniform'),
      texture(6, 'unfilterable-float', '2d-array'),
      buffer(8, 'storage'),
    ]),
    classifyLayout: layout([texture(0, 'uint'), buffer(7, 'storage'), buffer(8, 'storage')]),
    beginLayout: layout([
      buffer(0, 'read-only-storage'),
      buffer(1, 'storage'),
      buffer(2, 'storage'),
    ]),
  }
}

/** The trace's kernels on the shaders' modules: the frame state, the tile classification and the
 *  trace, over the reflection group's layout `groupLayout` (`reflectionLayout`). */
export async function createTraceStages(
  device: GPUDevice,
  modules: { trace: GPUShaderModule; begin: GPUShaderModule },
  groupLayout: GPUBindGroupLayout,
) {
  const { traceLayout, classifyLayout, beginLayout } = traceLayouts(device)
  const layout = (...bindGroupLayouts: GPUBindGroupLayout[]) =>
    device.createPipelineLayout({ bindGroupLayouts })
  const [{ reflectionBegin }, { classifyReflections }, { traceReflections }] = await Promise.all([
    buildComputeStages(device, layout(beginLayout), modules.begin, ['reflectionBegin']),
    buildComputeStages(device, layout(classifyLayout, groupLayout), modules.trace, [
      'classifyReflections',
    ]),
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
export type TraceStages = Awaited<ReturnType<typeof createTraceStages>>

/** Bytes of the tile list of a view at `width × height`: a tile a word. */
export const traceListBytes = (width: number, height: number) =>
  ceilDiv(width, SIDE) * ceilDiv(height, SIDE) * 4

/** The tile list of a view and its indirect arguments: the tile count, then 1 and 1. */
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

/** What the trace reads of the frame: its surface targets, the lights, the bounce cascades. */
export type TraceInputs = {
  flags: GPUTextureView
  normals: GPUTextureView
  lobes: GPUTextureView
  lights: GPUBuffer
  bounceGrid: GPUBuffer
  probes: GPUTextureView
}

/** The groups of a trace over inputs, kept while every input stays. */
export type TraceGroups = {
  key: unknown[]
  trace: GPUBindGroup
  classify: GPUBindGroup
  begin: GPUBindGroup
}

/** What a view's trace holds: the target it writes, its view uniform, its tile list and its groups. */
export type TraceResources = {
  device: GPUDevice
  targetView: GPUTextureView
  uniform: GPUBuffer
  tiles: TraceTiles
  traceGroups?: TraceGroups
}
const probe: unknown[] = []

/** The bind groups of `reflection`'s trace over `inputs`, made when an input is not the one they
 *  were made for. */
function traceGroups(reflection: TraceResources, stages: TraceStages, inputs: TraceInputs) {
  const { device, targetView, uniform, tiles } = reflection
  probe.length = 0
  probe.push(
    inputs.flags,
    inputs.normals,
    inputs.lobes,
    inputs.lights,
    inputs.bounceGrid,
    inputs.probes,
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
  stages: TraceStages,
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
