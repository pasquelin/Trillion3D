/**
 * The contact shadows' ray on the GPU (`contactShadowWgsl`, the shipped block): a probe of each case
 * is a point on a floor seen by an orthographic camera looking down, a light of the engine's own light
 * store and buffer, folded with the case's view settings (`contactGi`, `writeContactShadow`), the view's
 * uniform as the deferred view writes it (`writeContactShadows`), a depth image drawn by a render pass
 * — the floor at the height 0, a platform of the case's height from x = 0 on —, the surface flags of
 * the pixels and the thin subsurface target. One thread a probe writes `contactShadow`'s f32.
 *
 * World to device: x and y over 8 metres to −1..1, z from −10 to 10 to 0..1 reversed (1 at the
 * camera); the camera looks along −z from z = 10 (an orthographic camera: the screen units of a
 * length are metres). The image is 32 × 32: a pixel is half a metre, the platform starts at the pixel
 * column 16, x = 0.
 */
import { clearValueOf } from '../../../packages/sdk-core/src/world/math/packedColour.ts'
import { createSceneLightStore } from '../../../packages/sdk-core/src/scene/light/store.ts'
import {
  createSceneLightContractBuffer,
  uploadSceneLights,
} from '../../../packages/sdk-browser/src/frame/backend/state/lightBuffer.ts'
import { createWebgpuLightState } from '../../../packages/sdk-browser/src/frame/backend/state/lights.ts'
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'
import {
  ZERO_DIRECT,
  createDeferredView,
} from '../../../packages/sdk-browser/src/lighting/deferred/view.ts'
import { VIEW_WGSL } from '../../../packages/sdk-browser/src/lighting/deferred/worldAtWgsl.ts'
import { directLightWgsl } from '../../../packages/sdk-browser/src/lighting/direct/lightWgsl.ts'
import { THIN_SURFACE_WGSL } from '../../../packages/sdk-browser/src/lighting/direct/lightingWgsl.ts'
import { contactShadowWgsl } from '../../../packages/sdk-browser/src/lighting/contactShadow/contactShadowWgsl.ts'
import {
  SUBSURFACE_FORMAT,
  SUBSURFACE_TARGET,
} from '../../../packages/sdk-browser/src/materials/surface/subsurface.ts'
import {
  PIXEL_MODEL,
  PIXEL_MODEL_MASK,
  PIXEL_MODEL_SHIFT,
} from '../../../packages/sdk-browser/src/materials/surface/pixelModel.ts'
import { wgslProgram } from '../../../packages/math/src/wgsl/assemble.ts'
import {
  computeBufferEntry,
  storageTextureLayout,
  textureLayout,
} from '../../../packages/sdk-browser/src/gpu/core/computeBindings.ts'
import { openGpuDevice } from '../../kit/device/webgpuDevice.ts'
import { bufferHolding } from '../../kit/device/computeReadback.ts'

/** The image's side, in pixels. */
const SIDE = 32

/** One probe, its light and its scene. */
export type ContactCase = {
  name: string
  /** The light: whether it casts a shadow, its contact shadow length (screen units, metres with
   *  `world`) and intensities. */
  light: {
    castsShadow: boolean
    length: number
    world?: boolean
    casting?: number
    nonCasting?: number
  }
  /** The light's elevation over the floor, in degrees, along +x from the probe. */
  elevation: number
  /** The probe's x, in metres; its y is 0 and its height the floor's. */
  x: number
  /** The platform's height from x = 0 on, in metres. */
  platform: number
  /** The platform is of the eye model: it casts no contact shadow. */
  platformIsEye?: boolean
  /** The probe's pixel model (`PIXEL_MODEL`), and its opacity where it has one. */
  model?: number
  opacity?: number
  /** The probe is a thin sheet (the two-sided foliage), its opacity in the thin target's alpha. */
  thin?: boolean
  /** The view's override: length, casting and non-casting intensities (below 0, none), metres. */
  override?: [number, number, number, boolean]
  /** The view's switch is off: the lights cast no ray. */
  switchedOff?: boolean
}

