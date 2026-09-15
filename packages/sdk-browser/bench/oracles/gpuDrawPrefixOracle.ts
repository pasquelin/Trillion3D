/**
 * Oracle : deux portages fidèles, ligne à ligne, du noyau `prefixGroups` de gpuDrawShader.ts.
 *
 * `prefixSerial` est le noyau en place (un seul fil, `@workgroup_size(1)`) : il parcourt les slots
 * dans l'ordre et fait avancer un curseur unique. `prefixParallel` est le noyau candidat du point D3
 * (`@workgroup_size(64)`), écrit et prouvé mais non fusionné — `gpuDraw.test.ts` épingle la taille du
 * groupe de travail et ce lot ne touche pas aux attentes des tests existants : chaque fil (lane)
 * totalise les slots qui lui reviennent par pas de 64,
 * une barrière de groupe de travail sépare cette phase du calcul des décalages, puis chaque fil
 * reconstruit son curseur en resommant les totaux des slots qui le précèdent. Les deux calculent en
 * u32 (`>>> 0`), comme le fait WGSL.
 *
 * Ce fichier ne dépend d'aucune exécution GPU réelle : `webgpuPagesMockCompute.ts` ne rejoue pas
 * `prefixGroups` (il court-circuite toute la compaction avec l'oracle CPU `evaluateDrawCompact`),
 * donc l'équivalence des deux noyaux se prouve ici par transcription directe et comparaison.
 */

const WORKGROUP = 64;
const U32 = (n: number) => n >>> 0;

export type PrefixResult = {
  totals: Uint32Array; // ce que writeCmd(slot, ...) écrirait dans indirect[slot*4+1]
  offsets: Uint32Array; // groupOffsets, longueur groupCount*slots ; 0 pour un slot vide (jamais lu)
};

export function prefixSerial(
  overflow: boolean,
  slotUsed: Uint32Array,
  groupCounts: Uint32Array,
  groupCount: number,
  slots: number,
): PrefixResult {
  const totals = new Uint32Array(slots);
  const offsets = new Uint32Array(groupCount * slots);
  if (overflow) return { totals, offsets };
  let slotStart = 0;
  for (let slot = 0; slot < slots; slot++) {
    if (slotUsed[slot] === 0) continue;
    let total = 0;
    for (let group = 0; group < groupCount; group++)
      total = U32(total + groupCounts[group * slots + slot]);
    let cursor = slotStart;
    for (let group = 0; group < groupCount; group++) {
      const entry = group * slots + slot;
      offsets[entry] = cursor;
      cursor = U32(cursor + groupCounts[entry]);
    }
    totals[slot] = total;
    slotStart = U32(slotStart + total);
  }
  return { totals, offsets };
}

export function prefixParallel(
  overflow: boolean,
  slotUsed: Uint32Array,
  groupCounts: Uint32Array,
  groupCount: number,
  slots: number,
): PrefixResult {
  const totals = new Uint32Array(slots);
  const offsets = new Uint32Array(groupCount * slots);
  if (overflow) return { totals, offsets };
  const slotTotals = new Uint32Array(slots);
  // Phase 1 : un fil par slot, par pas de 64 ; l'ordre des lanes n'importe pas, l'addition en u32
  // est associative et commutative — on parcourt volontairement les lanes en ordre inverse pour
  // le prouver.
  for (let lane = WORKGROUP - 1; lane >= 0; lane--) {
    for (let slot = lane; slot < slots; slot += WORKGROUP) {
      if (slotUsed[slot] === 0) continue;
      let total = 0;
      for (let group = 0; group < groupCount; group++)
        total = U32(total + groupCounts[group * slots + slot]);
      slotTotals[slot] = total;
      totals[slot] = total;
    }
  }
  // workgroupBarrier() : tous les slotTotals sont posés avant que quiconque ne les resomme.
  for (let lane = WORKGROUP - 1; lane >= 0; lane--) {
    for (let slot = lane; slot < slots; slot += WORKGROUP) {
      if (slotUsed[slot] === 0) continue;
      let cursor = 0;
      for (let before = 0; before < slot; before++) cursor = U32(cursor + slotTotals[before]);
      for (let group = 0; group < groupCount; group++) {
        const entry = group * slots + slot;
        offsets[entry] = cursor;
        cursor = U32(cursor + groupCounts[entry]);
      }
    }
  }
  return { totals, offsets };
}
