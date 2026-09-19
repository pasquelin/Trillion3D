/**
 * Oracle D4: two faithful, line-by-line ports of the end compaction of `lightTiles` in
 * gpuLightTilesShader.ts. `compactSerial` is the old kernel (thread zero alone, a loop
 * `index<count`). `compactRank` is the D4-batch kernel: each kept thread reads its rank by
 * `countOneBits` on the already-built mask (word by word before its own, then the bits before
 * it in its word) and writes its lamp at that place, without depending on thread execution order.
 *
 * `hits` is the kept-bit mask, one u32 per slice of 32 lamps, exactly like
 * `var<workgroup> hits`. A lamp outside `[0, count)` never has its bit set, as the
 * `lane<count` guard does before the mask write on the shader side.
 */

export type CompactResult = { kept: number[]; requested: number };

const countOneBits = (word: number) => {
  let w = word >>> 0,
    n = 0;
  while (w) {
    n += w & 1;
    w >>>= 1;
  }
  return n;
};

export function compactSerial(
  hits: Uint32Array,
  count: number,
  maxTileLights: number,
): CompactResult {
  const kept: number[] = [];
  let requested = 0;
  for (let index = 0; index < count; index++) {
    if (((hits[index >>> 5] >>> (index & 31)) & 1) === 0) continue;
    requested++;
    if (kept.length < maxTileLights) kept.push(index);
  }
  return { kept, requested };
}

export function compactRank(
  hits: Uint32Array,
  count: number,
  maxTileLights: number,
): CompactResult {
  const words = hits.length;
  const kept: number[] = new Array(maxTileLights).fill(-1);
  let maxRankSeen = -1;
  for (let lane = 0; lane < count; lane++) {
    const word = lane >>> 5;
    if (((hits[word] >>> (lane & 31)) & 1) === 0) continue;
    let rank = 0;
    for (let before = 0; before < word; before++) rank += countOneBits(hits[before]);
    rank += countOneBits(hits[word] & ((1 << (lane & 31)) - 1));
    if (rank < maxTileLights) {
      kept[rank] = lane;
      if (rank > maxRankSeen) maxRankSeen = rank;
    }
  }
  let requested = 0;
  for (let w = 0; w < words; w++) requested += countOneBits(hits[w]);
  return { kept: kept.slice(0, maxRankSeen + 1), requested };
}
