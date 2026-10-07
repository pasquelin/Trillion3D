// Texture taps on Dawn for the addressing proof (defects 4, 7, 8): one render per batch onto two
// float targets — the engine's wrap WGSL beside the native sampler set to the map's mode.
import { WRAP_COORD_WGSL } from '../../../packages/sdk-browser/src/visibility/wrapModes.ts'
import { COLOR_SAMPLE_WGSL } from '../../../packages/sdk-browser/src/webgpu/tile/wgsl.ts'
import { functionText } from '../../../packages/sdk-browser/src/bounce/wgslBody.fixture.ts'
import { runOnDawn } from '../kit/onDawn.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { wgslProgram } from '../../../packages/math/src/wgsl/assemble.ts'

/** One texture, its RGBA8 bytes, read as a `texture_2d_array` by every batch. */
interface TapTexture {
  width: number
  height: number
  bytes: Uint8Array<ArrayBuffer>
}

/** One render: a texture, an address mode pair, a filter, and the UV and flag pairs it samples. */
export interface TapBatch {
  filter: GPUFilterMode
  texture: number
  addressS: GPUAddressMode
  addressT: GPUAddressMode
  uv: number[]
  flags: number[]
}

/** The bit that, in these taps only, asks for the seam blend: nearest batches want one texel,
 *  linear ones the full read. `wrapUv` reads only the word's low nibble: no wrap mode holds it. */
export const BLEND_BIT = 0x80000000

/** The seam of a repeating period as the atlas reads take it (`webgpu/tile/wgsl.ts`,
 *  `colorLevel`): its four fetches and their mix, read from the engine's own text, each fetch of the
 *  pool turned into a tap of the test texture through the sampler in clamp. */
function seamRead() {
  const level = functionText(COLOR_SAMPLE_WGSL, 'colorLevel')
  const seam = level.slice(level.indexOf(' let s00='))
  const fetch = /colorFetch\(s,(.+?),level,finest,nearest\)/g
  if (seam.match(fetch)?.length !== 4 || !seam.includes('return mix('))
    throw new Error(`the atlas reads no longer blend a seam from four fetches:\n${level}`)
  return `fn seamRead(t:WrapTaps)->vec4f{\n${seam.replace(fetch, 'textureSampleLevel(maps,engineSampler,$1,0,0.0)')}\n}`
}

/**
 * The taps' shader: the engine's wrap WGSL through a sampler in clamp, as the atlas samples its
 * pool, on target 0; the raw coordinate through the sampler set to the map's mode on target 1.
 */
const tapsWgsl = () =>
  wgslProgram(
    `struct Tap{uv:vec2f,flags:u32,pad:u32,}
@group(0) @binding(0) var maps:texture_2d_array<f32>;
@group(0) @binding(1) var engineSampler:sampler;
@group(0) @binding(2) var mapSampler:sampler;
@group(0) @binding(3) var<storage,read> taps:array<Tap>;
${seamRead()}
struct Read{@location(0) engine:vec4f,@location(1) sampler:vec4f,}
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
 let p=array(vec2f(-1.0,-1.0),vec2f(3.0,-1.0),vec2f(-1.0,3.0));return vec4f(p[i],0.0,1.0);
}
@fragment fn fs(@builtin(position) q:vec4f)->Read{
 let c=taps[u32(q.x)];
 let t=wrapUv(c.uv,c.flags,vec2f(textureDimensions(maps,0)));
 var read=textureSampleLevel(maps,engineSampler,t.proche,0,0.0);
 if((c.flags&${BLEND_BIT}u)!=0u&&t.couture){read=seamRead(t);}
 return Read(read,textureSampleLevel(maps,mapSampler,c.uv,0,0.0));
}`,
    [WRAP_COORD_WGSL],
  )

type Input = { code: string; textures: TapTexture[]; batches: TapBatch[] }

/** One render per batch, both targets read back. */
async function sample({ code, textures, batches }: Input) {
  const opened = await openGpuDevice()
  if (!opened) throw new Error('no WebGPU adapter')
  const { device, errors } = opened
  const { module, compilation } = await opened.compile(code)
  if (compilation.length) throw new Error(compilation.join('\n'))
  const target: GPUColorTargetState = { format: 'rgba32float' }
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module },
    fragment: { module, targets: [target, target] },
  })
  const views = textures.map(({ width, height, bytes }) => {
    const texture = device.createTexture({
      size: [width, height, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    device.queue.writeTexture({ texture }, bytes, { bytesPerRow: width * 4 }, [width, height])
    return texture.createView({ dimension: '2d-array' })
  })
  const reads: { engine: number[]; sampler: number[] }[] = []
  for (const batch of batches) {
    const n = batch.uv.length / 2
    const data = new ArrayBuffer(n * 16)
    const floats = new Float32Array(data),
      words = new Uint32Array(data)
    for (let i = 0; i < n; i++) {
      floats.set([batch.uv[i * 2], batch.uv[i * 2 + 1]], i * 4)
      words[i * 4 + 2] = batch.flags[i]
    }
    const taps = device.createBuffer({
      size: n * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(taps, 0, data)
    const sampler = (addressModeU: GPUAddressMode, addressModeV: GPUAddressMode) =>
      device.createSampler({
        addressModeU,
        addressModeV,
        magFilter: batch.filter,
        minFilter: batch.filter,
      })
    const group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: views[batch.texture] },
        { binding: 1, resource: sampler('clamp-to-edge', 'clamp-to-edge') },
        { binding: 2, resource: sampler(batch.addressS, batch.addressT) },
        { binding: 3, resource: { buffer: taps } },
      ],
    })
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    const targets = [0, 1].map(() =>
      device.createTexture({ size: [n, 1], format: 'rgba32float', usage }),
    )
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: targets.map((texture) => ({
        view: texture.createView(),
        loadOp: 'clear',
        storeOp: 'store',
      })),
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, group)
    pass.draw(3)
    pass.end()
    const row = Math.ceil((n * 16) / 256) * 256
    const readbacks = targets.map((texture) => {
      const usage = GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      const buffer = device.createBuffer({ size: row, usage })
      encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: row }, [n, 1])
      return buffer
    })
    device.queue.submit([encoder.finish()])
    const [engine, native] = await Promise.all(
      readbacks.map(async (buffer) => {
        await buffer.mapAsync(GPUMapMode.READ)
        return Array.from(new Float32Array(buffer.getMappedRange().slice(0, n * 16)))
      }),
    )
    reads.push({ engine, sampler: native })
    for (const resource of [taps, ...targets, ...readbacks]) resource.destroy()
  }
  await opened.fermer()
  return { errors, reads }
}

/** Each batch's reads, engine and sampler, four floats a tap; nothing may go wrong on the device. */
export async function sampleOnDawn(textures: TapTexture[], batches: TapBatch[]) {
  const { errors, reads } = await runOnDawn(sample, { code: tapsWgsl(), textures, batches })
  if (errors.length) throw new Error(errors.join('\n'))
  return reads
}
