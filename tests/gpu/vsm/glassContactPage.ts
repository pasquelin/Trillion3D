// A glass pane over a floor, lit, on the machine's device: the contact-shadow ray the lights cast
// (`vsmScreenRayFrom`, four samples of the opaque depth) passes the pane in the depth pyramid's
// level 0 and does not darken the floor behind it — a pane's shadow is the maps' transmission
// (`glass-contact.gpu.ts`). The depth is generated: a floor, then once an opaque wall and once a
// transparent pane in the same place; the view is orthographic, its world its NDC.
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'
import { standaloneHiz } from '../../kit/device/standaloneHiz.ts'
import type { Pyramid } from '../../../packages/sdk-browser/src/visibility/hiz/gpu/pyramid.ts'
import {
  HIZ_FRONT_LAYER,
  hizDepthBindEntries,
  hizDepthEntries,
} from '../../../packages/sdk-browser/src/visibility/hiz/gpu/pyramidTexture.ts'
import { SCREEN_MARCH_WGSL } from '../../../packages/sdk-browser/src/visibility/hiz/gpu/screenMarch.ts'
import { screenSlabInto } from '../../../packages/sdk-browser/src/visibility/hiz/gpu/screenSlab.ts'
import {
  VSM_PROJECTION_LIGHT_STRUCT,
  VSM_PROJECTION_VIEW_BYTES,
  VSM_PROJECTION_VIEW_STRUCT,
  VSM_PROJECTION_VIEW_WORD,
} from '../../../packages/sdk-browser/src/lighting/shadows/vsm/projection/projectionView.ts'
import { vsmScreenSegmentWgsl } from '../../../packages/sdk-browser/src/lighting/shadows/vsm/trace/traceScreenWgsl.ts'
import { wgslProgram } from '../../../packages/math/src/wgsl/assemble.ts'
import { REFLECTION_RULES } from '../../../packages/sdk-core/src/contracts/reflectionOptions.ts'
import { wgslF32 } from '../../../packages/math/src/wgsl/number.ts'
import { clipToFramebuffer } from '../../../packages/math/src/wgsl/projection.ts'
import { bufferHolding } from '../../kit/device/computeReadback.ts'
import { openGpuDevice } from '../../kit/device/webgpuDevice.ts'

const WIDTH = 64,
  HEIGHT = 64,
  FLOOR = 0.1,
  SURFACE = 0.3,
  /** The pixels the wall or the pane covers, a column band of the image. */
  BAND = [12, 24]

/** The cast of one ray in each scene: how far the ray goes before the light is blocked. */
export type GlassContact = {
  adapter: string
  errors: string[]
  rayLength: number
  /** Floor alone, an opaque wall over it, a transparent pane over it. */
  floor: number
  wall: number
  pane: number
  /** The engine's screen march (the reflection's) reading the pane: it meets it, and says it is in
   *  front. */
  paneSeen: { stopped: boolean; front: boolean }
}

/** The geometry of a surface's thickness the reflection's march takes, in this view. */
const SLAB = [0, 0, 0, 0]
screenSlabInto(SLAB, 0, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], HEIGHT, [0, 0, 0])

const SHADER = (group: number) =>
  wgslProgram(
    /* wgsl */ `
${VSM_PROJECTION_LIGHT_STRUCT}
${VSM_PROJECTION_VIEW_STRUCT}
@group(${group}) @binding(4) var<storage,read_write> out:array<f32,8>;
@group(${group}) @binding(5) var<uniform> vsmView:VsmProjectionView;
@compute @workgroup_size(1) fn main(){
 let origin=vec3f(-0.9,0.0,${FLOOR});
 let towardLight=vec3f(1.0,0.0,0.5);
 let rayLength=1.4;
 let pixels=6.0;
 let relative=${wgslF32(REFLECTION_RULES.reflectionRelativeDepthThickness.default)};
 out[0]=vsmScreenRayFrom(vsmScreenRayStart(origin),origin,towardLight,rayLength,0.5);
 let size=vsmView.viewPixels.xy;
 let start=clipToFramebuffer(vsmView.shiftedToClip*vec4f(origin,1.0),size);
 let stop=clipToFramebuffer(vsmView.shiftedToClip*vec4f(origin+towardLight*rayLength,1.0),size);
 let d=stop-start;
 let slab=vec4f(${[...SLAB].map(wgslF32).join(',')});
 let hit=screenMarch(start,d,screenMarchEnd(start.xy,d.xy,size),pixels,relative,slab,0xffffffffu,true);
 out[1]=select(0.0,1.0,hit.t>=0.0);
 out[2]=select(0.0,1.0,hit.front);
}`,
    [vsmScreenSegmentWgsl([group, 0]), SCREEN_MARCH_WGSL(group, 0), clipToFramebuffer],
  )

