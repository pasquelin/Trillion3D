// Batch F oracles, frame side: `webgpuPagesEncodeVis.ts:93-98`, `autonomousInstances.ts:76-86`,
// and `explorerDraw.ts:72-74` from before batch F, copied as-is.

/** Colour attachments, rebuilt per frame before batch F. */
export function referenceAttachments(surfaces) {
  return surfaces.views().map((view) => ({
    view,
    loadOp: 'clear',
    storeOp: 'store',
    clearValue: [0, 0, 0, 0],
  }));
}

/** Instance displacement before batch F: one hash table per call. */
export function referenceUpdateInstance(instance, basePages, baseRoots, transform) {
  const mapped = new Map(basePages.map((base, i) => [instance.pages[i], base]));
  for (let i = 0; i < instance.roots.length; i++)
    instance.roots[i].world.copy(transform).multiply(baseRoots[i].world);
  for (const rec of instance.pages) {
    rec.matrix.copy(transform).multiply(mapped.get(rec).matrix);
    if (rec.mesh) rec.mesh.matrix.copy(rec.matrix);
  }
}

/** The cold ring before batch F: the whole ring filtered, then its head kept. */
export function referenceAnneauFroid(ring, streamer, limite) {
  return ring
    .filter((url) => !streamer.has(url) && !streamer.loading(url) && !streamer.failed(url))
    .slice(0, limite);
}
