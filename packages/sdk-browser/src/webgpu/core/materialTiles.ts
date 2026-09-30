import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts';
import { validated } from '../../gpu/core/errorScope.ts';
import { buildComputePipeline } from '../../lighting/deferred/fullscreen.ts';
import { MATERIAL_CLASS_KEYS } from '../../visibility/shader/materialClass.ts';
import {
  MATERIAL_TILE_SLOTS,
  MATERIAL_TILE_SIZE,
  MATERIAL_TILES_SHADER,
} from '../../visibility/shader/materialTilesWgsl.ts';
import { createWebgpuBindIdentity } from './bindIdentity.ts';

/** Label of the classification pass (`materialTilesWgsl.ts`). */
export const MATERIAL_TILES_PASS = 'Trillion3D material tiles';
/** Tiles on one axis of `pixels`: `materialTilesX`'s count (`materialTilesWgsl.ts`). */
const materialTilesOn = (pixels: number) => Math.ceil(pixels / MATERIAL_TILE_SIZE);
/** Bytes of one class's indirect draw: vertex count, instance count, first vertex, first instance. */
const DRAW_BYTES = 16;

/** Group 1 of the class draws: the slot of each class key, and the tile lists. */
export function materialTileDrawLayout(device: GPUDevice) {
  const vertex = GPUShaderStage.VERTEX,
    buffer: GPUBufferBindingLayout = { type: 'read-only-storage' };
  return device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: vertex, buffer },
      { binding: 1, visibility: vertex, buffer },
    ],
  });
}

/** The classification's pipeline and layout; none on a device with no compute or that refuses them
 *  (`validated`). A shader that does not compile is a defect, thrown by name. */
async function classifier(device: GPUDevice) {
  if (typeof device.createComputePipeline !== 'function') return undefined;
  const compute = GPUShaderStage.COMPUTE,
    storage: GPUBufferBindingLayout = { type: 'storage' },
    readOnly: GPUBufferBindingLayout = { type: 'read-only-storage' };
  return validated(device, async () => {
    const module = await createCheckedShaderModule(device, MATERIAL_TILES_SHADER, 'MATERIAL_TILES');
    const layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: compute, texture: { sampleType: 'uint' } },
        { binding: 1, visibility: compute, buffer: readOnly },
        { binding: 2, visibility: compute, buffer: { type: 'uniform' } },
        { binding: 3, visibility: compute, buffer: readOnly },
        { binding: 4, visibility: compute, buffer: storage },
        { binding: 5, visibility: compute, buffer: storage },
      ],
    });
    const pipeline = await buildComputePipeline(device, {
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'classify' },
    });
    return { layout, pipeline };
  });
}

/** What the classification reads each image: the visibility buffer, its page table and the
 *  resolve's uniform. */
export type MaterialTileInputs = { vis: GPUTextureView; pages: GPUBuffer; uniform: GPUBuffer };

/**
 * The material tiles of the image (`materialTilesWgsl.ts`): the slot table, rewritten when the
 * classes the image holds change; the tile lists, sized for the largest image yet; one indirect
 * draw per slot, cleared then counted by the classification each image. Without a classification
 * — a device that refused its pipeline — every class takes no slot and draws every tile: the
 * full-screen triangle's pixels, as before.
 */
export async function createMaterialTiles(device: GPUDevice, drawLayout: GPUBindGroupLayout) {
  const classify = await classifier(device);
  const listed = classify ? MATERIAL_TILE_SLOTS : 0;
  const slotWords = new Uint32Array(MATERIAL_CLASS_KEYS).fill(MATERIAL_TILE_SLOTS);
  const slots = device.createBuffer({
    label: 'Trillion3D material tile slots',
    size: slotWords.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(slots, 0, slotWords);
  const draws = device.createBuffer({
    label: 'Trillion3D material tile draws',
    size: MATERIAL_TILE_SLOTS * DRAW_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
  });
  const bound = createWebgpuBindIdentity();
  let tiles: GPUBuffer | undefined,
    capacity = 0,
    classifyGroup: GPUBindGroup | undefined,
    drawGroup: GPUBindGroup | undefined,
    held: readonly number[] = [],
    tilesX = 0,
    tilesY = 0;
  return {
    /** Tiles of the last image classified. */
    get tileCount() {
      return tilesX * tilesY;
    },
    /** Gives each class key of `keys` its slot, in order, `MATERIAL_TILE_SLOTS` past the last
     *  list; rewrites the table when they changed. */
    assign(keys: readonly number[]) {
      if (keys.length === held.length && keys.every((key, at) => held[at] === key)) return;
      for (const key of held) slotWords[key] = MATERIAL_TILE_SLOTS;
      keys.forEach((key, at) => (slotWords[key] = at < listed ? at : MATERIAL_TILE_SLOTS));
      held = keys.slice();
      device.queue.writeBuffer(slots, 0, slotWords);
    },
    /** Classifies the `width` × `height` image; returns the class draws' group 1. */
    encode(encoder: GPUCommandEncoder, width: number, height: number, inputs: MaterialTileInputs) {
      tilesX = materialTilesOn(width);
      tilesY = materialTilesOn(height);
      if (tilesX * tilesY > capacity) {
        tiles?.destroy();
        capacity = tilesX * tilesY;
        tiles = device.createBuffer({
          label: 'Trillion3D material tile lists',
          size: capacity * MATERIAL_TILE_SLOTS * 4,
          usage: GPUBufferUsage.STORAGE,
        });
        drawGroup = device.createBindGroup({
          layout: drawLayout,
          entries: [
            { binding: 0, resource: { buffer: slots } },
            { binding: 1, resource: { buffer: tiles } },
          ],
        });
      }
      if (!classify) return drawGroup!;
      bound.next[0] = inputs.vis;
      bound.next[1] = inputs.pages;
      bound.next[2] = inputs.uniform;
      bound.next[3] = tiles;
      if (bound.moved() || !classifyGroup)
        classifyGroup = device.createBindGroup({
          layout: classify.layout,
          entries: [
            { binding: 0, resource: inputs.vis },
            { binding: 1, resource: { buffer: inputs.pages } },
            { binding: 2, resource: { buffer: inputs.uniform } },
            { binding: 3, resource: { buffer: slots } },
            { binding: 4, resource: { buffer: tiles! } },
            { binding: 5, resource: { buffer: draws } },
          ],
        });
      encoder.clearBuffer(draws);
      const pass = encoder.beginComputePass({ label: MATERIAL_TILES_PASS });
      pass.setPipeline(classify.pipeline);
      pass.setBindGroup(0, classifyGroup);
      pass.dispatchWorkgroups(tilesX, tilesY, 1);
      pass.end();
      return drawGroup!;
    },
    /** Draws class `at` of the keys assigned: its tiles, or every tile past the lists. */
    draw(pass: GPURenderPassEncoder, at: number) {
      if (at < listed) pass.drawIndirect(draws, at * DRAW_BYTES);
      else pass.draw(6, tilesX * tilesY);
    },
    dispose() {
      tiles?.destroy();
      slots.destroy();
      draws.destroy();
    },
  };
}

export type MaterialTiles = Awaited<ReturnType<typeof createMaterialTiles>>;
