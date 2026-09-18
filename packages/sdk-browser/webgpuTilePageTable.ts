import {
  entryLevel,
  MAX_LEVELS,
  packEntry,
  tilesAt,
  type TileLayout,
  type TilePlace,
} from './textureTiles.ts';

/**
 * La table de pages d'un atlas : pour chaque tuile de chaque niveau diffusé de chaque texture, la
 * place du pool qui la sert. C'est l'indirection que le nuanceur lit avant chaque échantillon.
 *
 * Une entrée dont la tuile manque n'est pas vide : elle pointe la tuile résidente la plus fine
 * parmi ses ancêtres — remplie « vers le bas » à chaque arrivée, rendue à l'ancêtre suivant à chaque
 * départ —, et zéro dit « rien de diffusé, lis la queue ». Le nuanceur ne cherche donc jamais : une
 * lecture, une tuile, toujours montrable.
 *
 * Un seul tampon par atlas, en mots : `[décalage de retour, textures, début des entrées, début des
 * niveaux]`, puis quatre mots par texture (`largeur | hauteur << 16`, premier niveau de la queue,
 * dernier niveau, place de la queue), puis seize mots par texture (le premier mot de chaque niveau
 * diffusé, absolu), puis les entrées. Les écritures partent par texture, sur la portée qu'elle a
 * touchée depuis le dernier envoi.
 */
export const PAGE_HEADER_WORDS = 4;
export const PAGE_SLOT_WORDS = 4;

export type TileKey = { slot: number; level: number; tx: number; ty: number };

export type WebgpuTilePageTable = {
  readonly words: Uint32Array<ArrayBuffer>;
  readonly entries: number;
  readonly buffer: GPUBuffer;
  layoutOf(slot: number): TileLayout;
  /** Le mot d'une tuile diffusée, tel que le nuanceur le lira après `flush`. */
  entryOf(key: TileKey): number;
  /** Le rang de retour d'image d'une tuile, et l'inverse — les deux bornes d'une même liste. */
  feedbackIndexOf(key: TileKey): number;
  tileOf(feedbackIndex: number): TileKey;
  setTail(slot: number, place: TilePlace): void;
  setTile(key: TileKey, place: TilePlace): void;
  clearTile(key: TileKey): void;
  /** Envoie à la carte ce qui a changé ; rien quand rien n'a bougé. */
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
  // Par texture, la plus basse et la plus haute adresse touchées depuis le dernier envoi.
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
  /** Les entrées plus fines qu'une tuile, sous elle : celles que sa présence ou son départ sert. */
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
    layoutOf: (slot) => layouts[slot],
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
    setTail(slot, place) {
      const header = PAGE_HEADER_WORDS + slot * PAGE_SLOT_WORDS;
      write(slot, header + 3, place.x | (place.y << 8) | (place.layer << 16));
    },
    setTile(key, place) {
      const word = packEntry(place, key.level);
      write(key.slot, wordIndex(key), word);
      // Vers le bas : toute entrée plus fine servie par un ancêtre plus grossier, ou par rien,
      // est mieux servie par celle-ci.
      descend(key, (index) => {
        const current = words[index];
        if (current === 0 || entryLevel(current) > key.level) write(key.slot, index, word);
      });
    },
    clearTile(key) {
      const own = wordIndex(key),
        leaving = words[own];
      const layout = layouts[key.slot];
      // L'ancêtre résident le plus fin, ou rien : c'est lui qui reprend cette entrée et toutes
      // celles, plus fines, que la tuile partante servait.
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
