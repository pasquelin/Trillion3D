import {
  LIGHT_SETTINGS,
  invertMatrix4,
  matrixAtRenderOrigin,
} from '../../../../sdk-core/src/index.ts';
import { LIGHT_TILES_SHADERS } from './shader.ts';
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts';
import { createWebgpuBindIdentity } from '../../webgpu/core/bindIdentity.ts';
import { TILE_STRIDE_WORDS } from '../direct/lightWgsl.ts';
import { createTileLightPool } from './pool.ts';
import { storageBufferCap } from '../../residency/pools.ts';
/** Label of the measured pass; `gpuLightListsMs` is read under this name, not by its rank. */
export const LIGHT_TILES_PASS = 'Trillion3D light tiles v1';
/** Tiles on one axis: the list always covers the whole target, never one tile short. */
const tilesOn = (pixels: number) => Math.max(1, Math.ceil(pixels / LIGHT_SETTINGS.tileSize));
export type GpuLightTiles = Awaited<ReturnType<typeof createGpuLightTiles>>;

const atOrigin = new Float64Array(16);
/**
 * The tile pass's frame (`sdk-core` `renderOrigin.ts`): `origin` the eye rounded to f32, the words
 * the shader subtracts from a light's centre, and `out` the f64 inverse of `viewProjection ·
 * T(origin)` — the jittered render matrix, not the camera's `viewProjectionRelative`.
 */
export function tileViewInverse(
  out: Float64Array,
  origin: Float64Array,
  viewProjection: ArrayLike<number>,
  eye: ArrayLike<number>,
) {
  for (let axis = 0; axis < 3; axis++) origin[axis] = Math.fround(eye[axis]);
  return invertMatrix4(out, matrixAtRenderOrigin(atOrigin, viewProjection, origin));
}

/**
 * Per-tile light-list pass. The tile buffer — the records, then the pool of the slices past their
 * list (`./pool.ts`) — is allocated for the current target and reallocated only when it changes
 * size; the group follows the light buffer, which grows with the scene; encoding allocates
 * nothing. A scene of at most `tileLights` lights runs the narrow pass (`./shader.ts`).
 */
export async function createGpuLightTiles(device: GPUDevice) {
  // Granted `subgroups`, the depth bounds reduce per subgroup: the same words, fewer atomics.
  const subgroups = device.features.has('subgroups');
  // The wide pass, then the narrow one (`LIGHT_TILES_SHADERS`).
  const modules = await Promise.all(
    [0, 2].map((narrow) =>
      createCheckedShaderModule(
        device,
        LIGHT_TILES_SHADERS[+subgroups + narrow][1],
        LIGHT_TILES_SHADERS[+subgroups + narrow][0],
      ),
    ),
  );
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'depth' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const uniform = device.createBuffer({
    label: 'Trillion3D light tile view v1',
    size: 96,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const packed = new Float32Array(24),
    inverse = new Float64Array(16),
    origin = new Float64Array(3);
  const pool = createTileLightPool(device);
  let pipelines: GPUComputePipeline[];
  try {
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    pipelines = modules.map((module) =>
      device.createComputePipeline({
        layout: pipelineLayout,
        compute: { module, entryPoint: 'lightTiles' },
      }),
    );
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
    growths = 0,
    wide = false;
  const bound = createWebgpuBindIdentity();
  return {
    /** True when the device granted `subgroups`: the depth bounds reduce per subgroup. */
    subgroups,
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
    /** True when the scene holds more lights than a list: the wide pass and its pool run. */
    get wide() {
      return wide;
    },
    /** The pool's frame metrics (#849): the last sample of a wide frame, and its growths. */
    poolMetrics() {
      const sample = wide ? pool.sample() : undefined;
      return {
        tileLightPoolReserved: sample?.reserved ?? null,
        tileLightPoolCapacity: sample?.capacity ?? null,
        tileLightPoolOverflowed: sample?.overflowed ?? null,
        tileLightPoolGrowths: growths,
      };
    },
    /** Ensures the target buffer and the bind group for `count` lights; `true` if the pass is ready. */
    ensure(width: number, height: number, depth: GPUTextureView, lights: GPUBuffer, count: number) {
      const wantedX = tilesOn(width),
        wantedY = tilesOn(height);
      wide = count > LIGHT_SETTINGS.tileLights;
      // The pool never takes the buffer past what the device binds: a tile with no room walks all.
      const room =
        Math.floor(storageBufferCap(device.limits) / 4) - wantedX * wantedY * TILE_STRIDE_WORDS;
      const wantedPool = wide ? Math.max(0, Math.min(pool.words(wantedX * wantedY), room)) : 0;
      if (!tiles || wantedX !== tilesX || wantedY !== tilesY || wantedPool > poolWords) {
        tiles?.destroy();
        // The same view with more pool words: the pool grew to what an overflowing frame asked.
        if (poolWords && wantedX === tilesX && wantedY === tilesY) growths++;
        tilesX = wantedX;
        tilesY = wantedY;
        poolWords = wantedPool;
        tiles = device.createBuffer({
          label: 'Trillion3D light tiles v1',
          size: (tilesX * tilesY * TILE_STRIDE_WORDS + poolWords) * 4,
          // Copyable, as the pool state: a proof reads the lists back.
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        group = undefined;
      }
      bound.next[0] = depth;
      bound.next[1] = lights;
      if (bound.moved() || !group) {
        group = device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: depth },
            { binding: 1, resource: { buffer: uniform } },
            { binding: 2, resource: { buffer: lights } },
            { binding: 3, resource: { buffer: tiles } },
            { binding: 4, resource: { buffer: pool.state } },
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
      packed.set(tileViewInverse(inverse, origin, viewProjection, eye), 0);
      packed[16] = width;
      packed[17] = height;
      packed[18] = tilesX;
      packed[19] = tilesY;
      packed.set(origin, 20);
      device.queue.writeBuffer(uniform, 0, packed);
      if (wide) pool.open(tilesX * tilesY * TILE_STRIDE_WORDS, poolWords);
    },
    /** Encodes the pass of image `frame`; the wide pass's pool state is sampled after it. */
    encode(encoder: GPUCommandEncoder, frame: number) {
      if (!group) return false;
      const pass = encoder.beginComputePass({ label: LIGHT_TILES_PASS });
      pass.setPipeline(pipelines[+!wide]);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(tilesX, tilesY, 1);
      pass.end();
      if (wide) pool.sampleState(encoder, frame);
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
