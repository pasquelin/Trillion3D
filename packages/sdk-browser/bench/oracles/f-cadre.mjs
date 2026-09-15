// Oracles du lot F, côté image : `webgpuPagesEncodeVis.ts:93-98`, `autonomousInstances.ts:76-86`,
// et `explorerDraw.ts:72-74` d'avant le lot F, recopiés tels quels.

/** Les pièces jointes de couleur, reconstruites par image avant le lot F. */
export function referenceAttachments(surfaces) {
  return surfaces.views().map((view) => ({
    view,
    loadOp: 'clear',
    storeOp: 'store',
    clearValue: [0, 0, 0, 0],
  }));
}

/** Le déplacement d'une instance avant le lot F : une table de hachage par appel. */
export function referenceUpdateInstance(instance, basePages, baseRoots, transform) {
  const mapped = new Map(basePages.map((base, i) => [instance.pages[i], base]));
  for (let i = 0; i < instance.roots.length; i++)
    instance.roots[i].world.copy(transform).multiply(baseRoots[i].world);
  for (const rec of instance.pages) {
    rec.matrix.copy(transform).multiply(mapped.get(rec).matrix);
    if (rec.mesh) rec.mesh.matrix.copy(rec.matrix);
  }
}

/** L'anneau froid avant le lot F : tout l'anneau filtré, puis sa tête gardée. */
export function referenceAnneauFroid(ring, streamer, limite) {
  return ring
    .filter((url) => !streamer.has(url) && !streamer.loading(url) && !streamer.failed(url))
    .slice(0, limite);
}
