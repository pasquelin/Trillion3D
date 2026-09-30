import type { CompressedImage } from '../../../sdk-core/src/texture/compressed.ts';
import { uploadCompressed } from './compressedUpload.ts';
import { COMPRESSED_COPY_WGSL } from './compressedCopyWgsl.ts';
import { heldBuffer } from './mips.ts';

type Program = { pipeline: GPURenderPipeline; layout: GPUBindGroupLayout };
const programs = new WeakMap<GPUDevice, Map<GPUTextureFormat, Program>>();

/** Reads native blocks on the GPU into the existing atlas scratch; the CPU never expands pixels. */
export function copyCompressedBase(
  device: GPUDevice,
  image: CompressedImage,
  target: GPUTexture,
  format: GPUTextureFormat,
  flipY: boolean,
  premultiplyAlpha: boolean,
) {
  const source = uploadCompressed(device, { ...image, mipmaps: image.mipmaps.slice(0, 1) }, false);
  // A linear view stores the decoded byte values without applying an extra sRGB curve.
  const viewFormat = format.replace(/-srgb$/, '') as GPUTextureFormat;
  try {
    let variants = programs.get(device);
    if (!variants) programs.set(device, (variants = new Map()));
    let program = variants.get(viewFormat);
    if (!program) {
      const module = device.createShaderModule({ code: COMPRESSED_COPY_WGSL });
      const layout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        ],
      });
      const pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: 'fullscreen' },
        fragment: { module, entryPoint: 'copyBlocks', targets: [{ format: viewFormat }] },
        primitive: { topology: 'triangle-list' },
      });
      program = { layout, pipeline };
      variants.set(viewFormat, program);
    }
    const buffer = heldBuffer(
      device,
      'Trillion3D compressed image extent',
      16,
      GPUBufferUsage.UNIFORM,
    );
    device.queue.writeBuffer(
      buffer,
      0,
      new Uint32Array([image.width, image.height, Number(flipY), Number(premultiplyAlpha)]),
    );
    const group = device.createBindGroup({
      layout: program.layout,
      entries: [
        { binding: 0, resource: source.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
        { binding: 1, resource: { buffer } },
      ],
    });
    const encoder = device.createCommandEncoder({ label: 'Trillion3D compressed source copy' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: target.createView({ format: viewFormat, baseMipLevel: 0, mipLevelCount: 1 }),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: [0, 0, 0, 0],
        },
      ],
    });
    pass.setPipeline(program.pipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
  } finally {
    source.destroy();
  }
}
