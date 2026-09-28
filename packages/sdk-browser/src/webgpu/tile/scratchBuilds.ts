import type { WebgpuTileAtlas } from './atlas.ts';
import { createTileScratch, type TileScratch } from './scratch.ts';
import { generateMaterialMips } from '../../texture/mipBatch.ts';
import type { TileCounters } from './counters.ts';

/** The working texture of host texture `slot` of `atlas`, built now, its mips not yet. */
export function buildHostScratch(
  device: GPUDevice,
  counters: TileCounters,
  atlas: WebgpuTileAtlas,
  slot: number,
) {
  const { layout, source } = atlas.textures[slot];
  if (source.kind !== 'host') throw new Error('TEXTURE_SOURCE_NOT_HOST');
  counters.scratches++;
  return createTileScratch(device, {
    map: source.map,
    width: layout.width,
    height: layout.height,
    format: atlas.poolOf(slot).texture.format,
    errorCode:
      atlas.kind === 'color'
        ? 'MATERIAL_COLOR_TEXTURE_UNAVAILABLE'
        : 'MATERIAL_DATA_TEXTURE_UNAVAILABLE',
    coverage: source.coverage,
  });
}

/**
 * The working textures tiles asked for, built off the frame (STR-13, #962): a host texture's whole
 * source uploaded and reduced inside the pass that asks for it is a spike the pass's budget never
 * counted. The pass asks and waits; a task of its own, after the frame, builds what was asked —
 * their mips in one batch (#961) — and hands each over (`onBuilt`); the next pass copies the same
 * texels from it. `building` is held until then.
 */
export function createScratchBuilds(
  device: GPUDevice,
  build: (atlas: WebgpuTileAtlas, slot: number) => TileScratch,
  onBuilt: (id: number, scratch: TileScratch) => void,
  onFailure: (phase: string, error: unknown) => void,
) {
  const asked = new Map<number, { atlas: WebgpuTileAtlas; slot: number }>();
  let building: Promise<void> | undefined,
    destroyed = false;
  const buildAsked = () => {
    const chains = [];
    for (const [id, { atlas, slot }] of asked)
      try {
        const scratch = build(atlas, slot);
        onBuilt(id, scratch);
        chains.push(scratch.chain());
      } catch (error) {
        onFailure('texture-tile-failed', error);
      }
    asked.clear();
    generateMaterialMips(device, chains);
  };
  return {
    /** Working textures asked and not built yet. */
    get size() {
      return asked.size;
    },
    ask(id: number, atlas: WebgpuTileAtlas, slot: number) {
      asked.set(id, { atlas, slot });
      building ??= new Promise<void>((done) =>
        setTimeout(() => {
          building = undefined;
          if (!destroyed) buildAsked();
          done();
        }),
      );
    },
    get building() {
      return building;
    },
    destroy() {
      destroyed = true;
      asked.clear();
    },
  };
}
