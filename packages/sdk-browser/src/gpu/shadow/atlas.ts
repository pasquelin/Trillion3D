import { MAX_SHADOW_SLICES, SHADOW_RECORD_FLOATS } from '../../../../sdk-core/src/index.ts';
import type { ShadowTable } from '../../../../sdk-core/src/scene/light-shadow/table.ts';
import {
  SHADOW_PAGE,
  SHADOW_TABLE_ENTRIES,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { SHADOW_DEPTH_SHADER } from './shader.ts';
import {
  MAX_SHADOW_REGIONS,
  SHADOW_FACE_READ_BYTES as FACE_BYTES,
  createShadowRecordPack,
} from './recordPack.ts';
import { createCheckedShaderModule } from '../core/shaderModule.ts';
import { arrayView, layerPasses, layerViews, shadowPoolTexture } from './layers.ts';
import { createShadowTransmittance, type ShadowTransmittance } from './transmittance.ts';
import { shadowTransmittanceDraws } from './transmittanceDraws.ts';
import { shadowDepthDraws } from './depthDraws.ts';
import { shadowBatchWrites } from './batchWrites.ts';
import { SHADOW_FACE_STRIDE as FACE_STRIDE } from './batchBudget.ts';

export { MAX_SHADOW_PAGES, MAX_SHADOW_REGIONS } from './recordPack.ts';

/** Label of the measured pass; `gpuShadowsMs` is read under this name. */
export const SHADOW_PASS = 'Trillion3D shadow atlas v1';
/** Bytes of the records, before the page table in the same buffer. */
const RECORD_BYTES = MAX_SHADOW_SLICES * SHADOW_RECORD_FLOATS * 4;
/** Bytes of the records then the page table, one buffer. */
const DATA_BYTES = RECORD_BYTES + SHADOW_TABLE_ENTRIES * 4;
/** Bytes of the buffers beside the pool — the faces, the records and page table: fixed by the
 *  light contract, the same on every screen, so the memory budget counts them. */
export const SHADOW_BUFFER_BYTES = MAX_SHADOW_REGIONS * (FACE_STRIDE + 4) + DATA_BYTES;
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
export async function createGpuShadowAtlas(device: GPUDevice, pageLayout: GPUBindGroupLayout) {
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
    size: DATA_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const pack = createShadowRecordPack(FACE_STRIDE, 1),
    { records, facePacked } = pack;
  const release = () => {
    texture?.destroy();
    transmittance?.destroy();
    faceUniform.destroy();
    dataBuffer.destroy();
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
    const depthDraws = shadowDepthDraws(device, module, layout);
    const transmittanceDraws = shadowTransmittanceDraws(device, module, [pageLayout, faceLayout]);
    const faceGroup = device.createBindGroup({
      layout: faceLayout,
      entries: [{ binding: 0, resource: { buffer: faceUniform, size: FACE_BYTES } }],
    });
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
      /** True when region `index`'s face carries an emitter envelope, which only a fragment
       *  discards. */
      hasEnvelope: pack.hasEnvelope,
      faceGroup,
      faceUniform,
      faceStride: FACE_STRIDE,
      allocationBytes: SHADOW_BUFFER_BYTES,
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
          SHADOW_BUFFER_BYTES + shadowAtlasBytes(poolSide, layers) + (layer?.bytes ?? 0);
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
