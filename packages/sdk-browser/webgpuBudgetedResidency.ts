import type { PageRec } from './pageSelection.ts';
import type { createWebgpuPageTracking } from './webgpuPageTracking.ts';
type Tracking = ReturnType<typeof createWebgpuPageTracking>;

/** Chooses a complete root cover plus the coarsest detail that fits the residency budget. */
export function createBudgetedResidency(
  tracking: Tracking,
  bootstrapKey: Uint8Array,
  bootstrapUrls: Set<string>,
  slots: number,
) {
  /**
   * Residency the GPU page budget can actually hold. The pinned roots come first and are never given
   * up, then the wanted clusters coarsest first, so what survives is always a complete cover plus as
   * much detail as fits. A cut wider than the budget is coarsened by `budgetPixelError`, so this
   * bound only smooths the frames it takes that feedback to settle; it never truncates the drawn cut.
   */
  const residencyScratch: PageRec[] = [];
  return (pages: readonly PageRec[]) => {
    const room = Math.max(0, slots - bootstrapUrls.size);
    residencyScratch.length = 0;
    for (let i = 0; i < pages.length; i++)
      if (!bootstrapKey[tracking.keyOf(pages[i])]) residencyScratch.push(pages[i]);
    if (residencyScratch.length <= room) return residencyScratch;
    // Coarse clusters cover more surface per slot and are what the residency fallback steps back to.
    residencyScratch.sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
    residencyScratch.length = room;
    return residencyScratch;
  };
}
