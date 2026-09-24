import { MAX_SHADOW_SLICES, SHADOW_RECORD_FLOATS } from '../../../../sdk-core/src/index.ts';
import type { ShadowTable } from '../../../../sdk-core/src/scene/light-shadow/table.ts';
import {
  SHADOW_PAGE,
  SHADOW_TABLE_ENTRIES,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { SHADOW_DEPTH_SHADER } from './shader.ts';
import { MAX_SHADOW_REGIONS, createShadowRecordPack } from './recordPack.ts';
import { createCheckedShaderModule } from '../core/shaderModule.ts';
import { DEPTH_COMPARE } from '../../camera/depthConvention.ts';
import { SHADOW_REQUEST_WORDS } from '../../lighting/direct/shadowWgsl.ts';

export { MAX_SHADOW_PAGES, MAX_SHADOW_REGIONS } from './recordPack.ts';

/** Label of the measured pass; `gpuShadowsMs` is read under this name. */
export const SHADOW_PASS = 'Trillion3D shadow atlas v1';
/** Alignment of a dynamic uniform offset: one drawn page per 256-byte entry. */
const FACE_STRIDE = 256;
/** Bytes actually read of an entry: the matrix, the atlas rectangle, the light envelope. */
const FACE_BYTES = 96;
/** Bytes of the records, before the page table in the same buffer. */
const RECORD_BYTES = MAX_SHADOW_SLICES * SHADOW_RECORD_FLOATS * 4;
/** Bytes of the records then the page table, one buffer; of the request buffer. */
const DATA_BYTES = RECORD_BYTES + SHADOW_TABLE_ENTRIES * 4,
  REQUEST_BYTES = SHADOW_REQUEST_WORDS * 4;
/** Bytes of the buffers beside the pool — the faces, the records and page table, the requests:
 *  fixed by the light contract, the same on every screen, so the memory budget counts them. */
export const SHADOW_BUFFER_BYTES = MAX_SHADOW_REGIONS * FACE_STRIDE + DATA_BYTES + REQUEST_BYTES;
/** Bytes of a pool of `poolSide` pages a side: one 32-bit depth texel each. */
export const shadowAtlasBytes = (poolSide: number) => (poolSide * SHADOW_PAGE) ** 2 * 4;

export type GpuShadowAtlas = Awaited<ReturnType<typeof createGpuShadowAtlas>>;

/**
 * The shadow pool and what reads and fills it: a depth texture of `poolSide²` physical pages; one
 * buffer holding every light's record then the page table (`SHADOW_DATA_WGSL`); the buffer the
 * opaque resolve records the pages it read in; and the uniform of each page a frame draws, read
 * by dynamic offset.
 *
 * The texture waits for `sizePool`: its side is derived from the screen the first frame draws
 * (`shadowPoolSide`), which the world may not know when it prepares — until then no page exists
 * and the shading reads the placeholder.
 */
export async function createGpuShadowAtlas(device: GPUDevice, pageLayout: GPUBindGroupLayout) {
  let texture: GPUTexture | undefined;
  // Also storage: the occlusion test of the moving casters reads each region's matrix there.
  const faceUniform = device.createBuffer({
    label: 'Trillion3D shadow faces v1',
    size: MAX_SHADOW_REGIONS * FACE_STRIDE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const dataBuffer = device.createBuffer({
    label: 'Trillion3D shadow records and page table v1',
    size: DATA_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const requestBuffer = device.createBuffer({
    label: 'Trillion3D shadow requests v1',
    size: REQUEST_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  const pack = createShadowRecordPack(FACE_STRIDE, 1),
    { records, facePacked } = pack;
  const release = () => {
    texture?.destroy();
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
      label: 'Trillion3D shadow page clear v1',
      layout,
      vertex: { module, entryPoint: 'shadow_clear_vs' },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depthState('always'),
    });
    const faceGroup = device.createBindGroup({
      layout: faceLayout,
      entries: [{ binding: 0, resource: { buffer: faceUniform, size: FACE_BYTES } }],
    });
    const atlas = {
      /** Texels a side, zero until the pool is sized. */
      size: 0,
      get texture() {
        return texture;
      },
      view: undefined as GPUTextureView | undefined,
      dataBuffer,
      requestBuffer,
      /** Host mirror of the records: what the shading rereads. */
      records: records as Readonly<Float32Array>,
      depth,
      clear,
      faceGroup,
      faceUniform,
      faceStride: FACE_STRIDE,
      allocationBytes: SHADOW_BUFFER_BYTES,
      /**
       * Creates the pool's texture, `poolSide²` pages: once, before the first page is drawn.
       * `COPY_SRC` is there only for the proof: the host can reread the pool and compare its
       * fingerprint between two runs. No frame pass copies it.
       */
      sizePool(poolSide: number) {
        if (texture) throw new Error('the shadow pool is sized once');
        atlas.size = poolSide * SHADOW_PAGE;
        texture = device.createTexture({
          label: 'Trillion3D shadow depth atlas v1',
          size: [atlas.size, atlas.size, 1],
          format: 'depth32float',
          usage:
            GPUTextureUsage.RENDER_ATTACHMENT |
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_SRC,
        });
        atlas.view = texture.createView();
        atlas.allocationBytes += shadowAtlasBytes(poolSide);
        pack.setPoolSide(poolSide);
      },
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
    return atlas;
  } catch (error) {
    release();
    throw error;
  }
}
