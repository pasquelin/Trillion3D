import type { AtlasLanes } from '../../texture/blockFormats.ts';
import type { WebgpuTileAtlas } from './atlas.ts';
import type { WebgpuTileFeedback } from './feedback.ts';
import type { createTileSources } from './sources.ts';
import type { TileTexture } from './tileTexture.ts';

/**
 * What changes the streamer's size in session: its lane pools, drawn again for another budget,
 * and its catalogue, which takes a texture after open (#847) by the path the open ran — its slot
 * in the atlas's table, the data table's feedback ranks moved behind a grown colour one, the
 * feedback counting every rank, its tail pinned from its source, the headers written.
 */
export function createTileGrowth(
  { device, onColorChanged }: { device: GPUDevice; onColorChanged: (slots: -1) => void },
  parts: {
    color: WebgpuTileAtlas;
    data: WebgpuTileAtlas;
    feedback: WebgpuTileFeedback;
    sources: ReturnType<typeof createTileSources>;
    flushAll: () => void;
    followHeaders: (force: boolean) => number;
  },
) {
  const { color, data, feedback, sources, flushAll } = parts;
  return {
    /** Lane pools whose layers change are replaced, tiles kept; returns the evicted tiles. */
    resize(layers: AtlasLanes) {
      const results = [color.resize(device, layers.color), data.resize(device, layers.data)];
      if (results.some((result) => result.replaced)) {
        flushAll();
        onColorChanged(-1);
      }
      return results.reduce((total, result) => total + result.evicted, 0);
    },
    /** Appends a texture to an atlas whose lane was sized for its tail (`resize`); its slot. */
    append(kind: 'color' | 'data', texture: TileTexture) {
      const atlas = kind === 'color' ? color : data;
      const slot = atlas.append(texture);
      atlas.pinTails(device.queue, (at, place) => sources.tail(atlas, at, place), slot);
      // The data ranks follow the colour ones: a grown colour table moves them.
      if (data.pages.words[0] !== color.pages.entries) data.relayout(color.pages.entries);
      const ranks = color.pages.entries + data.pages.entries;
      if (ranks !== feedback.entries) feedback.grow(ranks);
      parts.followHeaders(true);
      flushAll();
      return slot;
    },
  };
}
