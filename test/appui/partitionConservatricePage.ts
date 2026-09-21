// Page side of the proof "GPU partition is conservative".
//
// The real engine draws the bench scene, camera moving along the bench trajectory. After each
// frame, `partitionAudit()` returns what the GPU wrote — screen rectangle and depth bound of
// EVERY resident row — with world corners in double precision and the matrices it drew them
// from. The reference is recomputed on those same inputs and the two are compared
// cluster by cluster (`partitionReference.ts`).

import { compareAudit, emptyTotals } from './partitionReference.ts';
import { checkOcclusionAudit, emptyOcclusionTotals } from './transparentOcclusionReference.ts';

export async function auditPoses(options) {
  const sdk = await import(options.sdkUrl);

  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const evenements = [];
  const explorer = await sdk.createExplorer(canvas, {
    manifestUrl: options.manifestUrl,
    scope: 'full',
    width: options.width,
    height: options.height,
    pixelRatio: 1,
    replicaCount: options.instances,
    detail: 'source',
    pixelError: options.pixelError,
    lodAdaptive: false,
    maxResidentPages: options.maxPages,
    preload: 'visible',
    backends: [sdk.webgpuPagesBackend],
    comparisonLayout: 'single',
    clearColor: 0x2a303c,
    diagnosticDetail: 'summary',
    onDiagnostic: (event) => {
      if (/error|fallback|failed|lost/.test(event.phase)) evenements.push(event);
    },
  });
  const total = emptyTotals();
  const occultation = emptyOcclusionTotals();
  const violationsOccultation = [];
  const images = [];
  try {
    // Warmup: residency fills before the first pose is audited, so the audit bears on drawn
    // rows and not on a still-empty table.
    explorer.setPose(options.poses[0]);
    for (let i = 0; i < options.warmup; i++) {
      explorer.render(options.poses[0]);
      await explorer.flush();
    }
    for (const pose of options.poses) {
      const frame = explorer.render(pose);
      await explorer.flush();
      const audit = await explorer.partitionAudit();
      if (!audit) return { erreur: 'no GPU partition: the audit returned nothing', evenements };
      const avant = { ...total };
      compareAudit(audit, total);
      // Transparent clusters are not rows: their audit is separate, and it bears on what the GPU
      // REMOVED from the table — each must stay rejected by the reference.
      const rejets = await explorer.transparentOcclusionAudit();
      const avantRejets = occultation.rejetees;
      if (rejets) violationsOccultation.push(...checkOcclusionAudit(rejets, occultation));
      const metriques = frame ?? {};
      images.push({
        lignes: audit.rows,
        transparentsRejetes: occultation.rejetees - avantRejets,
        clusters: total.clusters - avant.clusters,
        coupes: total.coupes - avant.coupes,
        cpuSelectMs: metriques.cpuSelectMs ?? null,
        gpuSelectionFallback: metriques.gpuSelectionFallback ?? null,
        uncoveredTriangles: metriques.uncoveredTriangles ?? null,
        hizTestedClusters: metriques.hizTestedClusters ?? null,
        hizRejectedClusters: metriques.hizRejectedClusters ?? null,
        hizOversizedClusters: metriques.hizOversizedClusters ?? null,
        hizCountedFrame: metriques.hizCountedFrame ?? null,
      });
    }
  } catch (error) {
    return { erreur: String(error) + (error?.stack ?? ''), evenements, images, total };
  } finally {
    explorer.dispose();
    canvas.remove();
  }
  return {
    evenements,
    images,
    occultation,
    violationsOccultation,
    total: {
      ...total,
      margeTexelsMoyenne: total.margeTexelsCount
        ? total.margeTexelsSomme / total.margeTexelsCount
        : null,
      ecartProfondeurMoyen: total.compares ? total.ecartProfondeurSomme / total.compares : null,
    },
  };
}
