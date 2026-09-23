import {
  LIGHT_SETTINGS,
  MAX_SHADOW_SLICES,
  SHADOW_SLICE_FLOATS,
} from '../../../../sdk-core/src/index.ts';
import { SHADOW_DEPTH_SHADER } from './shader.ts';
import { MAX_SHADOW_REGIONS, createShadowSlicePack } from './slicePack.ts';
import { createCheckedShaderModule } from '../core/shaderModule.ts';
import { DEPTH_COMPARE } from '../../camera/depthConvention.ts';

export { MAX_SHADOW_REGIONS } from './slicePack.ts';

/** Label of the measured pass; `gpuShadowsMs` is read under this name. */
export const SHADOW_PASS = 'Trillion3D shadow atlas v1';
/** Alignment of a dynamic uniform offset: one region per 256-byte entry. */
const FACE_STRIDE = 256;
/** Bytes actually read of an entry: the matrix, the atlas rectangle, the light envelope. */
const FACE_BYTES = 96;
export const shadowAtlasBytes = () => LIGHT_SETTINGS.shadowAtlasSize ** 2 * 4;

export type GpuShadowAtlas = Awaited<ReturnType<typeof createGpuShadowAtlas>>;

/**
 * Depth shadow atlas: a 4096² texture, one slice per shadow light, six faces for a point light
 * and one for a spotlight. The slice buffer is what deferred resolve rereads; the face buffer
 * carries the frame's matrices, one per dynamic offset.
 */
export async function createGpuShadowAtlas(device: GPUDevice, pageLayout: GPUBindGroupLayout) {
  const size = LIGHT_SETTINGS.shadowAtlasSize;
  const texture = device.createTexture({
    label: 'Trillion3D shadow depth atlas v1',
    size: [size, size, 1],
    format: 'depth32float',
    // `COPY_SRC` is there only for the proof: the host can reread the atlas and compare its
    // fingerprint between a page redraw and a full redraw. No frame pass copies it.
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC,
  });
  const faceUniform = device.createBuffer({
    label: 'Trillion3D shadow faces v1',
    size: MAX_SHADOW_REGIONS * FACE_STRIDE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const sliceBuffer = device.createBuffer({
    label: 'Trillion3D shadow slices v1',
    size: MAX_SHADOW_SLICES * SHADOW_SLICE_FLOATS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const pack = createShadowSlicePack(size, FACE_STRIDE),
    { slicePacked, facePacked } = pack;
  const release = () => {
    texture.destroy();
    faceUniform.destroy();
    sliceBuffer.destroy();
  };
  try {
    const module = await createCheckedShaderModule(device, SHADOW_DEPTH_SHADER, 'SHADOW_DEPTH');
    const faceLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          // Also read at the fragment: it is what discards the emitter envelope.
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: FACE_BYTES },
        },
      ],
    });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [pageLayout, faceLayout] });
    const depthState = (compare: GPUCompareFunction): GPUDepthStencilState => ({
      format: 'depth32float',
      depthWriteEnabled: true,
      depthCompare: compare,
    });
    const depth = device.createRenderPipeline({
      label: 'Trillion3D shadow depth v1',
      layout,
      vertex: { module, entryPoint: 'shadow_vs' },
      // No colour target: the fragment stage exists only to discard an opacity-mask cutout, and
      // returns nothing.
      fragment: { module, entryPoint: 'shadow_fs', targets: [] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depthState(DEPTH_COMPARE),
    });
    const clear = device.createRenderPipeline({
      label: 'Trillion3D shadow slice clear v1',
      layout,
      vertex: { module, entryPoint: 'shadow_clear_vs' },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depthState('always'),
    });
    const faceGroup = device.createBindGroup({
      layout: faceLayout,
      entries: [{ binding: 0, resource: { buffer: faceUniform, size: FACE_BYTES } }],
    });
    const view = texture.createView();
    return {
      size,
      texture,
      view,
      sliceBuffer,
      /** Host mirror of the slice buffer: what the GPU rereads, never-redrawn faces included.
       *  Hardware resolve copies the sun slice from it into its uniform. */
      sliceMirror: slicePacked as Readonly<Float32Array>,
      depth,
      clear,
      faceGroup,
      faceStride: FACE_STRIDE,
      allocationBytes: shadowAtlasBytes() + faceUniform.size + sliceBuffer.size,
      writeRegion: pack.writeRegion,
      writeSliceInfo: pack.writeSliceInfo,
      writeDrawnMask: pack.writeDrawnMask,
      flushRegions(count: number) {
        if (count)
          device.queue.writeBuffer(faceUniform, 0, facePacked, 0, (count * FACE_STRIDE) / 4);
      },
      /**
       * Pushes the slices written since the last flush — a region drawn, a held mask or an
       * origin moved —, and them alone: the others already describe the frame on the GPU.
       */
      flushSlices() {
        pack.flushSlices((slice) => {
          const first = slice * SHADOW_SLICE_FLOATS;
          device.queue.writeBuffer(sliceBuffer, first * 4, slicePacked, first, SHADOW_SLICE_FLOATS);
        });
      },
      dispose: release,
    };
  } catch (error) {
    release();
    throw error;
  }
}
