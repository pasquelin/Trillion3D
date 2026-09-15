import type { PageRec } from './pageSelection.ts';
import type { createGpuPageCache } from './gpuPages.ts';
import type { createWebgpuBlendState } from './webgpuBlendState.ts';
type BlendState = ReturnType<typeof createWebgpuBlendState>;
type Cache = ReturnType<typeof createGpuPageCache>;

const ordreSource = (a: PageRec, b: PageRec) => (a.sourceOrder ?? a.id) - (b.sourceOrder ?? b.id);

/**
 * Remet une coupe transparente dans l'ordre source. Elle y arrive presque toujours ; un parcours le
 * dit, là où le tri coûtait un tri par maillage transparent et par image. Le test refuse tout couple
 * qui ne compare pas franchement « inférieur ou égal » — une clé NaN le fait échouer et le tri reprend
 * la main — si bien que l'ordre rendu est toujours celui d'un tri stable.
 */
export function ordonneCoupeTransparente(cut: PageRec[]) {
  for (let k = 1; k < cut.length; k++)
    if (!(ordreSource(cut[k - 1], cut[k]) <= 0)) {
      cut.sort(ordreSource);
      return cut;
    }
  return cut;
}

/** Selects transparent meshes, packs their resident cluster indices, and counts culls. */
export function selectWebgpuBlend(
  device: GPUDevice,
  blendState: BlendState,
  drawn: PageRec[],
  cache: Cache | undefined,
) {
  let rejected = 0;
  if (blendState.pagedBlendGpu.size) {
    const previousLength = blendState.blendDrawnPages.length;
    let count = 0,
      changed = false;
    for (const rec of drawn) {
      if (!rec.transparent) continue;
      if (blendState.blendDrawnPages[count] !== rec) changed = true;
      blendState.blendDrawnPages[count++] = rec;
    }
    blendState.blendDrawnPages.length = count;
    if (changed || count !== previousLength) {
      blendState.blendCuts.clear();
      for (const rec of blendState.blendDrawnPages) {
        const item = rec.sourceMesh && blendState.pagedBlendGpu.get(rec.sourceMesh);
        if (!item) continue;
        let cut = blendState.blendCuts.get(item);
        if (!cut) blendState.blendCuts.set(item, (cut = []));
        cut.push(rec);
      }
    }
  }
  for (const item of blendState.blendGpu) {
    if (!item.paged) {
      if (item.bounds && !blendState.blendFrustum.intersectsBox(item.bounds)) rejected++;
      else blendState.visibleBlend.push(item);
      continue;
    }
    const cut = blendState.blendCuts.get(item);
    if (!cut?.length) {
      rejected++;
      continue;
    }
    if (cut !== item.cut) {
      ordonneCoupeTransparente(cut);
      if (item.cut && cut.length === item.cut.length && cut.every((rec, i) => rec === item.cut![i]))
        blendState.blendCuts.set(item, item.cut);
      else {
        let count = 0;
        for (const rec of cut) {
          if (!rec.array || !cache?.get(rec.url))
            throw new Error('GPU_TRANSPARENT_COVERAGE_INCOMPLETE');
          count += rec.array.length;
        }
        const bytes = count * 4;
        if (
          bytes > Math.min(device.limits.maxBufferSize, device.limits.maxStorageBufferBindingSize)
        )
          throw new Error('GPU_TRANSPARENT_INDEX_BUDGET');
        if (!item.packed || item.packed.length < count) item.packed = new Uint32Array(count);
        let offset = 0;
        for (const rec of cut) {
          item.packed.set(rec.array!, offset);
          offset += rec.array!.length;
        }
        if (item.index.size < bytes) {
          item.index.destroy();
          item.index = device.createBuffer({
            label: 'WG transparent selected indices',
            size: Math.max(4, bytes),
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          });
          item.group = undefined;
        }
        device.queue.writeBuffer(item.index, 0, item.packed.subarray(0, count));
        item.count = count;
        item.cut = cut;
      }
    }
    blendState.visibleBlend.push(item);
  }
  return rejected;
}