const PROGRAM = wgslProgram(
  `
@group(0) @binding(0) var<uniform> view:View;
@group(0) @binding(1) var depth:texture_depth_2d;
@group(0) @binding(2) var words:texture_2d_array<u32>;
@group(0) @binding(3) var<storage,read> directLights:DirectLights;
${SUBSURFACE_TARGET.wgsl}
struct Probe{place:vec4f,state:vec4f,}
@group(0) @binding(4) var<storage,read> probes:array<Probe>;
@group(0) @binding(5) var<storage,read_write> results:array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&probes)){return;}
 let probe=probes[id.x];
 let light=directLights.items[u32(probe.place.w)];
 pixelModel=u32(probe.state.x);
 modelOpacity=probe.state.y;
 thinSubsurface=vec3f(probe.state.z);
 let P=probe.place.xyz;
 results[id.x]=contactShadow(light,P,normalize(light.positionRange.xyz-P),castsShadow(light));
}`,
  [VIEW_WGSL, directLightWgsl(), THIN_SURFACE_WGSL, contactShadowWgsl(true)],
)

/** Draws the depth image from a buffer of depths, one a pixel. */
const DEPTH_PROGRAM = `
@group(0) @binding(0) var<storage,read> depths:array<f32>;
@vertex fn vertexMain(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
 var corner=array<vec2f,3>(vec2f(-1.0,-1.0),vec2f(3.0,-1.0),vec2f(-1.0,3.0));
 return vec4f(corner[i],0.0,1.0);
}
struct Out{@builtin(frag_depth) depth:f32,}
@fragment fn fragmentMain(@builtin(position) at:vec4f)->Out{
 return Out(depths[u32(at.y)*${SIDE}u+u32(at.x)]);
}`

/** The device depth of a height: 1 at the camera's z = 10, 0 at z = −10. */
const depthOf = (z: number) => z / 20 + 0.5
const half = (value: number) => (value === 1 ? 0x3c00 : value === 0.5 ? 0x3800 : 0)

