/**
 * Oracle D4 : deux portages fidèles, ligne à ligne, de la compaction de fin de `lightTiles` dans
 * gpuLightTilesShader.ts. `compactSerial` est l'ancien noyau (le fil zéro seul, une boucle
 * `index<count`). `compactRank` est le noyau du lot D4 : chaque fil retenu lit son rang par
 * `countOneBits` sur le masque déjà construit (mot par mot avant le sien, puis les bits avant lui
 * dans son mot) et écrit sa lampe à cette place, sans dépendre de l'ordre d'exécution des fils.
 *
 * `hits` est le masque de bits retenus, un u32 par tranche de 32 lampes, exactement comme
 * `var<workgroup> hits`. Une lampe hors de `[0, count)` n'a jamais son bit posé, comme le fait la
 * garde `lane<count` avant l'écriture du masque côté shader.
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
