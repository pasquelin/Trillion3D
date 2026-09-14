import { LIGHT_SETTINGS } from '../sdk-core/index.ts';
import { LIGHT_TILES_SHADER } from './gpuLightTilesShader.ts';

/** Mots par tuile : le nombre retenu, le nombre demandé, deux mots de réserve, puis les rangs. */
const TILE_STRIDE_WORDS = LIGHT_SETTINGS.maxLightsPerTile + 4;
/** Étiquette de la passe mesurée ; `gpuLightListsMs` est lu sous ce nom, pas par son rang. */
export const LIGHT_TILES_PASS = 'WG light tiles v1';
const tileCountsOf = (width: number, height: number) =>
  [
    Math.max(1, Math.ceil(width / LIGHT_SETTINGS.tileSize)),
    Math.max(1, Math.ceil(height / LIGHT_SETTINGS.tileSize)),
  ] as const;
export type GpuLightTiles = Awaited<ReturnType<typeof createGpuLightTiles>>;

/**
 * La passe de listes de lampes par tuile. Le tampon de tuiles est alloué pour la cible courante et
 * réalloué seulement quand elle change de taille ; l'encodage n'alloue rien.
 */
export async function createGpuLightTiles(device: GPUDevice, lights: GPUBuffer) {
  const module = device.createShaderModule({ code: LIGHT_TILES_SHADER });
  const info = await module.getCompilationInfo?.();
  const errors = info?.messages.filter((message) => message.type === 'error');
  if (errors?.length) throw new Error(`LIGHT_TILES_SHADER: ${errors[0].message}`);
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'depth' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const uniform = device.createBuffer({
    label: 'WG light tile view v1',
    size: 112,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const packed = new Float32Array(24);
  let pipeline: GPUComputePipeline | undefined;
  try {
    pipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'lightTiles' },
    });
  } catch (error) {
    uniform.destroy();
    throw error;
  }
  let tiles: GPUBuffer | undefined,
    group: GPUBindGroup | undefined,
    boundDepth: GPUTextureView | undefined,
    tilesX = 0,
    tilesY = 0;
  return {
    /** Le tampon que la résolution différée relit ; jamais indéfini après un `ensure()`. */
    get buffer() {
      return tiles;
    },
    get tileCounts() {
      return [tilesX, tilesY] as const;
    },
    /** Assure le tampon de la cible et le groupe de liaison ; rend `true` si la passe est prête. */
    ensure(width: number, height: number, depth: GPUTextureView) {
      const [wantedX, wantedY] = tileCountsOf(width, height);
      if (!tiles || wantedX !== tilesX || wantedY !== tilesY) {
        tiles?.destroy();
        tilesX = wantedX;
        tilesY = wantedY;
        tiles = device.createBuffer({
          label: 'WG light tiles v1',
          size: tilesX * tilesY * TILE_STRIDE_WORDS * 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        group = undefined;
      }
      if (!group || boundDepth !== depth) {
        boundDepth = depth;
        group = device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: depth },
            { binding: 1, resource: { buffer: uniform } },
            { binding: 2, resource: { buffer: lights } },
            { binding: 3, resource: { buffer: tiles } },
          ],
        });
      }
      return !!group;
    },
    update(inverseViewProjection: ArrayLike<number>, width: number, height: number, count: number) {
      packed.set(inverseViewProjection as number[], 0);
      packed[16] = width;
      packed[17] = height;
      packed[18] = tilesX;
      packed[19] = tilesY;
      packed[20] = count;
      packed[21] = LIGHT_SETTINGS.maxLightsPerTile;
      device.queue.writeBuffer(uniform, 0, packed);
    },
    encode(encoder: GPUCommandEncoder) {
      if (!pipeline || !group) return false;
      const pass = encoder.beginComputePass({ label: LIGHT_TILES_PASS });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(tilesX, tilesY, 1);
      pass.end();
      return true;
    },
    dispose() {
      uniform.destroy();
      tiles?.destroy();
      tiles = undefined;
      group = undefined;
    },
  };
}