export async function run(cases: ContactCase[]) {
  const opened = await openGpuDevice()
  if (!opened) return { unavailable: 'no WebGPU adapter' } as const
  const { device } = opened
  const compilation: string[] = []
  const compile = async (code: string) => {
    const { module, compilation: errors } = await opened.compile(code)
    compilation.push(...errors)
    return module
  }
  const module = await compile(PROGRAM)
  const depthModule = await compile(DEPTH_PROGRAM)
  const compute = GPUShaderStage.COMPUTE
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: compute, buffer: { type: 'uniform' } },
      { binding: 1, visibility: compute, ...textureLayout('depth') },
      { binding: 2, visibility: compute, ...textureLayout('uint', '2d-array') },
      computeBufferEntry(3, 'read-only-storage'),
      computeBufferEntry(4, 'read-only-storage'),
      computeBufferEntry(5, 'storage'),
      { binding: 22, visibility: compute, ...storageTextureLayout(SUBSURFACE_FORMAT) },
    ],
  })
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'main' },
  })
  const depthLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  })
  const depthPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [depthLayout] }),
    vertex: { module: depthModule, entryPoint: 'vertexMain' },
    fragment: { module: depthModule, entryPoint: 'fragmentMain', targets: [] },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'always' },
  })
  const view = createDeferredView(device)
  const results: number[] = []
  // The textures and buffers of the cases, made once and rewritten for each.
  const depthValues = device.createBuffer({
    size: SIDE * SIDE * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const depthTexture = device.createTexture({
    size: [SIDE, SIDE],
    format: 'depth32float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  })
  const wordsTexture = device.createTexture({
    size: [SIDE, SIDE, 1],
    format: 'r32uint',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  const subsurface = device.createTexture({
    size: [SIDE, SIDE],
    format: SUBSURFACE_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST,
  })
  const probes = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const output = bufferHolding(
    device,
    new Float32Array(4),
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  )
  const depthGroup = device.createBindGroup({
    layout: depthLayout,
    entries: [{ binding: 0, resource: { buffer: depthValues } }],
  })
  const depths = new Float32Array(SIDE * SIDE)
  const flags = new Uint32Array(SIDE * SIDE)
  const texels = new Uint16Array(SIDE * SIDE * 4)
  const eye = (PIXEL_MODEL.eye & PIXEL_MODEL_MASK) << PIXEL_MODEL_SHIFT
  // The view of every case: an orthographic camera looking down −z, the matrix the surfaces were drawn with.
  view.write(new Float32Array(16), [0, 0, 10, 0], SIDE, SIDE, clearValueOf(0), false, ZERO_DIRECT)
  view.writeContactShadows(
    [1 / 8, 0, 0, 0, 0, 1 / 8, 0, 0, 0, 0, 1 / 20, 0, 0, 0, 0.5, 1],
    [0, 0, -1, 1],
  )
  for (const [k, c] of cases.entries()) {
    // The engine's own light, record and buffer, folded with the view's settings as a frame folds them.
    const store = createSceneLightStore()
    const radians = (c.elevation * Math.PI) / 180
    const reach = 100
    store.add({
      id: 'light',
      kind: 'point',
      position: [c.x + reach * Math.cos(radians), 0, reach * Math.sin(radians)],
      color: [1, 1, 1],
      intensity: 1,
      range: 1000,
      castsShadow: c.light.castsShadow,
      contactShadowLength: c.light.length,
      contactShadowLengthInWorldSpace: !!c.light.world,
      contactShadowCastingIntensity: c.light.casting ?? 1,
      contactShadowNonCastingIntensity: c.light.nonCasting ?? 0,
    })
    const [length, casting, nonCasting, metres] = c.override ?? [-1, -1, -1, false]
    store.setContactShadowView({
      contactShadows: c.switchedOff !== true,
      contactShadowOverrideLength: length,
      contactShadowOverrideLengthInWorldSpace: metres,
      contactShadowOverrideCastingIntensity: casting,
      contactShadowOverrideNonCastingIntensity: nonCasting,
    })
    const lights = createWebgpuLightState(store)
    lights.buffer = createSceneLightContractBuffer(device, store)
    uploadSceneLights(device, lights)
    // The depth image: the floor, and the platform from the pixel column 16.
    for (let j = 0; j < SIDE; j++)
      for (let i = 0; i < SIDE; i++) depths[j * SIDE + i] = depthOf(i >= SIDE / 2 ? c.platform : 0)
    device.queue.writeBuffer(depthValues, 0, depths)
    const encoder = device.createCommandEncoder()
    const draw = encoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthClearValue: 0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    })
    draw.setPipeline(depthPipeline)
    draw.setBindGroup(0, depthGroup)
    draw.draw(3)
    draw.end()
    device.queue.submit([encoder.finish()])
    // The surface flags: the platform's pixels wear the eye model if the case says. The thin target:
    // white, its alpha the opacity.
    for (let j = 0; j < SIDE; j++)
      for (let i = 0; i < SIDE; i++)
        flags[j * SIDE + i] = i >= SIDE / 2 && c.platformIsEye ? eye : 0
    device.queue.writeTexture(
      { texture: wordsTexture },
      flags,
      { bytesPerRow: SIDE * 4, rowsPerImage: SIDE },
      [SIDE, SIDE, 1],
    )
    for (let t = 0; t < SIDE * SIDE; t++)
      texels.set([0x3c00, 0x3c00, 0x3c00, half(c.opacity ?? 0.5)], 4 * t)
    device.queue.writeTexture({ texture: subsurface }, texels, { bytesPerRow: SIDE * 8 }, [
      SIDE,
      SIDE,
    ])
    device.queue.writeBuffer(
      probes,
      0,
      new Float32Array([c.x, 0, 0, 0, c.model ?? 0, c.opacity ?? 0, c.thin ? 1 : 0, 0]),
    )
    const group = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: view.buffer } },
        { binding: 1, resource: depthTexture.createView() },
        { binding: 2, resource: wordsTexture.createView({ dimension: '2d-array' }) },
        { binding: 3, resource: { buffer: lights.buffer } },
        { binding: 4, resource: { buffer: probes } },
        { binding: 5, resource: { buffer: output } },
        { binding: 22, resource: subsurface.createView() },
      ],
    })
    const run = device.createCommandEncoder()
    const pass = run.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, group)
    pass.dispatchWorkgroups(1)
    pass.end()
    device.queue.submit([run.finish()])
    const bits = (await readGpuBuffer(device, output, 16))!
    results[k] = new Float32Array(bits.buffer, 0, 1)[0]
    lights.buffer.destroy()
  }
  for (const resource of [depthValues, probes, output]) resource.destroy()
  for (const texture of [depthTexture, wordsTexture, subsurface]) texture.destroy()
  view.dispose()
  const adapter = (await opened.fermer()).court
  return { adapter, errors: [...opened.errors, ...compilation], results }
}
