import type { PageRec } from './pageSelection.ts';
import type { createWebgpuBlendState } from './webgpuBlendState.ts';
type BlendState = ReturnType<typeof createWebgpuBlendState>;

/**
 * The transparent draw list of one image.
 *
 * Paged primitives are always listed: how many of their clusters survive is the compaction's answer,
 * not the CPU's, and a primitive whose cut is empty simply draws zero instances. Only an unpaged
 * primitive — one whole mesh, outside the cluster DAG — is still culled here, against its own world
 * box, exactly as before.
 */
export function selectWebgpuBlend(blendState: BlendState) {
  let rejected = 0;
  for (const item of blendState.blendGpu) {
    if (item.paged) {
      blendState.visibleBlend.push(item);
      continue;
    }
    if (item.bounds && !blendState.blendFrustum.intersectsBox(item.bounds)) rejected++;
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
