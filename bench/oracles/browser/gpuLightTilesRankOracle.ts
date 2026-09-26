/**
 * Oracle D4: a line-by-line port of the batched compaction of `lightTiles` in
 * packages/sdk-browser/src/lighting/tiles/shader.ts. The scene's lights are tested 256 at a time,
 * one per thread; each thread, in any order, writes its kept light at what the batches before
 * kept plus the rank `rankBefore` reads from the batch's mask, with no per-tile cap, and thread
 * zero writes the two counts once every batch is done.
 *
 * The tile layout is read from the shader's own WGSL, never restated here, so a shader whose
 * record has no room for a light it keeps fails the port: a write that leaves its list lands in
 * the neighbouring list or tile on the GPU, and throws here.
 */

export type TileLayout = {
  threads: number;
  capacity: number;
  stride: number;
  opaqueBase: number;
  blendBase: number;
  opaqueMask: number;
  blendMask: number;
  words: number;
};

function wgslConstant(shader: string, name: string) {
  const found = new RegExp(`const ${name}:u32=(\\d+)u;`).exec(shader);
  if (!found) throw new Error(`the tile shader declares no ${name}`);
  return Number(found[1]);
}

/** A `fn name(capacity:u32)->u32{return capacity*a+b;}` of the shader, at `capacity`. */
function wgslOfCapacity(shader: string, name: string, capacity: number) {
  const found = new RegExp(
    `fn ${name}\\(capacity:u32\\)->u32\\{return capacity(?:\\*(\\d+)u)?\\+(\\d+)u;\\}`,
  ).exec(shader);
  if (!found) throw new Error(`the tile shader declares no ${name}`);
  return capacity * Number(found[1] ?? 1) + Number(found[2]);
}

/** The tile record layout the shader declares, for a light table of `capacity` slots. */
export function tileLayout(shader: string, capacity: number): TileLayout {
  const tileSize = wgslConstant(shader, 'TILE_SIZE');
  const opaqueMask = wgslConstant(shader, 'OPAQUE_MASK');
  const blendMask = wgslConstant(shader, 'BLEND_MASK');
  return {
    threads: tileSize * tileSize,
    capacity,
    stride: wgslOfCapacity(shader, 'tileStride', capacity),
    opaqueBase: wgslConstant(shader, 'TILE_OPAQUE_BASE'),
    blendBase: wgslOfCapacity(shader, 'tileBlendBase', capacity),
    opaqueMask,
    blendMask,
    words: blendMask - opaqueMask,
  };
}

const countOneBits = (word: number) => {
  let w = word >>> 0,
    n = 0;
  while (w) {
    n += w & 1;
    w >>>= 1;
  }
  return n;
};

function rankBefore(hits: Uint32Array, mask: number, lane: number) {
  const word = mask + (lane >>> 5);
  let rank = 0;
  for (let before = mask; before < word; before++) rank += countOneBits(hits[before]);
  return rank + countOneBits(hits[word] & ((1 << (lane & 31)) - 1));
}

const maskHolds = (hits: Uint32Array, mask: number, lane: number) =>
  ((hits[mask + (lane >>> 5)] >>> (lane & 31)) & 1) === 1;

function maskTotal(hits: Uint32Array, layout: TileLayout, mask: number) {
  let total = 0;
  for (let w = 0; w < layout.words; w++) total += countOneBits(hits[mask + w]);
  return total;
}

/** The lights each slice of the tile keeps, by rank in the scene. */
export type TileKeeps = { opaque: Iterable<number>; blend: Iterable<number> };

/**
 * One tile's record after the compaction of `lightCount` lights, of which each slice keeps those
 * `keeps` names. `lanes` is the order the threads run in, within each batch.
 */
export function compactTile(
  layout: TileLayout,
  keeps: TileKeeps,
  lightCount: number,
  lanes: Iterable<number> = Array.from({ length: layout.threads }, (_, lane) => lane),
): Uint32Array {
  const tiles = new Uint32Array(layout.stride);
  const write = (start: number, end: number, index: number, value: number) => {
    if (index < start || index >= end)
      throw new RangeError(`write at ${index} leaves its list [${start}, ${end})`);
    tiles[index] = value;
  };
  const opaque = new Set(keeps.opaque),
    blend = new Set(keeps.blend),
    order = [...lanes],
    hits = new Uint32Array(2 * layout.words);
  let opaqueKept = 0,
    blendKept = 0;
  for (let first = 0; first < lightCount; first += layout.threads) {
    hits.fill(0);
    for (let lane = 0; lane < layout.threads && first + lane < lightCount; lane++) {
      const bit = 1 << (lane & 31);
      if (opaque.has(first + lane)) hits[layout.opaqueMask + (lane >>> 5)] |= bit;
      if (blend.has(first + lane)) hits[layout.blendMask + (lane >>> 5)] |= bit;
    }
    for (const lane of order) {
      const index = first + lane;
      if (index < lightCount && maskHolds(hits, layout.opaqueMask, lane)) {
        const at = layout.opaqueBase + opaqueKept + rankBefore(hits, layout.opaqueMask, lane);
        write(layout.opaqueBase, layout.blendBase, at, index);
      }
      if (index < lightCount && maskHolds(hits, layout.blendMask, lane)) {
        const at = layout.blendBase + blendKept + rankBefore(hits, layout.blendMask, lane);
        write(layout.blendBase, layout.stride, at, index);
      }
    }
    opaqueKept += maskTotal(hits, layout, layout.opaqueMask);
    blendKept += maskTotal(hits, layout, layout.blendMask);
  }
  write(0, layout.opaqueBase, 0, opaqueKept);
  write(0, layout.opaqueBase, 1, blendKept);
  return tiles;
}

/** The two lists a record carries, each read up to its count. */
export function tileLists(layout: TileLayout, tiles: Uint32Array) {
  return {
    opaque: [...tiles.subarray(layout.opaqueBase, layout.opaqueBase + tiles[0])],
    blend: [...tiles.subarray(layout.blendBase, layout.blendBase + tiles[1])],
  };
}
