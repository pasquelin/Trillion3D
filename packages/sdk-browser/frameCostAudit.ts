import * as THREE from 'three';
import { frustumExcludesBox, type FrameMetrics } from '../sdk-core/index.ts';
import { enginePose, type EngineCamera } from './cameraWorld.ts';
import { SDK_BUILD_PROVENANCE } from './buildProvenance.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** La question posée à l'URL, et la réponse qu'elle a donnée : la chaîne est relue à chaque appel —
 *  l'audit est interrogé par image — mais elle n'est analysée qu'une fois par chaîne. */
let auditSearch: string | undefined,
  auditEnabled = false;

/** Audit opt-in, sans trace par image : ajouter `wgFrameAudit=1` à l'URL de l'hôte. */
export function frameCostAuditEnabled() {
  const search = typeof location === 'undefined' ? undefined : location.search;
  if (search !== auditSearch) {
    auditSearch = search;
    auditEnabled = search !== undefined && new URLSearchParams(search).get('wgFrameAudit') === '1';
  }
  return auditEnabled;
}

/** La sérialisation et la console restent hors de l'appel de rendu mesuré. */
export function logFrameCostAudit(backend: string, context: Record<string, unknown>) {
  if (!frameCostAuditEnabled()) return;
  queueMicrotask(() => {
    try {
      console.info('[WG frame audit]', JSON.stringify({ backend, ...context }));
    } catch {
      // Un observateur ne doit jamais interrompre le rendu.
    }
  });
}

/** La vue telle que l'audit la publie : la pose monde de la caméra du moteur, et son champ. */
const poseDeLaVue = (cam: EngineCamera) => ({
  ...enginePose(cam),
  fov: cam.fov,
  near: cam.near,
  far: cam.far,
});

/** Compte une fois par relevé les commandes dont la boîte est entièrement hors champ.
 * Ce minorant n'invente pas les résultats du masque GPU et ne modifie aucune sélection. */
export function gpuFrameCostSnapshot(rt: WebgpuPagesRuntime) {
  if (!frameCostAuditEnabled()) return undefined;
  let outsideItems = 0,
    outsideDraws = 0,
    unknownBounds = 0;
  const { blendState, run, timing } = rt;
  for (const item of blendState.visibleBlend) {
    const box = item.bounds;
    if (!box) {
      unknownBounds++;
      continue;
    }
    if (!frustumExcludesBox(blendState.blendPlanes, box[0], box[1], box[2], box[3], box[4], box[5]))
      continue;
    outsideItems++;
    const material = Array.isArray(item.material) ? item.material[0] : item.material;
    outsideDraws += material.side === THREE.DoubleSide && !material.forceSinglePass ? 2 : 1;
  }
  return {
    selection: run.gpuFrameActive ? 'gpu' : 'cpu',
    // La pose publiée est celle de la caméra du moteur, que l'entrée d'image vient de recopier :
    // aucune caméra de l'hôte n'est relue ici, et rien n'est lu tant qu'aucune image n'a été rendue.
    camera: run.lastCamera && poseDeLaVue(run.gate.cam),
    resolution: [...rt.gpu.targetSize],
    pixelError: run.diagnosticPixelError,
    transparentCandidates: blendState.blendGpu.length,
    transparentListed: blendState.visibleBlend.length,
    transparentEncodedDraws: run.blendDrawCalls,
    transparentSelectMs: timing.transparentSelectMs,
    transparentPrepareMs: timing.transparentPrepareMs,
    transparentDrawMs: timing.transparentDrawMs,
    transparentSpanUploadBytes: timing.transparentSpanUploadBytes,
    listedOutsideFrustum: outsideItems,
    outsideDrawsIfTextured: outsideDraws,
    unknownBounds,
    gpuEmptyDraws: null,
    pagedItems: blendState.table?.pagedItems.length ?? 0,
    compactionEntriesWithPadding: blendState.table?.length ?? 0,
    gpuCompactionAvailable: !!blendState.compaction?.encode,
    gpuTiming: timing.lastGpuPassMs,
    gpuFrameMs: timing.lastGpuFrameMs,
    gpuTimingIsAsynchronous: true,
  };
}

/** Les compteurs que le renderer de l'hôte tient. Lus par leur forme : aucun calcul n'en sort, et
 *  l'audit n'a pas à nommer le type d'une bibliothèque qu'il ne fait que consulter. */
type HostRenderer = {
  info: { render: { calls: number; triangles: number } };
  extensions: { has(name: string): boolean };
};

/** Vue hôte, avec vrais compteurs Three quand ce moteur possède le rendu WebGL.
 * Les percentiles CPU détaillés sont publiés séparément par les profils existants. */
export function createHostFrameCostAudit() {
  let last = -Infinity;
  return (backend: string, frame: number, metrics: FrameMetrics, renderer: HostRenderer | null) => {
    if (!frameCostAuditEnabled()) return;
    const now = performance.now();
    if (now - last < 2000) return;
    last = now;
    logFrameCostAudit(backend, {
      kind: 'host',
      frame,
      build: { hash: SDK_BUILD_PROVENANCE.hash, generatedAt: SDK_BUILD_PROVENANCE.generatedAt },
      dpr: typeof devicePixelRatio === 'number' ? devicePixelRatio : null,
      cpuFrameMs: metrics.cpuFrameMs,
      cpuSubmitMs: metrics.cpuSubmitMs,
      cpuSelectMs: metrics.cpuSelectMs,
      reportedDrawCalls: metrics.drawCalls,
      selectedTriangles: metrics.selectedTriangles,
      reportedSubmittedTriangles: metrics.totalSubmittedTriangles,
      transparentDrawCalls: metrics.transparentDrawCalls,
      pagesLoading: metrics.pagesLoading,
      residentPages: metrics.residentPages,
      webglRendererCalls: renderer?.info.render.calls ?? null,
      webglRendererTriangles: renderer?.info.render.triangles ?? null,
      webglMultiDraw: renderer?.extensions.has('WEBGL_multi_draw') ?? null,
    });
  };
}
