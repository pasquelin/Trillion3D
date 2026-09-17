import { frustumExcludesBox } from '../sdk-core/index.ts';
import type { PageRec } from './pageSelection.ts';
import type { createWebgpuBlendState } from './webgpuBlendState.ts';
type BlendState = ReturnType<typeof createWebgpuBlendState>;

/**
 * La liste de dessin transparente du CHEMIN DE REPLI, celui des appareils sans tampon de
 * visibilité.
 *
 * Le chemin de production, lui, ne tient pas de liste de dessin : le tronc y est testé avec les
 * clés de classement, et la carte étale le plan trié en instances (`webgpuBlendOrder.ts`). Ici, le
 * tronc rejette les primitives entières, la coupe processeur omet les items sans grappe
 * sélectionnée, et l'ordre source est préservé.
 */
export function selectWebgpuBlend(blendState: BlendState, drawn?: readonly PageRec[]) {
  const selected = blendState.cpuSelectedMeshes;
  selected.clear();
  blendState.visibleBlend.length = 0;
  if (drawn)
    for (const rec of drawn) if (rec.transparent && rec.sourceMesh) selected.add(rec.sourceMesh);
  let rejected = 0;
  for (const item of blendState.blendGpu) {
    if (drawn && item.paged && (!item.sourceMesh || !selected.has(item.sourceMesh))) continue;
    const box = item.bounds;
    if (
      box &&
      frustumExcludesBox(blendState.blendPlanes, box[0], box[1], box[2], box[3], box[4], box[5])
    )
      rejected++;
    else blendState.visibleBlend.push(item);
  }
  return rejected;
}

/**
 * The instance lists of a CPU-cut image, written where the GPU compaction would have written them.
 *
 * The cut names records; the table names the order. Walking the cut once and placing each record at
 * its item's base, then sorting each item's own range by table entry, gives the same list the
 * compaction produces — the table order with the unselected entries removed — so the two paths draw
 * the same primitives in the same order and the shader cannot tell them apart.
 */
export function writeCpuTransparentInstances(
  blendState: BlendState,
  drawn: readonly PageRec[],
  entryOf: (rec: PageRec) => number,
) {
  const { table } = blendState;
  if (!table) return;
  if (blendState.cpuInstances.length < table.capacity)
    blendState.cpuInstances = new Uint32Array(table.capacity);
  if (blendState.cpuItemCounts.length < table.pagedItems.length)
    blendState.cpuItemCounts = new Uint32Array(Math.max(1, table.pagedItems.length));
  const instances = blendState.cpuInstances,
    counts = blendState.cpuItemCounts;
  counts.fill(0);
  let highest = 0;
  for (let i = 0; i < drawn.length; i++) {
    const rec = drawn[i];
    if (!rec.transparent) continue;
    const item = rec.sourceMesh && blendState.pagedBlendGpu.get(rec.sourceMesh);
    if (!item || item.pagedIndex === undefined) continue;
    const entry = entryOf(rec);
    if (entry < 0) continue;
    const base = table.itemRanges[item.pagedIndex * 2];
    instances[base + counts[item.pagedIndex]++] = entry;
    if (base + counts[item.pagedIndex] > highest) highest = base + counts[item.pagedIndex];
  }
  for (const item of table.pagedItems) {
    const index = item.pagedIndex!,
      base = table.itemRanges[index * 2],
      count = counts[index];
    // La liste arrive presque toujours déjà croissante — la relecture publie ses pages dans l'ordre
    // du catalogue, et les entrées de la table y sont rangées par rang source. Un parcours le
    // constate, là où un tri inconditionnel triait par primitive et par image.
    let ordonnee = true;
    for (let k = base + 1; k < base + count; k++)
      if (instances[k - 1] > instances[k]) {
        ordonnee = false;
        break;
      }
    if (!ordonnee) instances.subarray(base, base + count).sort();
  }
  blendState.cpuInstanceCount = highest;
}