export async function testGlassContact(): Promise<GlassContact> {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('WebGPU must be available')
  const { device } = gpu
  // The pane's depth lies where the engine's lies: level 0's front layer, which the Hi-Z folds in.
  const { hiz } = await standaloneHiz(device, WIDTH, HEIGHT)
  // A scene with transparents asks the front layer (`GpuHiz.front`): an opaque one holds none.
  hiz.front(true)
  // The pane's contact is the planes' march (`hizTrace` `'planes'`).
  hiz.planes(true)
  const pyramid = hiz.swap(undefined) as Pyramid
  hiz.swap(pyramid)
  const depth = hiz.depth()
  if (!depth) throw new Error('the Hi-Z has no depth')

  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const view = new Float32Array(VSM_PROJECTION_VIEW_BYTES / 4)
  view.set(identity, VSM_PROJECTION_VIEW_WORD.shiftedToClip)
  view.set([WIDTH, HEIGHT, 1 / WIDTH, 1 / HEIGHT], VSM_PROJECTION_VIEW_WORD.viewPixels)
  const uniform = bufferHolding(device, view, GPUBufferUsage.UNIFORM)
  const result = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })

  const layout = device.createBindGroupLayout({
    entries: [
      ...hizDepthEntries(0, GPUShaderStage.COMPUTE),
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
  })
  const code = SHADER(0)
  const module = device.createShaderModule({ code })
  const info = await module.getCompilationInfo()
  const compilation = info.messages.filter((m) => m.type === 'error').map((m) => m.message)
  if (compilation.length) throw new Error(compilation.join('\n'))
  const pipeline = await device.createComputePipelineAsync({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'main' },
  })
  const group = device.createBindGroup({
    layout,
    entries: [
      ...hizDepthBindEntries(0, depth),
      { binding: 4, resource: { buffer: result } },
      { binding: 5, resource: { buffer: uniform } },
    ],
  })

  /** The image: the floor everywhere; `wall` over the band at the opaque depth, or `pane` at the transparent one. */
  async function cast(kind: 'floor' | 'wall' | 'pane') {
    const inBand = (i: number) => i % WIDTH >= BAND[0] && i % WIDTH < BAND[1]
    const opaque = Float32Array.from({ length: WIDTH * HEIGHT }, (_, i) =>
      kind === 'wall' && inBand(i) ? SURFACE : FLOOR,
    )
    const front = Float32Array.from({ length: WIDTH * HEIGHT }, (_, i) =>
      kind === 'pane' && inBand(i) ? SURFACE : 0,
    )
    device.queue.writeTexture({ texture: hiz.level0 }, opaque, { bytesPerRow: WIDTH * 4 }, [
      WIDTH,
      HEIGHT,
    ])
    device.queue.writeTexture(
      { texture: hiz.level0, origin: [0, 0, HIZ_FRONT_LAYER] },
      front,
      { bytesPerRow: WIDTH * 4 },
      [WIDTH, HEIGHT],
    )
    const encoder = device.createCommandEncoder()
    const build = encoder.beginComputePass()
    hiz!.encodeFull({ pass: build })
    build.end()
    const run = encoder.beginComputePass()
    run.setPipeline(pipeline)
    run.setBindGroup(0, group)
    run.dispatchWorkgroups(1)
    run.end()
    device.queue.submit([encoder.finish()])
    return Array.from(new Float32Array((await readGpuBuffer(device, result, 32))!.buffer))
  }
  const floor = await cast('floor'),
    wall = await cast('wall'),
    pane = await cast('pane')
  hiz.dispose()
  const { court: adapter } = await gpu.fermer()
  return {
    adapter,
    errors: gpu.errors,
    rayLength: Math.fround(1.4),
    floor: floor[0],
    wall: wall[0],
    pane: pane[0],
    paneSeen: { stopped: pane[1] === 1, front: pane[2] === 1 },
  }
}
