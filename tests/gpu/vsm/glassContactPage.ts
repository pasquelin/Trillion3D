// A glass pane over a floor, lit, on the machine's device: the contact-shadow ray the lights cast
// (`vsmScreenRayCast`, the engine's one screen march over the depth pyramid) meets the pane in the
// depth pyramid and does not darken the floor behind it — a pane's shadow is the maps' transmission
// (`glass-contact.gpu.ts`). The depth is generated: a floor, then once an opaque wall and once a
// transparent pane in the same place; the view is orthographic, its world its NDC.
import { createGpuHiz } from '../../../packages/sdk-browser/src/gpu/hiz/factory.ts'
import type { Pyramid } from '../../../packages/sdk-browser/src/gpu/hiz/pyramid.ts'
import {
  hizDepthBindEntries,
  hizDepthEntries,
} from '../../../packages/sdk-browser/src/gpu/hiz/pyramidTexture.ts'
import { SCREEN_MARCH_WGSL } from '../../../packages/sdk-browser/src/gpu/hiz/screenMarch.ts'
import { screenSlab } from '../../../packages/sdk-browser/src/gpu/hiz/screenSlab.ts'
import {
  VSM_PROJECTION_LIGHT_STRUCT,
  VSM_PROJECTION_VIEW_BYTES,
  VSM_PROJECTION_VIEW_STRUCT,
  VSM_PROJECTION_VIEW_WORD,
} from '../../../packages/sdk-browser/src/vsm/projectionView.ts'
import { vsmLayout } from '../../../packages/sdk-browser/src/vsm/layout.ts'
import { vsmProjectionWgsl } from '../../../packages/sdk-browser/src/vsm/projectionWgsl.ts'
import { functionText } from '../../../packages/sdk-browser/src/bounce/wgslBody.fixture.ts'
import { wgslProgram } from '../../../packages/math/src/wgsl/assemble.ts'
import { clipToFramebuffer } from '../../../packages/math/src/wgsl/projection.ts'
import { readBuffer } from '../kit/computeReadback.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'

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
  /** The screen march's own reading of the pane: it meets it, and says it is in front. */
  paneSeen: { stopped: boolean; front: boolean }
}

/** The contact ray's cast as the projection pass ships it, cut out of its module. */
const castText = () => {
  const module = vsmProjectionWgsl(vsmLayout({ fullMapCapacity: 127, sunMapCapacity: 35 }), {
    subgroups: false,
  })
  return `${functionText(module, 'vsmScreenRayCast')}\n}`
}

const SHADER = (group: number) =>
  wgslProgram(
    /* wgsl */ `
${VSM_PROJECTION_LIGHT_STRUCT}
${VSM_PROJECTION_VIEW_STRUCT}
@group(${group}) @binding(4) var<storage,read_write> out:array<f32,8>;
@group(${group}) @binding(5) var<uniform> vsmView:VsmProjectionView;
${castText()}
@compute @workgroup_size(1) fn main(){
 let origin=vec3f(-0.9,0.0,${FLOOR});
 let towardLight=vec3f(1.0,0.0,0.5);
 let rayLength=1.4;
 let thickness=6.0;
 out[0]=vsmScreenRayCast(origin,towardLight,rayLength,thickness);
 let size=vsmView.viewPixels.xy;
 let start=clipToFramebuffer(vsmView.shiftedToClip*vec4f(origin,1.0),size);
 let stop=clipToFramebuffer(vsmView.shiftedToClip*vec4f(origin+towardLight*rayLength,1.0),size);
 let d=stop-start;
 let hit=screenMarch(start,d,screenMarchEnd(start.xy,d.xy,size),thickness,vsmView.screenSlab);
 out[1]=select(0.0,1.0,hit.t>=0.0);
 out[2]=select(0.0,1.0,hit.front);
}`,
    [SCREEN_MARCH_WGSL(group, 0), clipToFramebuffer],
  )

export async function testGlassContact(): Promise<GlassContact> {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('WebGPU must be available')
  const { device } = gpu
  const built = await createGpuHiz(device, WIDTH, HEIGHT, 1)
  if (!built) throw new Error('the Hi-Z does not build')
  const hiz = built
  hiz.attach(
    device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE }),
    device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE }),
  )
  const pyramid = hiz.swap(undefined) as Pyramid
  hiz.swap(pyramid)
  const depth = hiz.depth()
  if (!depth) throw new Error('the Hi-Z has no depth')

  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const view = new Float32Array(VSM_PROJECTION_VIEW_BYTES / 4)
  view.set(identity, VSM_PROJECTION_VIEW_WORD.shiftedToClip)
  view.set([WIDTH, HEIGHT, 1 / WIDTH, 1 / HEIGHT], VSM_PROJECTION_VIEW_WORD.viewPixels)
  view.set(screenSlab(identity, HEIGHT), VSM_PROJECTION_VIEW_WORD.screenSlab)
  const uniform = device.createBuffer({
    size: view.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(uniform, 0, view)
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
    device.queue.writeTexture({ texture: depth!.front }, front, { bytesPerRow: WIDTH * 4 }, [
      WIDTH,
      HEIGHT,
    ])
    const encoder = device.createCommandEncoder()
    const build = encoder.beginComputePass()
    hiz!.encodeNearest({ pass: build })
    build.end()
    const run = encoder.beginComputePass()
    run.setPipeline(pipeline)
    run.setBindGroup(0, group)
    run.dispatchWorkgroups(1)
    run.end()
    device.queue.submit([encoder.finish()])
    return Array.from(new Float32Array((await readBuffer(device, result, 0, 32)).buffer))
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
