/**
 * Oracle D4: a line-by-line port of the end compaction of `lightTiles` in
 * packages/sdk-browser/src/lighting/tiles/shader.ts. Each thread of the workgroup, in any order,
 * writes its kept light at the rank `rankBefore` reads from the mask, with no per-tile cap, and
 * thread zero writes the two counts from `maskTotal`.
 *
 * The tile layout is read from the shader's own WGSL constants, never restated here, so a
 * shader whose record has no room for a light it keeps fails the port: a write that leaves its
 * list lands in the neighbouring list or tile on the GPU, and throws here.
 */

export type TileLayout = {
  threads: number;
  maxLights: number;
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

/** The tile record layout the shader declares. */
export function tileLayout(shader: string): TileLayout {
  const tileSize = wgslConstant(shader, 'TILE_SIZE');
  const opaqueMask = wgslConstant(shader, 'OPAQUE_MASK');
  const blendMask = wgslConstant(shader, 'BLEND_MASK');
  return {
    threads: tileSize * tileSize,
    maxLights: wgslConstant(shader, 'MAX_LIGHTS'),
    stride: wgslConstant(shader, 'TILE_STRIDE'),
    opaqueBase: wgslConstant(shader, 'TILE_OPAQUE_BASE'),
    blendBase: wgslConstant(shader, 'TILE_BLEND_BASE'),
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

/**
 * One tile's record after the compaction. `hits` is `var<workgroup> hits`: the opaque slice at
 * `OPAQUE_MASK`, the blend slice at `BLEND_MASK`. `lanes` is the order the threads run in.
 */
export function compactTile(
  layout: TileLayout,
  hits: Uint32Array,
  lightCount: number,
  lanes: Iterable<number> = Array.from({ length: layout.threads }, (_, lane) => lane),
): Uint32Array {
  const tiles = new Uint32Array(layout.stride);
  const write = (start: number, end: number, index: number, value: number) => {
    if (index < start || index >= end)
      throw new RangeError(`write at ${index} leaves its list [${start}, ${end})`);
    tiles[index] = value;
  };
  const count = Math.min(lightCount, layout.maxLights);
  for (const lane of lanes) {
    if (lane < count && maskHolds(hits, layout.opaqueMask, lane)) {
      const at = layout.opaqueBase + rankBefore(hits, layout.opaqueMask, lane);
      write(layout.opaqueBase, layout.blendBase, at, lane);
    }
    if (lane < count && maskHolds(hits, layout.blendMask, lane)) {
      const at = layout.blendBase + rankBefore(hits, layout.blendMask, lane);
      write(layout.blendBase, layout.stride, at, lane);
    }
    if (lane === 0) {
      write(0, layout.opaqueBase, 0, maskTotal(hits, layout, layout.opaqueMask));
      write(0, layout.opaqueBase, 1, maskTotal(hits, layout, layout.blendMask));
    }
  }
  return tiles;
}

/** The two lists a record carries, each read up to its count. */
export function tileLists(layout: TileLayout, tiles: Uint32Array) {
  return {
    opaque: [...tiles.subarray(layout.opaqueBase, layout.opaqueBase + tiles[0])],
    blend: [...tiles.subarray(layout.blendBase, layout.blendBase + tiles[1])],
  };
}
