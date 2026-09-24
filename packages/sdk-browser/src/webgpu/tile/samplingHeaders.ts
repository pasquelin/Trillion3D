import type { Texture } from '../../../../sdk-core/src/index.ts';
import type { WebgpuTileAtlas } from './atlas.ts';

/**
 * The sampling headers of both atlases' textures (#360, #361), written per texture and not per
 * surface — however many passes wear it, a transparent one included —, only the words that moved
 * (`setSampling`, `pageTable.ts`). `writeAll` writes every texture's; `follow` those of the
 * records a follow named (`followHostTextures`), adds the colour slots that moved to
 * `colorMoved`, and says whether any word moved.
 */
export function samplingHeaders(color: WebgpuTileAtlas, data: WebgpuTileAtlas) {
  const writer = ({ pages, textures }: WebgpuTileAtlas) => {
    const slots = new Map<Texture, number>();
    textures.forEach(({ texture }, slot) => texture && slots.set(texture, slot));
    const write = (slot: number, texture: Texture) =>
      pages.setSampling(slot, texture, textures[slot].source.kind !== 'host');
    return {
      all: () => slots.forEach(write),
      /** The record's slot when a word of its header moved, -1 otherwise. */
      one(record: Texture) {
        const slot = slots.get(record);
        return slot !== undefined && write(slot, record) ? slot : -1;
      },
    };
  };
  const colour = writer(color),
    other = writer(data);
  return {
    writeAll() {
      colour.all();
      other.all();
    },
    follow(moved: ReadonlySet<Texture>, colorMoved: Set<number>) {
      let written = false;
      for (const record of moved) {
        const slot = colour.one(record);
        if (slot >= 0) colorMoved.add(slot);
        written = other.one(record) >= 0 || slot >= 0 || written;
      }
      return written;
    },
  };
}
