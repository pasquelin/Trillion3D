/**
 * Oracle D4: a line-by-line port of the batched compaction of `lightTiles` in
 * packages/sdk-browser/src/lighting/tiles/{shader,compactWgsl}.ts. The scene's lights are tested
 * a batch at a time, one per thread; each thread, in any order, writes its kept light at what the
 * batches before kept plus the rank `rankBefore` reads from the batch's mask while that rank is
 * within its slice's room; thread zero counts a full batch between batches and writes the two
 * true counts, the last batch's filled words added, once every batch is done. A slice whose count
 * passes `TILE_LIGHTS` reserves room for all of them in the pool (`spill`) and they are written
 * there — from the masks a one-batch scene still holds, else by a second walk; a pool with no
 * room raises its overflow and the reader walks every light (`tileSlice` of the resolve, #849).
 * `tests/browser/probes/light-tiles-spill-gpu.ts` runs the WGSL itself against this port.
 *
 * The tile layout is read from the shader's own WGSL constants, never restated here, so a shader whose
 * record has no room for a light it keeps fails the port: a write that leaves its list lands in
 * the neighbouring list or tile on the GPU, and throws here.
 */

export type TileLayout = {
  threads: number;
  tileLights: number;
  stride: number;
  opaqueBase: number;
  blendBase: number;
  shadowBase: number;
  opaqueMask: number;
  blendMask: number;
  words: number;
  noSlice: number;
};

/** The view's pool, as `TilePool` of the shader: room, words reserved, overflow word. The
 *  oracle's pool starts right after its one tile record. */
export type TilePool = { capacity: number; head: number; overflow: number };

