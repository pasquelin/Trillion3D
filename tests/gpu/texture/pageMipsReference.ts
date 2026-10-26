// The reference image of the page-texture chain's class-2 bound: the plain reduction, one level
// drawn into a render target of the pool format — its sRGB encode the target's own.
import { FULLSCREEN_XY } from '../../../packages/sdk-browser/src/gpu/shader/fullscreenTriangle.ts'
import { wgslProgram } from '../../../packages/math/src/wgsl/assemble.ts'

/** One chain of the proof: its pool format, size and level 0's RGBA8 bytes. */
export interface ChainCase {
  name: string
  format: 'rgba8unorm' | 'rgba8unorm-srgb'
  width: number
  height: number
  texels: Uint8Array<ArrayBuffer>
}

const REFERENCE_WGSL = wgslProgram(
  `
 @group(0) @binding(0) var source:texture_2d<f32>;
 @group(0) @binding(1) var<uniform> extent:vec4u;
 @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
  return vec4f(${FULLSCREEN_XY},0.0,1.0);
 }
 @fragment fn fs(@builtin(position) pos:vec4f)->@location(0) vec4f{
  let p=vec2i(pos.xy)*2;let hi=vec2i(extent.xy)-vec2i(1);
  let s0=textureLoad(source,min(p,hi),0);let s1=textureLoad(source,min(p+vec2i(1,0),hi),0);
  let s2=textureLoad(source,min(p+vec2i(0,1),hi),0);let s3=textureLoad(source,min(p+vec2i(1,1),hi),0);
  return (s0+s1+s2+s3)*0.25;
 }`,
  [],
)

/** The reduction of `chain` in `texture` (its pool format, level 0 written), encoded into
 *  `encoder`; returns what to destroy once submitted. */
export function encodeReferenceChain(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  texture: GPUTexture,
  chain: ChainCase,
) {
  const { format } = chain
  const levels = texture.mipLevelCount
  const uniforms = device.createBuffer({
    size: levels * 256,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  // Each level's block: the extent of the level above it.
  const packed = new Uint32Array(levels * 64)
  for (let level = 1; level < levels; level++)
    packed.set(
      [Math.max(1, chain.width >> (level - 1)), Math.max(1, chain.height >> (level - 1))],
      level * 64,
    )
  device.queue.writeBuffer(uniforms, 0, packed)
  const views = Array.from({ length: levels }, (_, level) =>
    texture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
  )
  const module = device.createShaderModule({ code: REFERENCE_WGSL })
  const reduce = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
  })
  for (let level = 1; level < levels; level++) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: views[level], loadOp: 'clear', storeOp: 'store' }],
    })
    pass.setPipeline(reduce)
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: reduce.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: views[level - 1] },
          { binding: 1, resource: { buffer: uniforms, offset: level * 256, size: 16 } },
        ],
      }),
    )
    pass.draw(3)
    pass.end()
  }
  return [uniforms]
}
