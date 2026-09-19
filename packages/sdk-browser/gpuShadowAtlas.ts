import {
  LIGHT_SETTINGS,
  MAX_SHADOW_SLICES,
  POINT_FACES,
  RECTS_PER_SLICE,
  SHADOW_FACE_FLOATS,
  SHADOW_SLICE_FLOATS,
} from '../sdk-core/index.ts';
import { SHADOW_DEPTH_SHADER } from './gpuShadowShader.ts';
import { createCheckedShaderModule } from './gpuShaderModule.ts';
import { DEPTH_COMPARE } from './depthConvention.ts';

/** Label of the measured pass; `gpuShadowsMs` is read under this name. */
export const SHADOW_PASS = 'WG shadow atlas v1';
/** Alignment of a dynamic uniform offset: one region per 256-byte entry. */
const FACE_STRIDE = 256;
/** Bytes actually read of an entry: the matrix, the atlas rectangle, the light envelope. */
const FACE_BYTES = 96;
/**
 * Regions at most in a frame: the buffer cap, not a quality setting. A wholly stale face fits
 * in a single region, so this cap is at least what the old four-light cap allowed; the
 * millisecond budget almost always stops first.
 */
export const MAX_SHADOW_REGIONS = LIGHT_SETTINGS.shadowUpdatesPerFrame * POINT_FACES;
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
    label: 'WG shadow depth atlas v1',
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
    label: 'WG shadow faces v1',
    size: MAX_SHADOW_REGIONS * FACE_STRIDE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const sliceBuffer = device.createBuffer({
    label: 'WG shadow slices v1',
    size: MAX_SHADOW_SLICES * SHADOW_SLICE_FLOATS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const slicePacked = new Float32Array(MAX_SHADOW_SLICES * SHADOW_SLICE_FLOATS);
  const facePacked = new Float32Array((MAX_SHADOW_REGIONS * FACE_STRIDE) / 4);
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
      label: 'WG shadow depth v1',
      layout,
      vertex: { module, entryPoint: 'shadow_vs' },
      // No colour target: the fragment stage exists only to discard an opacity-mask cutout, and
      // returns nothing.
      fragment: { module, entryPoint: 'shadow_fs', targets: [] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depthState(DEPTH_COMPARE),
    });
    const clear = device.createRenderPipeline({
      label: 'WG shadow slice clear v1',
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
      /**
       * Writes a region into both buffers: that of the frame matrices, read by dynamic offset,
       * and that of the slices, reread by deferred resolve. The matrix is that of the whole
       * face, never of the region: that is what makes the page draw identical to the bit.
       * `matrices` carries it at `matrixBase`; nothing is copied into an intermediate array, and
       * two regions of the same face rewrite the same numbers there.
       *
       * `center` and `radius` tell the light envelope to the only buffer that reads it, the
       * draw one: the shadow shader writes no depth for a surface locked inside it. A light
       * without an envelope — a directional, or a light with no declared radius — carries a
       * zero radius, and the comparison then strips nothing.
       */
      writeRegion(
        index: number,
        slice: number,
        face: number,
        matrices: Float32Array,
        matrixBase: number,
        rects: Int32Array,
        center: readonly number[] | undefined,
        radius: number,
      ) {
        const rect = slice * RECTS_PER_SLICE + face * 3,
          x = rects[rect] / size,
          y = rects[rect + 1] / size,
          side = rects[rect + 2];
        const uniform = (index * FACE_STRIDE) / 4,
          entry = slice * SHADOW_SLICE_FLOATS + face * SHADOW_FACE_FLOATS;
        for (let i = 0; i < 16; i++) {
          facePacked[uniform + i] = matrices[matrixBase + i];
          slicePacked[entry + i] = matrices[matrixBase + i];
        }
        const span = side / size;
        facePacked[uniform + 16] = x;
        facePacked[uniform + 17] = y;
        facePacked[uniform + 18] = span;
        facePacked[uniform + 19] = side;
        slicePacked[entry + 16] = x;
        slicePacked[entry + 17] = y;
        slicePacked[entry + 18] = span;
        slicePacked[entry + 19] = side > 0 ? 1 : 0;
        facePacked[uniform + 20] = center ? center[0] : 0;
        facePacked[uniform + 21] = center ? center[1] : 0;
        facePacked[uniform + 22] = center ? center[2] : 0;
        facePacked[uniform + 23] = center ? radius : 0;
        return side;
      },
      flushRegions(count: number) {
        if (count)
          device.queue.writeBuffer(faceUniform, 0, facePacked, 0, (count * FACE_STRIDE) / 4);
      },
      /** Slice header: faces, tangent half-angle, side in texels, near plane. */
      writeSliceInfo(slice: number, faces: number, tanHalfFov: number, side: number, near: number) {
        const base = slice * SHADOW_SLICE_FLOATS + POINT_FACES * SHADOW_FACE_FLOATS;
        slicePacked[base] = faces;
        slicePacked[base + 1] = tanHalfFov;
        slicePacked[base + 2] = side;
        slicePacked[base + 3] = near;
      },
      /**
       * Pushes the slices the scheduler just redrew, and them alone: the others already describe
       * the frame on the GPU. The atlas writes what it is given and does not keep the list of
       * what it wrote — whoever decides what to redraw already knows it.
       */
      flushSlices(slices: Int32Array, count: number) {
        for (let i = 0; i < count; i++) {
          const first = slices[i] * SHADOW_SLICE_FLOATS;
          device.queue.writeBuffer(sliceBuffer, first * 4, slicePacked, first, SHADOW_SLICE_FLOATS);
        }
      },
      dispose: release,
    };
  } catch (error) {
    release();
    throw error;
  }
}
