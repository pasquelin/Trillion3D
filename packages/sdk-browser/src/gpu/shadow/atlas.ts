import { MAX_SHADOW_SLICES, SHADOW_RECORD_FLOATS } from '../../../../sdk-core/src/index.ts';
import type { ShadowTable } from '../../../../sdk-core/src/scene/light-shadow/table.ts';
import {
  SHADOW_PAGE,
  SHADOW_TABLE_ENTRIES,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { SHADOW_DEPTH_SHADER } from './shader.ts';
import { MAX_SHADOW_REGIONS, createShadowRecordPack } from './recordPack.ts';
import { createShadowFaceBindings } from './faceBindings.ts';
import { createCheckedShaderModule } from '../core/shaderModule.ts';
import { arrayView, layerPasses, layerViews, shadowPoolTexture } from './layers.ts';
import { createShadowTransmittance, type ShadowTransmittance } from './transmittance.ts';
import { shadowTransmittanceDraws } from './transmittanceDraws.ts';
import { shadowDepthDraws } from './depthDraws.ts';
import { shadowFreshDraws } from '../../webgpu/shadow/freshDraws.ts';
import { shadowBatchWrites } from './batchWrites.ts';
import { SHADOW_FACE_STRIDE as FACE_STRIDE } from './batchBudget.ts';

export { MAX_SHADOW_PAGES, MAX_SHADOW_REGIONS } from './recordPack.ts';

/** Label of the measured pass; `gpuShadowsMs` is read under this name. */
export const SHADOW_PASS = 'Trillion3D shadow atlas v1';
/** Bytes of the records, before the page table in the same buffer: where the table starts. */
export const SHADOW_TABLE_OFFSET = MAX_SHADOW_SLICES * SHADOW_RECORD_FLOATS * 4;
/** Bytes of the records then the page table, one buffer; the table sized to the session's window. */
const dataBytesOf = (tableEntries: number) => SHADOW_TABLE_OFFSET + tableEntries * 4;
/** Bytes of the buffers beside the pool — the faces, the records and page table: fixed by the
 *  light contract, the same on every screen, so the memory budget counts them. The ordinary
 *  window; a reference session raises the table (`referenceMode.ts`). */
export const SHADOW_BUFFER_BYTES =
  MAX_SHADOW_REGIONS * (FACE_STRIDE + 4) + dataBytesOf(SHADOW_TABLE_ENTRIES);
/** Bytes of a pool of `layers` of `poolSide` pages a side: one 32-bit depth texel each. */
export const shadowAtlasBytes = (poolSide: number, layers = 1) =>
  (poolSide * SHADOW_PAGE) ** 2 * 4 * layers;

export type GpuShadowAtlas = Awaited<ReturnType<typeof createGpuShadowAtlas>>;

/**
 * The shadow pool and what reads and fills it: a depth texture of `poolSide²` physical pages; one
 * buffer holding every light's record then the page table (`SHADOW_DATA_WGSL`); the buffer the
 * opaque resolve records the pages it read in; and the uniform of each page a frame draws, read
 * by dynamic offset.
 *
 * The texture waits for `sizePool`: its side is derived from the screen the first frame draws
 * (`shadowPoolSize`), which the world may not know when it prepares — until then no page exists
 * and the shading reads the placeholder.
 */
export async function createGpuShadowAtlas(
  device: GPUDevice,
  pageLayout: GPUBindGroupLayout,
  tableEntries = SHADOW_TABLE_ENTRIES,
) {
  const dataBytes = dataBytesOf(tableEntries),
    fixedBytes = MAX_SHADOW_REGIONS * (FACE_STRIDE + 4) + dataBytes;
  let texture: GPUTexture | undefined,
    transmittance: ShadowTransmittance | undefined,
    cleared = false;
  // Also storage, read by the occlusion test and the page quads; after the faces, the batch's
  // regions in pass order (`pageQuads.ts`).
  const faceUniform = device.createBuffer({
    label: 'Trillion3D shadow faces v1',
    size: MAX_SHADOW_REGIONS * (FACE_STRIDE + 4),
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const dataBuffer = device.createBuffer({
    label: 'Trillion3D shadow records and page table v1',
    size: dataBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const pack = createShadowRecordPack(FACE_STRIDE, 1),
    { records, facePacked } = pack;
  const faces = createShadowFaceBindings(device, faceUniform);
  const release = () => {
    texture?.destroy();
    transmittance?.destroy();
    faceUniform.destroy();
    faces.destroy();
    dataBuffer.destroy();
  };
  try {
    const module = await createCheckedShaderModule(device, SHADOW_DEPTH_SHADER, 'SHADOW_DEPTH');
    const layout = device.createPipelineLayout({ bindGroupLayouts: [pageLayout, faces.layout] });
    const depthDraws = shadowDepthDraws(device, module, layout);
    const transmittanceDraws = shadowTransmittanceDraws(device, module, [pageLayout, faces.layout]);
    const makePool = (poolSide: number, layers: number) =>
      shadowPoolTexture(device, poolSide, layers);
    const atlas = {
      /** Texels a side, zero until the pool is sized. */
      size: 0,
      get texture() {
        return texture;
      },
      /** The transmittance layer (`transmittance.ts`), read from the first blended caster on. */
      get transmittance() {
        return cleared ? transmittance : undefined;
      },
      /** True once the transmittance layer is held, read or not yet. */
      get transmittanceHeld() {
        return !!transmittance;
      },
      view: undefined as GPUTextureView | undefined,
      targets: [] as GPUTextureView[],
      passes: [] as GPURenderPassDescriptor[],
      dataBuffer,
      /** Host mirror of the records: what the shading rereads. */
      records: records as Readonly<Float32Array>,
      /** Compiles the pool's draws off the frame (`shadowDepthDraws`), at prepare. */
      prepareDepth: depthDraws.prepare,
      /** The pool's draws, compiled by `prepareDepth` or, failing it, now. */
      depthDraws: depthDraws.made,
      /** The draws of the pages the GPU draws itself (`../../webgpu/shadow/freshDraws.ts`). */
      freshDraws: shadowFreshDraws(device, module, faces.layout),
      /** True when region `index`'s face carries an emitter envelope, which only a fragment
       *  discards. */
      hasEnvelope: pack.hasEnvelope,
      /** Group 1 of a region's draws: its face, and what the cutouts ask (`faceBindings.ts`). */
      get faceGroup() {
        return faces.group;
      },
      /** What this image's cutouts ask of the colour tiles (`faceBindings.ts`). */
      cutoutRequests: faces.requests,
      faceUniform,
      faceStride: FACE_STRIDE,
      allocationBytes: fixedBytes,
      makePool,
      /** Takes the pool's texture — the one the device granted, or one made now — before the first
       *  page is drawn; again at a resize (`../../webgpu/shadow/poolResize.ts`), with the
       *  transmittance layer made for it when one is held. Returns what it held then, which the
       *  caller copies from and destroys. */
      sizePool(
        poolSide: number,
        layers = 1,
        granted = makePool(poolSide, layers),
        layer = transmittance,
      ) {
        const held = texture && { texture, transmittance };
        atlas.allocationBytes =
          fixedBytes + shadowAtlasBytes(poolSide, layers) + (layer?.bytes ?? 0);
        atlas.size = poolSide * SHADOW_PAGE;
        texture = granted;
        transmittance = layer;
        atlas.view = arrayView(granted);
        atlas.targets = layerViews(granted);
        atlas.passes = layerPasses(SHADOW_PASS, atlas.targets);
        pack.setPoolSide(poolSide);
        return held;
      },
      /** Compiles the transmittance layer's draws off the frame (`shadowTransmittanceDraws`). */
      prepareTransmittance: transmittanceDraws.prepare,
      /** A transmittance layer for the pool of `targets`, `side` pages a side — the sized one by
       *  default —, made now, not yet taken: what the shadows' grant asks the device for
       *  (`../../webgpu/shadow/transmittanceGrant.ts`). */
      makeTransmittance(targets?: GPUTextureView[], side?: number) {
        const layers = targets ?? atlas.targets,
          pages = side ?? atlas.size / SHADOW_PAGE;
        return createShadowTransmittance(device, transmittanceDraws.made(), layers, pages);
      },
      /** Takes the layer the device granted, once; its bytes are held from now on. */
      takeTransmittance(layer: ShadowTransmittance) {
        if (transmittance) throw new Error('the transmittance layer is taken once');
        transmittance = layer;
        atlas.allocationBytes += layer.bytes;
      },
      /** The layer held, cleared by `encoder` the first time: the first frame a blended caster
       *  holds a row. Nothing while none is held. */
      readTransmittance(encoder: GPUCommandEncoder) {
        if (transmittance && !cleared) {
          transmittance.clear(encoder);
          cleared = true;
        }
        return atlas.transmittance;
      },
      writePage: pack.writePage,
      writeLamp: pack.writeLamp,
      writeSun: pack.writeSun,
      clearRecord: pack.clear,
      flushPages(count: number) {
        if (count)
          shadowBatchWrites(device).write(faceUniform, 0, facePacked, 0, (count * FACE_STRIDE) / 4);
      },
      /** Pushes the records that changed, and them alone. */
      flushRecords() {
        pack.flush((slice) => {
          const first = slice * SHADOW_RECORD_FLOATS;
          device.queue.writeBuffer(dataBuffer, first * 4, records, first, SHADOW_RECORD_FLOATS);
        });
      },
      /** Pushes the records that changed, and the page-table words that did, and them alone —
       *  into the table, or to `words` when the GPU allocates (`webgpu/shadow/allocPass.ts`). */
      flushData(table: ShadowTable, words?: (first: number, count: number) => void) {
        const at = SHADOW_TABLE_OFFSET;
        atlas.flushRecords();
        table.flush(
          words ?? ((i, n) => device.queue.writeBuffer(dataBuffer, at + i * 4, table.words, i, n)),
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
