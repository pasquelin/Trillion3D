import { retire } from '../../gpu/core/frameRetire.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { preparedPipeline } from '../deferred/fullscreen.ts'
import { postSamplers } from '../../gpu/core/postSamplers.ts'
import { RECT_ATLAS_ADD_PASS } from '../../diagnostic/stage/passLabels.ts'
import type { HostImage } from '../../../../sdk-core/src/contracts/hostImage.ts'

/** The format a picture is held in while it is drawn into the atlas: 8 bits a channel, read as a colour in the working space (sRGB decoded). */
export const PICTURE_FORMAT: GPUTextureFormat = 'rgba8unorm-srgb'

const MIP_WGSL = `
@group(0) @binding(0) var above:texture_2d<f32>;
@group(0) @binding(1) var aboveSampler:sampler;
@vertex fn fullscreen(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{return vec4f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1),0.0,1.0);}
@fragment fn halve(@builtin(position) p:vec4f)->@location(0) vec4f{
 // The pixel of the level under, read at the centre of the 2 by 2 texels over it.
 return textureSampleLevel(above,aboveSampler,p.xy/vec2f(max(textureDimensions(above)>>vec2u(1u),vec2u(1u))),0.0);
}`

/** The pipeline that draws a mip level of a picture from the one above, once a device. */
export const pictureProgram = oncePerDevice((device: GPUDevice) => {
  const module = device.createShaderModule({ label: RECT_ATLAS_ADD_PASS, code: MIP_WGSL })
  return preparedPipeline(device, {
    label: RECT_ATLAS_ADD_PASS,
    layout: 'auto',
    vertex: { module, entryPoint: 'fullscreen' },
    fragment: { module, entryPoint: 'halve', targets: [{ format: PICTURE_FORMAT }] },
    primitive: { topology: 'triangle-list' },
  })
})

/** The mip levels of a picture of `width` by `height`: down to one texel. */
export const pictureMipCount = (width: number, height: number) =>
  Math.floor(Math.log2(Math.max(width, height))) + 1

/**
 * A host picture as a texture with its whole mip chain, each level the box average of the one above (a bilinear read at the centre of 2 by 2
 * texels), for the atlas to read at the level a slot's size asks (`SourceTextureMIPBias`). Copied from the image when it is asked; handed to the
 * frame's retire list at once, the draw into the atlas that names it being already encoded: a picture the host changed is copied again at the
 * next draw (`invalidate`).
 */
export function pictureView(device: GPUDevice, encoder: GPUCommandEncoder, image: HostImage) {
  const levels = pictureMipCount(image.width, image.height)
  const texture = device.createTexture({
    label: 'Trillion3D rect light picture',
    size: [image.width, image.height],
    format: PICTURE_FORMAT,
    mipLevelCount: levels,
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  })
  device.queue.copyExternalImageToTexture(
    { source: image as unknown as GPUCopyExternalImageSource },
    { texture, premultipliedAlpha: false },
    { width: image.width, height: image.height },
  )
  const pipeline = pictureProgram(device).get()!
  const sampler = postSamplers(device).clamped
  for (let level = 1; level < levels; level++) {
    const pass = encoder.beginRenderPass({
      label: RECT_ATLAS_ADD_PASS,
      colorAttachments: [
        {
          view: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          {
            binding: 0,
            resource: texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }),
          },
          { binding: 1, resource: sampler },
        ],
      }),
    )
    pass.draw(3)
    pass.end()
  }
  retire(device, texture)
  return texture.createView()
}
