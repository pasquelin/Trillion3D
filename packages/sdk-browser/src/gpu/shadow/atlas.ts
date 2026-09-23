import {
  LIGHT_SETTINGS,
  MAX_SHADOW_SLICES,
  SHADOW_RECORD_FLOATS,
} from '../../../../sdk-core/src/index.ts';
import type { ShadowTable } from '../../../../sdk-core/src/scene/light-shadow/table.ts';
import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { SHADOW_DEPTH_SHADER } from './shader.ts';
import { MAX_SHADOW_REGIONS, createShadowRecordPack } from './recordPack.ts';
import { createCheckedShaderModule } from '../core/shaderModule.ts';
import { DEPTH_COMPARE } from '../../camera/depthConvention.ts';
import { SHADOW_REQUEST_WORDS } from '../../lighting/direct/shadowWgsl.ts';

export { MAX_SHADOW_PAGES, MAX_SHADOW_REGIONS } from './recordPack.ts';

/** Label of the measured pass; `gpuShadowsMs` is read under this name. */
export const SHADOW_PASS = 'WG shadow atlas v1';
/** Alignment of a dynamic uniform offset: one drawn page per 256-byte entry. */
const FACE_STRIDE = 256;
/** Bytes actually read of an entry: the matrix, the atlas rectangle, the light envelope. */
const FACE_BYTES = 96;
/** Bytes of the records, before the page table in the same buffer. */
const RECORD_BYTES = MAX_SHADOW_SLICES * SHADOW_RECORD_FLOATS * 4;
/** Bytes of a pool of `poolSide` pages a side: one 32-bit depth texel each. */
export const shadowAtlasBytes = (poolSide: number) => (poolSide * SHADOW_PAGE) ** 2 * 4;

export type GpuShadowAtlas = Awaited<ReturnType<typeof createGpuShadowAtlas>>;

/**
 * The shadow pool and what reads and fills it: a depth texture of `poolSide²` physical pages
 * (`shadowPoolSide`, derived from the screen when the world is created); one
 * buffer holding every light's record then the page table (`SHADOW_DATA_WGSL`); the buffer the
 * opaque resolve records the pages it read in; and the uniform of each page a frame draws, read
 * by dynamic offset.
 */
export async function createGpuShadowAtlas(
  device: GPUDevice,
  pageLayout: GPUBindGroupLayout,
  poolSide: number,
) {
  const size = poolSide * SHADOW_PAGE;
  const texture = device.createTexture({
    label: 'WG shadow depth atlas v1',
    size: [size, size, 1],
    format: 'depth32float',
    // `COPY_SRC` is there only for the proof: the host can reread the pool and compare its
    // fingerprint between two runs. No frame pass copies it.
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC,
  });
  // Also storage: the occlusion test of the moving casters reads each region's matrix there.
  const faceUniform = device.createBuffer({
    label: 'WG shadow faces v1',
    size: MAX_SHADOW_REGIONS * FACE_STRIDE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const dataBuffer = device.createBuffer({
    label: 'WG shadow records and page table v1',
    size: RECORD_BYTES + LIGHT_SETTINGS.shadowTableEntries * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const requestBuffer = device.createBuffer({
    label: 'WG shadow requests v1',
    size: SHADOW_REQUEST_WORDS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  const pack = createShadowRecordPack(FACE_STRIDE, poolSide),
    { records, facePacked } = pack;
  const release = () => {
    texture.destroy();
    faceUniform.destroy();
    dataBuffer.destroy();
    requestBuffer.destroy();
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
      label: 'WG shadow page clear v1',
      layout,
      vertex: { module, entryPoint: 'shadow_clear_vs' },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depthState('always'),
    });
    const faceGroup = device.createBindGroup({
      layout: faceLayout,
      entries: [{ binding: 0, resource: { buffer: faceUniform, size: FACE_BYTES } }],
    });
    return {
      size,
      texture,
      view: texture.createView(),
      dataBuffer,
      requestBuffer,
      /** Host mirror of the records: what the shading rereads. */
      records: records as Readonly<Float32Array>,
      depth,
      clear,
      faceGroup,
      faceUniform,
      faceStride: FACE_STRIDE,
      allocationBytes:
        shadowAtlasBytes(poolSide) + faceUniform.size + dataBuffer.size + requestBuffer.size,
      writePage: pack.writePage,
      writeLamp: pack.writeLamp,
      writeSun: pack.writeSun,
      clearRecord: pack.clear,
      flushPages(count: number) {
        if (count)
          device.queue.writeBuffer(faceUniform, 0, facePacked, 0, (count * FACE_STRIDE) / 4);
      },
      /** Pushes the records that changed, and the page-table words that did, and them alone. */
      flushData(table: ShadowTable) {
        pack.flush((slice) => {
          const first = slice * SHADOW_RECORD_FLOATS;
          device.queue.writeBuffer(dataBuffer, first * 4, records, first, SHADOW_RECORD_FLOATS);
        });
        table.flush((first, count) =>
          device.queue.writeBuffer(dataBuffer, RECORD_BYTES + first * 4, table.words, first, count),
        );
      },
      dispose: release,
    };
  } catch (error) {
    release();
    throw error;
  }
}
