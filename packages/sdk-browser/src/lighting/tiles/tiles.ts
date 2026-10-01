import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { tileViewInverse } from './tileFrame.ts';
import { LIGHT_TILES_SHADER } from './shader.ts';
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts';
import { createWebgpuBindIdentity } from '../../webgpu/core/bindIdentity.ts';
import { TILE_STRIDE_WORDS } from '../direct/lightWgsl.ts';
import { createTileLightPool } from './pool.ts';
import { buildComputePipeline } from '../deferred/fullscreen.ts';
import { storageBufferCap } from '../../residency/pools.ts';
/** Label of the measured pass; `gpuLightListsMs` is read under this name, not by its rank. */
export const LIGHT_TILES_PASS = 'Trillion3D light tiles v1';
/** Columns of the light grid over `pixels`, at least one: the grid covers the whole target, never
 *  one column short. */
const tilesOn = (pixels: number) => Math.max(1, Math.ceil(pixels / LIGHT_SETTINGS.tileSize));
/** The pass's uniform: the inverse matrix, the viewport and columns, the origin, two depth rows. */
const UNIFORM_FLOATS = 32;
export type GpuLightTiles = Awaited<ReturnType<typeof createGpuLightTiles>>;

/**
 * The light grid's pass (`./shader.ts`, #1369). The grid buffer — the cell records, then the pool
 * of their lists (`./pool.ts`) — is allocated for the current target and reallocated only when it
 * changes size or the pool grows; the group follows the light buffer, which grows with the scene;
 * encoding allocates nothing. The pass reads no depth: its cells are the view's own.
 */
export async function createGpuLightTiles(device: GPUDevice) {
  const module = await createCheckedShaderModule(device, LIGHT_TILES_SHADER, 'LIGHT_TILES_SHADER');
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const uniform = device.createBuffer({
    label: 'Trillion3D light tile view v1',
    size: UNIFORM_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const packed = new Float32Array(UNIFORM_FLOATS),
    inverse = new Float64Array(16),
    origin = new Float64Array(3),
    rows = new Float64Array(8);
  const pool = createTileLightPool(device);
  let pipeline: GPUComputePipeline;
  try {
    pipeline = await buildComputePipeline(device, {
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'lightTiles' },
    });
  } catch (error) {
    uniform.destroy();
    pool.dispose();
    throw error;
  }
  let tiles: GPUBuffer | undefined,
    group: GPUBindGroup | undefined,
    tilesX = 0,
    tilesY = 0,
    poolWords = 0,
    growths = 0;
  const bound = createWebgpuBindIdentity();
  return {
    /** Buffer the deferred resolve rereads; never undefined after an `ensure()`. */
    get buffer() {
      return tiles;
    },
    get tilesX() {
      return tilesX;
    },
    get tilesY() {
      return tilesY;
    },
    /** The pool's frame metrics (#849): the last sample, and its growths. */
    poolMetrics() {
      const sample = pool.sample();
      return {
        tileLightPoolReserved: sample?.reserved ?? null,
        tileLightPoolCapacity: sample?.capacity ?? null,
        tileLightPoolOverflowed: sample?.overflowed ?? null,
        tileLightPoolGrowths: growths,
      };
    },
    /** Ensures the grid buffer and the bind group; `true` if the pass is ready. */
    ensure(width: number, height: number, lights: GPUBuffer) {
      const wantedX = tilesOn(width),
        wantedY = tilesOn(height),
        records = wantedX * wantedY * LIGHT_SETTINGS.gridSlices * TILE_STRIDE_WORDS;
      // The pool never takes the buffer past what the device binds: a cell with no room walks all.
      const room = Math.floor(storageBufferCap(device.limits) / 4) - records;
      const wantedPool = Math.max(0, Math.min(pool.words(wantedX * wantedY), room));
      if (!tiles || wantedX !== tilesX || wantedY !== tilesY || wantedPool > poolWords) {
        tiles?.destroy();
        // The same view with more pool words: the pool grew to what an overflowing frame asked.
        if (poolWords && wantedX === tilesX && wantedY === tilesY) growths++;
        tilesX = wantedX;
        tilesY = wantedY;
        poolWords = wantedPool;
        tiles = device.createBuffer({
          label: 'Trillion3D light tiles v1',
          size: (records + poolWords) * 4,
          // Copyable, as the pool state: a proof reads the lists back.
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        group = undefined;
      }
      bound.next[0] = lights;
      if (bound.moved() || !group) {
        group = device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: { buffer: uniform } },
            { binding: 1, resource: { buffer: lights } },
            { binding: 2, resource: { buffer: tiles } },
            { binding: 3, resource: { buffer: pool.state } },
          ],
        });
      }
      return !!group;
    },
    /** The render matrix (jitter included) and the eye, both absolute and in f64. */
    update(
      viewProjection: ArrayLike<number>,
      eye: ArrayLike<number>,
      width: number,
      height: number,
    ) {
      packed.set(tileViewInverse(inverse, origin, viewProjection, eye, rows), 0);
      packed[16] = width;
      packed[17] = height;
      packed[18] = tilesX;
      packed[19] = tilesY;
      packed.set(origin, 20);
      packed.set(rows, 24);
      device.queue.writeBuffer(uniform, 0, packed);
      pool.open(tilesX * tilesY * LIGHT_SETTINGS.gridSlices * TILE_STRIDE_WORDS, poolWords);
    },
    /** Encodes the pass of image `frame`, one workgroup a column; its pool state is sampled after. */
    encode(encoder: GPUCommandEncoder, frame: number) {
      if (!group) return false;
      const pass = encoder.beginComputePass({ label: LIGHT_TILES_PASS });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(tilesX, tilesY, 1);
      pass.end();
      pool.sampleState(encoder, frame);
      return true;
    },
    /** Requests mapping of the pool sample, once the frame that copied it is submitted. */
    submitted: pool.submitted,
    dispose() {
      pool.dispose();
      uniform.destroy();
      tiles?.destroy();
      tiles = undefined;
      group = undefined;
    },
  };
}
