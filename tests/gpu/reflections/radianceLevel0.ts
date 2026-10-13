// The level-0 half of the radiance pyramid's class-1 proof (`radianceClass1Page.ts`): the engine's
// own read of level 0 (`reflectionLevelColor`, through the reflection group the engine binds)
// against the read the copy it replaces gave — the copy made here as the engine made it, then
// sampled through the same sampler —, at taps over generated lit images, their drawn border and past
// it, their coverage within one and zero past the drawn size as the lighting's clear leaves them.
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'
import { toHalf } from '../../../packages/math/src/float/half.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import { wgslModule } from '../../../packages/math/src/wgsl/assemble.ts'
import {
  createScreenReflection,
  reflectionGroup,
  reflectionLayout,
} from '../../../packages/sdk-browser/src/reflections/gpu.ts'
import { reflectionFootprintWgsl } from '../../../packages/sdk-browser/src/reflections/footprint.ts'
import {
  REFLECTION_GROUP,
  reflectionLightViewWgsl,
} from '../../../packages/sdk-browser/src/reflections/viewLayout.ts'
import { createDeferredView } from '../../../packages/sdk-browser/src/lighting/deferred/view.ts'
import {
  computeBufferEntry,
  computeTextureEntry,
  sequentialEntries,
} from '../../../packages/sdk-browser/src/gpu/core/computeBindings.ts'
import { autoKernel, groupZero } from '../kit/computeReadback.ts'
import { standaloneHiz } from '../kit/standaloneHiz.ts'

/** The lit images of the level-0 proof: their size, and the drawn size inside it. */
export const LIT_IMAGES = [
  { size: [96, 64], drawn: [96, 64] },
  { size: [96, 64], drawn: [72, 40] },
  { size: [133, 77], drawn: [101, 58] },
] as const

/** The copy level 0 was, as the engine made it: the lit image, zero past the drawn size, its
 *  coverage clamped within one, written in the pyramid's format. */
const COPY_SHADER = `@group(0) @binding(0) var lit:texture_2d<f32>;
@group(0) @binding(1) var copy:texture_storage_2d<rgba16float,write>;
@group(0) @binding(2) var<uniform> drawn:vec4u;
@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) id:vec3u){
 let p=vec2i(id.xy);
 if(any(p>=vec2i(textureDimensions(copy)))){return;}
 let inside=all(p<vec2i(drawn.xy));
 let texel=select(vec4f(0.0),textureLoad(lit,p,0),inside);
 textureStore(copy,p,vec4f(texel.rgb,clamp(texel.a,0.0,1.0)));
}`

/** Both reads of level 0 at each tap: the engine's, and the copy's through the same sampler — the
 *  engine's reflection group in its group, the proof's own bindings in group 0. */
const READ_SHADER = `${wgslModule(
  reflectionFootprintWgsl(REFLECTION_GROUP),
  reflectionLightViewWgsl(REFLECTION_GROUP),
)}
@group(0) @binding(0) var<storage,read> taps:array<vec2f>;
@group(0) @binding(1) var<storage,read_write> engine:array<vec4u>;
@group(0) @binding(2) var<storage,read_write> copied:array<vec4u>;
@group(0) @binding(3) var copy:texture_2d<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&taps)){return;}
 let uv=taps[id.x];
 engine[id.x]=bitcast<vec4u>(reflectionLevelColor(uv,0.0));
 copied[id.x]=bitcast<vec4u>(textureSampleLevel(copy,reflectionSampler,uv,0.0));
}`

/** A generated lit image of `size`, drawn over `drawn`: colours of every magnitude an HDR target
 *  holds, coverage 0, 1 and between, zero past the drawn size. */
function litImage([width, height]: readonly number[], [dw, dh]: readonly number[]) {
  const texels = new Float32Array(width * height * 4)
  let seed = 0x9e3779b9
  const next = () =>
    (seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 2 ** 32
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      const at = (y * width + x) * 4
      for (let c = 0; c < 3; c++) texels[at + c] = next() ** 3 * [1, 40, 2000][(x + y + c) % 3]
      const a = next()
      texels[at + 3] = a < 0.3 ? 0 : a < 0.6 ? 1 : a
    }
  return texels
}

/** Taps over the image of `size`: every texel's centre and corner, and between, a texel past the
 *  border on each side included. */
function tapsOver([width, height]: readonly number[]) {
  const taps: number[] = []
  for (let y = -1; y <= height + 1; y += 0.375)
    for (let x = -1; x <= width + 1; x += 0.375) taps.push(x / width, y / height)
  return new Float32Array(taps)
}

/** The level-0 proof on one lit image: the taps, and those whose two reads differ in any bit. */
export async function level0(
  device: GPUDevice,
  size: readonly [number, number],
  drawn: readonly number[],
) {
  const [width, height] = size
  const reflection = createScreenReflection(device, width, height, false)
  const { hiz, partition } = await standaloneHiz(device, width, height)
  const lightView = createDeferredView(device)
  const group = reflectionGroup(reflection, hiz.depth()!, {
    lightView: lightView.buffer,
  })
  // The lit image in the pyramid's level 0, as an image's adoption leaves it there.
  const texels = litImage(size, drawn)
  device.queue.writeTexture(
    { texture: reflection.radiance.image.texture },
    Uint16Array.from(texels, toHalf),
    { bytesPerRow: width * 8 },
    [width, height],
  )
  const copy = device.createTexture({
    size: [width, height],
    format: 'rgba16float',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  const bounds = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(bounds, 0, new Uint32Array([drawn[0], drawn[1], 0, 0]))
  const copying = device.createComputePipeline(
    autoKernel(device.createShaderModule({ code: COPY_SHADER })),
  )
  const taps = tapsOver(size),
    count = taps.length / 2
  const tapBuffer = device.createBuffer({
    size: taps.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(tapBuffer, 0, taps)
  const out = () =>
    device.createBuffer({
      size: count * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    })
  const [engine, copied] = [out(), out()]
  const readLayout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(0, 'read-only-storage'),
      computeBufferEntry(1, 'storage'),
      computeBufferEntry(2, 'storage'),
      computeTextureEntry(3, 'float'),
    ],
  })
  const reading = device.createComputePipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [readLayout, reflectionLayout(device)],
    }),
    compute: { module: device.createShaderModule({ code: READ_SHADER }), entryPoint: 'main' },
  })
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginComputePass()
  pass.setPipeline(copying)
  pass.setBindGroup(
    0,
    groupZero(device, copying, [
      reflection.radiance.image.view,
      copy.createView(),
      { buffer: bounds },
    ]),
  )
  pass.dispatchWorkgroups(ceilDiv(width, 8), ceilDiv(height, 8))
  pass.setPipeline(reading)
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout: readLayout,
      entries: sequentialEntries([
        { buffer: tapBuffer },
        { buffer: engine },
        { buffer: copied },
        copy.createView(),
      ]),
    }),
  )
  pass.setBindGroup(REFLECTION_GROUP, group)
  pass.dispatchWorkgroups(ceilDiv(count, 64))
  pass.end()
  device.queue.submit([encoder.finish()])
  const [a, b] = [
    (await readGpuBuffer(device, engine, count * 16))!,
    (await readGpuBuffer(device, copied, count * 16))!,
  ]
  let differ = 0,
    nonzero = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) differ++
    if (a[i] !== 0) nonzero++
  }
  for (const made of [copy, tapBuffer, engine, copied, bounds, ...partition]) made.destroy()
  reflection.dispose()
  hiz.dispose()
  lightView.dispose()
  return { taps: count, differ, nonzero }
}
