import { MAX_SHADOW_SLICES, SHADOW_RECORD_FLOATS } from '../../../../sdk-core/src/index.ts';
import type { ShadowTable } from '../../../../sdk-core/src/scene/light-shadow/table.ts';
import {
  SHADOW_PAGE,
  SHADOW_TABLE_ENTRIES,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { shadowDepthShader } from './depthModule.ts';
import { MAX_SHADOW_REGIONS, createShadowRecordPack } from './recordPack.ts';
import { createShadowFaceBindings } from './faceBindings.ts';
import { createCheckedShaderModule } from '../core/shaderModule.ts';
import { arrayView, layerPasses, layerViews, shadowPoolTexture } from './layers.ts';
import { createShadowTransmittance, type ShadowTransmittance } from './transmittance.ts';
import { shadowTransmittanceDraws } from './transmittanceDraws.ts';
import { shadowDepthDraws } from './depthDraws.ts';
import { shadowFreshDraws } from '../../webgpu/shadow/freshDraws.ts';
import { shadowGroupDraws } from './groupDraws.ts';
import { shadowBatchWrites } from './batchWrites.ts';
import { SHADOW_FACE_STRIDE as FACE_STRIDE } from './batchBudget.ts';
import { SHADOW_PASS } from '../../stage/passLabels.ts';

export { MAX_SHADOW_PAGES, MAX_SHADOW_REGIONS } from './recordPack.ts';

/** Bytes of the records, before the page table in the same buffer: where the table starts. */
export const SHADOW_TABLE_OFFSET = MAX_SHADOW_SLICES * SHADOW_RECORD_FLOATS * 4;
/** Bytes of the records then the page table, one buffer; the table sized to the session's window. */
const dataBytesOf = (tableEntries: number) => SHADOW_TABLE_OFFSET + tableEntries * 4;
/** Bytes of the buffers beside the pool — faces, records, a table of `tableEntries` (`plan.ts`). */
const shadowBufferBytes = (tableEntries: number) =>
  MAX_SHADOW_REGIONS * (FACE_STRIDE + 4) + dataBytesOf(tableEntries);
export const SHADOW_BUFFER_BYTES = shadowBufferBytes(SHADOW_TABLE_ENTRIES);
/** Bytes of a pool of `layers` of `poolSide` pages a side: one 32-bit depth texel each. */
export const shadowAtlasBytes = (poolSide: number, layers = 1) =>
  (poolSide * SHADOW_PAGE) ** 2 * 4 * layers;

export type GpuShadowAtlas = Awaited<ReturnType<typeof createGpuShadowAtlas>>;

/**
 * The shadow pool and what reads and fills it: a depth texture of `poolSide²` physical pages; one
 * buffer of the records then the session's whole page table, up front (`SHADOW_DATA_WGSL`); the
 * opaque resolve's page records; each drawn page's uniform, read by dynamic offset. The texture
 * waits for `sizePool`: the first frame that casts grants the pool its setting asks
 * (`../../webgpu/shadow/poolSize.ts`), the shading reading the placeholder until then.
 */
export async function createGpuShadowAtlas(
  device: GPUDevice,
  pageLayout: GPUBindGroupLayout,
  tableEntries = SHADOW_TABLE_ENTRIES,
) {
  const dataBytes = dataBytesOf(tableEntries),
    fixedBytes = shadowBufferBytes(tableEntries);
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
    const layout = device.createPipelineLayout({ bindGroupLayouts: [pageLayout, faces.layout] }),
      module = await createCheckedShaderModule(device, shadowDepthShader(device), 'SHADOW_DEPTH');
    const depthDraws = shadowDepthDraws(device, module, layout);
    const transmittanceDraws = shadowTransmittanceDraws(device, module, [pageLayout, faces.layout]);
    const freshDraws = shadowFreshDraws(device, module, faces.layout);
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
      /** The draws of the pages the GPU draws itself (`freshDraws.ts`), then the moving groups'. */
      freshDraws,
      groupDraws: shadowGroupDraws(device, module, freshDraws.pageLayout, faces.layout),
      /** True when region `index`'s face carries an emitter envelope: only a fragment discards it. */
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
      /** Takes the pool's texture — granted or made now — once, before the first page is drawn:
       *  the pool keeps that size (`../../webgpu/shadow/poolSize.ts`). */
      sizePool(poolSide: number, layers = 1, granted = makePool(poolSide, layers)) {
        atlas.allocationBytes =
          fixedBytes + shadowAtlasBytes(poolSide, layers) + (transmittance?.bytes ?? 0);
        atlas.size = poolSide * SHADOW_PAGE;
        texture = granted;
        atlas.view = arrayView(granted);
        atlas.targets = layerViews(granted);
        atlas.passes = layerPasses(SHADOW_PASS, atlas.targets);
        pack.setPoolSide(poolSide);
      },
      /** Compiles the transmittance layer's draws off the frame (`shadowTransmittanceDraws`). */
      prepareTransmittance: transmittanceDraws.prepare,
      /** A transmittance layer for the pool of `targets`, `side` pages a side — the sized one by
       *  default —, made now, not yet taken: what the grant asks for (`transmittanceGrant.ts`). */
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
      /** The layer held, cleared by `encoder` the first frame a blended caster holds a row. */
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
      /** Pushes the records and page-table words that changed, alone — into the table, or to
       *  `words` when the GPU allocates (`webgpu/shadow/allocPass.ts`). */
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
