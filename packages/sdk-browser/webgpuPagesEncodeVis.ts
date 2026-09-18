import type { EngineCamera } from './cameraWorld.ts';
import { VIS_MAX_PAGES } from './visibilityBuffer.ts';
import { encodeWebgpuPartition } from './webgpuVisibilityPartition.ts';
import { uploadRowCorners } from './webgpuVisibilityCorners.ts';
import { clearDrawItemWords, refreshDrawItemWords } from './webgpuVisibilityItemWords.ts';
import { encodeHizMidFrame, encodeWebgpuVisibilityPasses } from './webgpuVisibilityPasses.ts';
import { ensureUniform } from './webgpuPagesPipelineFor.ts';
import { visLayerTop } from './webgpuVisibilityUniforms.ts';
import { createRenderEncoder, submitColorCopy } from './webgpuPagesEncoder.ts';
import { encodeSurfaceLighting } from './webgpuPagesEncodeBlend.ts';
import { uploadDirtyRows } from './webgpuPagesEncodeDraws.ts';
import { uploadClusterSpheres } from './webgpuShadowBounds.ts';
import {
  encodeEmptySurfaces,
  encodeRaster,
  ensureGpuRaster,
  ensureVisBindings,
  surfaceColorAttachments,
} from './webgpuPagesEncodeVisSetup.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** The visibility-buffer image: occluder and rest raster passes, small triangles, material surfaces,
 *  lighting and presentation, all in the image's command buffer. Returns the triangles submitted. */
export function encodeVis(rt: WebgpuPagesRuntime, device: GPUDevice, cam: EngineCamera) {
  const { gpu, vis, run, timing, blendState, layout } = rt,
    { rows, drawSlots } = layout;
  if (
    !vis.visBindGroupLayout ||
    !gpu.cache ||
    !vis.concatPos ||
    !gpu.colorView ||
    !gpu.depthView ||
    !vis.visView ||
    !vis.visPipelineBack ||
    !vis.shadePipeline ||
    !vis.pageTable ||
    !rows.pageTableInts
  )
    return 0;
  const idsView = vis.visView,
    depthTarget = gpu.depthView;
  const [width, height] = gpu.targetSize;
  if (!rows.packedCount) return encodeEmptySurfaces(rt, device, cam, depthTarget);
  ensureUniform(rt, device, Math.max(1, rows.packedCount + blendState.blendGpu.length));
  ensureGpuRaster(rt, device);
  const maxVertexCount = Math.max(1, rt.setup.pageBytes / 4);
  const useIndirect = !!vis.gpuDraw && rows.packedCount <= drawSlots;
  // The table holds every row ever claimed, so a row a page keeps stays valid across frames.
  const tableRows = rows.rowCount;
  if (tableRows > VIS_MAX_PAGES)
    throw new Error(
      `VISIBILITY_ID_RANGE: ${tableRows} pages exceed the ${VIS_MAX_PAGES} a visibility identifier addresses`,
    );
  // Les mots de fiche ne suivent que la table de lignes : la plage sale de cette image-ci, et rien
  // de plus. Il faut les tenir à jour AVANT `uploadDirtyRows`, qui referme cette plage.
  const words = refreshDrawItemWords(rt, visLayerTop(rt.vis), vis.gpuDraw);
  timing.encodeCounts.fichesTeleversees = Math.max(0, words.to - words.from + 1);
  // Les sphères monde des lignes que la table vient de changer, sur le même intervalle sale que la
  // table elle-même : c'est ce que le rejet des ombres lit, et rien d'autre ne les écrit.
  if (rt.lights.cull) uploadClusterSpheres(rt, device, rows.dirtyFrom, rows.dirtyTo);
  // Les coins monde des mêmes lignes, sur le même intervalle : ce que la projection GPU lit. Comme
  // les deux au-dessus, il se prend AVANT `uploadDirtyRows`, qui referme cette plage.
  if (vis.gpuPartition) uploadRowCorners(rt, vis.gpuPartition);
  uploadDirtyRows(rt, device);
  ensureVisBindings(rt, device, tableRows);
  const encoder = createRenderEncoder(rt, device);
  // La partition de l'image ouvre le tampon de commandes : elle écrit les bits de reste et les
  // comptes par slot que la compaction de dessin lit juste après, et les bornes que le test
  // d'occultation lira plus loin. Elle relit au passage les verdicts de l'image précédente, que le
  // test de celle-ci n'a pas encore remis à zéro : c'est ce qui alimente l'historique d'occulteurs.
  const { twoPass } = encodeWebgpuPartition(rt, encoder, cam, useIndirect);
  // Les mots de fiche restatent les lignes : le téléversement de leur plage est ce qui consomme
  // le drapeau de changement.
  if (useIndirect) {
    vis.gpuDraw!.encode(
      encoder,
      layout.drawItemWords,
      rows.packedCount,
      words.from,
      words.to,
      maxVertexCount,
      run.gpuFrameActive ? run.gpuSelection : undefined,
    );
    clearDrawItemWords(words);
    rows.rowsChanged = false;
  }
  // Le raster matériel est le producteur de l'image opaque : profondeur, identifiants et niveau
  // zéro de la pyramide sortent de ses deux passes. Le raster de calcul ne le remplace que sous la
  // variante `raster-calcul`, et lui rend la main dès qu'une ressource lui manque.
  rt.run.hizPyramidFresh = false;
  const dispatched = vis.gpuRaster
    ? encodeRaster(rt, encoder, twoPass, tableRows, maxVertexCount, idsView, depthTarget, (mid) =>
        encodeHizMidFrame(rt, device, mid, tableRows),
      )
    : null;
  run.gpuComputeDispatches = dispatched ?? 0;
  if (dispatched === null)
    encodeWebgpuVisibilityPasses(rt, device, encoder, twoPass, tableRows, useIndirect);
  // Les compteurs que la carte vient d'écrire — partition et verdicts d'occultation — sont copiés
  // une image sur quinze, et mappés une fois l'image soumise. Aucune image n'attend ce retour.
  if (vis.gpuPartition?.countsDue(run.frame)) vis.gpuPartition.encodeCounts(encoder, run.frame);
  if (!gpu.surfaces || !gpu.deferred || !gpu.hdrView) throw new Error('DEFERRED_UNAVAILABLE');
  const shadePass = encoder.beginRenderPass({
    label: 'WG material surfaces v1',
    colorAttachments: surfaceColorAttachments(gpu.surfaces),
  });
  shadePass.setViewport(0, 0, width, height, 0, 1);
  if (vis.shadeBindGroup) {
    shadePass.setPipeline(vis.shadePipeline);
    shadePass.setBindGroup(0, vis.shadeBindGroup);
    shadePass.draw(3);
    run.gpuDrawCalls++;
  }
  shadePass.end();
  const presented = encodeSurfaceLighting(rt, device, encoder, cam, rows.packedCount);
  submitColorCopy(rt, device, encoder, height, width, presented);
  // Les triangles soumis sont ceux de toutes les lignes dessinables : les deux moitiés sont
  // dessinées, et un cluster que le test d'occultation rejette a quand même été soumis. Le total
  // est tenu par la table de lignes, sur sa seule plage sale.
  return layout.itemWordsHold.total + run.blendSubmittedTriangles;
}
