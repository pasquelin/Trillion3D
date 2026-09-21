import {
  entryLevel,
  MAX_LEVELS,
  packEntry,
  tilesAt,
  type TileLayout,
  type TilePlace,
} from './textureTiles.ts';

/**
 * Page table of an atlas: for each tile of each streamed level of each texture, the pool place
 * that serves it. That is the indirection the shader reads before every sample.
 *
 * An entry whose tile is missing is not empty: it points at the finest resident tile among its
 * ancestors — filled "downward" on every arrival, handed back to the next ancestor on every
 * departure — and zero means "nothing streamed, read the tail". The shader therefore never
 * searches: one read, one tile, always showable.
 *
 * One buffer per atlas, in words: `[feedback offset, textures, start of entries, start of
 * levels]`, then four words per texture (`width | height << 16`, first tail level, last level,
 * tail place with the texture's pool tap in its top byte), then sixteen words per texture (the
 * first word of each streamed level, absolute), then the entries. Writes go out per texture, over
 * the span it has touched since the last flush.
 */
export const PAGE_HEADER_WORDS = 4;
export const PAGE_SLOT_WORDS = 4;

export type TileKey = { slot: number; level: number; tx: number; ty: number };

export type WebgpuTilePageTable = {
  readonly words: Uint32Array<ArrayBuffer>;
  readonly entries: number;
  readonly buffer: GPUBuffer;
  /** Word of a streamed tile, as the shader will read it after `flush`. */
  entryOf(key: TileKey): number;
  /** Feedback rank of a tile, and the inverse — both ends of the same list. */
  feedbackIndexOf(key: TileKey): number;
  tileOf(feedbackIndex: number): TileKey;
  /** The tail's place, and the tap every tile of the texture — this one included — is read by. */
  setTail(slot: number, place: TilePlace, tap: number): void;
  setTile(key: TileKey, place: TilePlace): void;
  clearTile(key: TileKey): void;
  /** Sends the GPU what has changed; nothing when nothing moved. */
  flush(device: Pick<GPUDevice, 'queue'>): void;
  destroy(): void;
};

export function createWebgpuTilePageTable(
  device: Pick<GPUDevice, 'createBuffer' | 'queue'>,
  layouts: TileLayout[],
  options: { kind: 'color' | 'data'; feedbackOffset: number },
): WebgpuTilePageTable {
  const slots = layouts.length;
  const levelsAt = PAGE_HEADER_WORDS + slots * PAGE_SLOT_WORDS,
    entriesAt = levelsAt + slots * MAX_LEVELS;
  const bases: number[] = [];
  let entries = 0;
  for (const layout of layouts) {
    bases.push(entries);
    entries += layout.entries;
  }
  const words = new Uint32Array(entriesAt + entries);
  words[0] = options.feedbackOffset;
  words[1] = slots;
  words[2] = entriesAt;
  words[3] = levelsAt;
  for (let slot = 0; slot < slots; slot++) {
    const layout = layouts[slot],
      header = PAGE_HEADER_WORDS + slot * PAGE_SLOT_WORDS;
    words[header] = layout.width | (layout.height << 16);
    words[header + 1] = layout.tail;
    words[header + 2] = layout.last;
    for (let level = 0; level < layout.tail; level++)
      words[levelsAt + slot * MAX_LEVELS + level] = entriesAt + bases[slot] + layout.offsets[level];
  }
  const buffer = device.createBuffer({
    label: `WG texture pages ${options.kind}`,
    size: Math.max(16, words.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, words);
  // Per texture, the lowest and highest addresses touched since the last flush.
  const dirty = new Map<number, [number, number]>();
  const touch = (slot: number, from: number, to: number) => {
    const span = dirty.get(slot);
    if (!span) dirty.set(slot, [from, to]);
    else {
      span[0] = Math.min(span[0], from);
      span[1] = Math.max(span[1], to);
    }
  };
  const wordIndex = ({ slot, level, tx, ty }: TileKey) => {
    const layout = layouts[slot];
    if (level >= layout.tail) throw new Error('TEXTURE_TILE_IN_TAIL');
    const [tw, th] = tilesAt(layout.width, layout.height, level);
    if (tx >= tw || ty >= th) throw new Error('TEXTURE_TILE_OUT_OF_LEVEL');
    return entriesAt + bases[slot] + layout.offsets[level] + ty * tw + tx;
  };
  const write = (slot: number, index: number, word: number) => {
    if (words[index] === word) return;
    words[index] = word;
    touch(slot, index, index);
  };
  /** Entries finer than a tile, under it: those its presence or departure serves. */
  const descend = (key: TileKey, visit: (index: number) => void) => {
    const layout = layouts[key.slot];
    for (let level = key.level - 1; level >= 0; level--) {
      const shift = key.level - level,
        [tw, th] = tilesAt(layout.width, layout.height, level);
      const x0 = key.tx << shift,
        y0 = key.ty << shift,
        x1 = Math.min(tw, (key.tx + 1) << shift),
        y1 = Math.min(th, (key.ty + 1) << shift);
      const base = entriesAt + bases[key.slot] + layout.offsets[level];
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) visit(base + y * tw + x);
    }
  };
  return {
    words,
    entries,
    buffer,
    entryOf: (key) => words[wordIndex(key)],
    feedbackIndexOf: (key) => wordIndex(key) - entriesAt + options.feedbackOffset,
    tileOf(feedbackIndex) {
      const entry = feedbackIndex - options.feedbackOffset;
      if (entry < 0 || entry >= entries) throw new Error('TEXTURE_FEEDBACK_INDEX');
      let lo = 0,
        hi = slots - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (bases[mid] <= entry) lo = mid;
        else hi = mid - 1;
      }
      const layout = layouts[lo],
        local = entry - bases[lo];
      let level = layout.tail - 1;
      while (level > 0 && layout.offsets[level] > local) level--;
      const [tw] = tilesAt(layout.width, layout.height, level),
        rank = local - layout.offsets[level];
      return { slot: lo, level, tx: rank % tw, ty: Math.floor(rank / tw) };
    },
    setTail(slot, place, tap) {
      const header = PAGE_HEADER_WORDS + slot * PAGE_SLOT_WORDS;
      write(slot, header + 3, place.x | (place.y << 8) | (place.layer << 16) | (tap << 24));
    },
    setTile(key, place) {
      const word = packEntry(place, key.level);
      write(key.slot, wordIndex(key), word);
      // Downward: every finer entry served by a coarser ancestor, or by nothing, is better
      // served by this one.
      descend(key, (index) => {
        const current = words[index];
        if (current === 0 || entryLevel(current) > key.level) write(key.slot, index, word);
      });
    },
    clearTile(key) {
      const own = wordIndex(key),
        leaving = words[own];
      const layout = layouts[key.slot];
      // The finest resident ancestor, or nothing: it is the one that takes back this entry and
      // all the finer ones the leaving tile used to serve.
      let replacement = 0;
      for (let level = key.level + 1; level < layout.tail; level++) {
        const shift = level - key.level;
        const word =
          words[wordIndex({ slot: key.slot, level, tx: key.tx >> shift, ty: key.ty >> shift })];
        if (word !== 0 && entryLevel(word) === level) {
          replacement = word;
          break;
        }
      }
      write(key.slot, own, replacement);
      descend(key, (index) => {
        if (words[index] === leaving) write(key.slot, index, replacement);
      });
    },
    flush(target) {
      for (const [, [from, to]] of dirty)
        target.queue.writeBuffer(buffer, from * 4, words, from, to - from + 1);
      dirty.clear();
    },
    destroy() {
      buffer.destroy();
    },
  };
}
