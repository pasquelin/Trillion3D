// Côté page de la preuve « la partition GPU est conservatrice ».
//
// Le moteur réel dessine la scène du banc, caméra en mouvement le long de la trajectoire du banc.
// Après chaque image, `partitionAudit()` rend ce que la carte a écrit — rectangle d'écran et borne
// de profondeur de CHAQUE ligne résidente — avec les coins monde en double précision et les matrices
// d'où elle l'a tiré. La référence est recalculée sur ces mêmes entrées et les deux sont comparées
// cluster par cluster (`partitionReference.mjs`).

import { compareAudit, emptyTotals } from './partitionReference.mjs';
import { checkOcclusionAudit, emptyOcclusionTotals } from './transparentOcclusionReference.mjs';

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
    // Chauffe : la résidence se remplit avant que la première pose ne soit auditée, si bien que
    // l'audit porte sur des lignes dessinées et non sur une table encore vide.
    explorer.setPose(options.poses[0]);
    for (let i = 0; i < options.warmup; i++) {
      explorer.render(options.poses[0]);
      await explorer.flush();
    }
    for (const pose of options.poses) {
      const frame = explorer.render(pose);
      await explorer.flush();
      const audit = await explorer.partitionAudit();
      if (!audit) return { erreur: 'aucune partition GPU : l’audit n’a rien rendu', evenements };
      const avant = { ...total };
      compareAudit(audit, total);
      // Les grappes transparentes ne sont pas des lignes : leur audit est à part, et il porte sur
      // ce que la carte a RETIRÉ de la table — chacune doit rester rejetée par la référence.
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