function wgslConstant(shader: string, name: string) {
  const found = new RegExp(`const ${name}:u32=(0x[\\da-f]+|\\d+)u;`).exec(shader);
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
    tileLights: wgslConstant(shader, 'TILE_LIGHTS'),
    stride: wgslConstant(shader, 'TILE_STRIDE'),
    opaqueBase: wgslConstant(shader, 'TILE_OPAQUE_BASE'),
    blendBase: wgslConstant(shader, 'TILE_BLEND_BASE'),
    shadowBase: wgslConstant(shader, 'TILE_SHADOW_BASE'),
    opaqueMask,
    blendMask,
    words: blendMask - opaqueMask,
    noSlice: wgslConstant(shader, 'TILE_NO_SLICE'),
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

function maskTotal(hits: Uint32Array, mask: number, words: number) {
  let total = 0;
  for (let w = 0; w < words; w++) total += countOneBits(hits[mask + w]);
  return total;
}

/** The lights each slice of the tile keeps, by rank in the scene: `shadowed` names those that
 *  carry a shadow slot, so the record's flag word matches the pass's (#1249). */
export type TileKeeps = {
  opaque: Iterable<number>;
  blend: Iterable<number>;
  shadowed?: Iterable<number>;
};

/**
 * One tile's record after the compaction of `lightCount` lights, of which each slice keeps those
 * `keeps` names, followed by the pool. `lanes` is the order the threads run in, within each batch.
 */
export function compactTile(
  layout: TileLayout,
  keeps: TileKeeps,
  lightCount: number,
  lanes: Iterable<number> = Array.from({ length: layout.threads }, (_, lane) => lane),
  pool: TilePool = { capacity: 0, head: 0, overflow: 0 },
): Uint32Array {
  const tiles = new Uint32Array(layout.stride + pool.capacity);
  const opaque = new Set(keeps.opaque),
    blend = new Set(keeps.blend),
    shadow = new Set(keeps.shadowed ?? []),
    order = [...lanes],
    hits = new Uint32Array(2 * layout.words),
    batch = layout.words * 32,
    masks = [layout.opaqueMask, layout.blendMask],
    // Where each slice writes, how many it has room for, and the range that write must stay in.
    start = [layout.opaqueBase, layout.blendBase],
    room = [layout.tileLights, layout.tileLights],
    ends = [layout.blendBase, layout.stride];
  const write = (slice: number, index: number, value: number) => {
    if (index < start[slice] || index >= ends[slice])
      throw new RangeError(`write at ${index} leaves its list [${start[slice]}, ${ends[slice]})`);
    tiles[index] = value;
  };
  let kept = [0, 0];
  // `writeBatch`: each thread, in any order, writes its kept light at its rank within its room.
  const writeBatch = (first: number) => {
    for (const lane of order)
      for (const slice of [0, 1]) {
        const index = first + lane;
        if (index >= lightCount || !maskHolds(hits, masks[slice], lane)) continue;
        const at = kept[slice] + rankBefore(hits, masks[slice], lane);
        if (at < room[slice]) write(slice, start[slice] + at, index);
      }
  };
  const walk = () => {
    for (let first = 0; first < lightCount; first += batch) {
      if (first > 0) {
        kept = kept.map((sum, slice) => sum + maskTotal(hits, masks[slice], layout.words));
        hits.fill(0);
      }
      for (let lane = 0; lane < batch && first + lane < lightCount; lane++) {
        const bit = 1 << (lane & 31);
        if (opaque.has(first + lane)) hits[layout.opaqueMask + (lane >>> 5)] |= bit;
        if (blend.has(first + lane)) hits[layout.blendMask + (lane >>> 5)] |= bit;
      }
      writeBatch(first);
    }
  };
  walk();
  // The last batch's words: those its lights fill.
  const live = Math.ceil(
    (lightCount - Math.floor(Math.max(lightCount - 1, 0) / batch) * batch) / 32,
  );
  const total = kept.map((sum, slice) => sum + maskTotal(hits, masks[slice], live));
  [tiles[0], tiles[1]] = total;
  // The record's last word: one when the opaque slice keeps a light with a shadow slot (#1249).
  tiles[layout.shadowBase] = [...opaque].some((rank) => shadow.has(rank)) ? 1 : 0;
  if (Math.max(...total) <= layout.tileLights) return tiles;
  // `spill`, thread zero, then the slices written again.
  for (const slice of [0, 1]) {
    const slot = start[slice];
    room[slice] = 0;
    if (total[slice] <= layout.tileLights) continue;
    const at = pool.head < 0x80000000 ? pool.head : 0xffffffff;
    if (at !== 0xffffffff) pool.head += total[slice];
    let first = layout.noSlice;
    if (at < pool.capacity && total[slice] <= pool.capacity - at) {
      first = layout.stride + at;
      room[slice] = total[slice];
      ends[slice] = first + total[slice];
    } else pool.overflow = 1;
    start[slice] = first;
    tiles[slot] = first;
  }
  kept = [0, 0];
  // One batch: its masks are still whole, the kept lights are written again from them. The lists
  // are those a second walk writes; what differs is the GPU's work, no light tested twice.
  if (lightCount <= batch) writeBatch(0);
  else {
    hits.fill(0);
    walk();
  }
  return tiles;
}

/** The lights a pixel of the tile walks in each slice, as `tileSlice` of the resolve reads
 *  them: its list, past `TILE_LIGHTS` its slice of the pool, and every light of the scene when
 *  the pool had no room. `record` is the tile's first word in `tiles`, whose pool indices are
 *  absolute: 0 for the oracle's one record, `tile × stride` in the pass's whole buffer. */
export function tileLists(layout: TileLayout, tiles: Uint32Array, lightCount: number, record = 0) {
  const walk = (count: number, base: number) => {
    const first = count <= layout.tileLights ? record + base : tiles[record + base];
    return first === layout.noSlice
      ? Array.from({ length: lightCount }, (_, index) => index)
      : [...tiles.subarray(first, first + count)];
  };
  return {
    opaque: walk(tiles[record], layout.opaqueBase),
    blend: walk(tiles[record + 1], layout.blendBase),
  };
}
