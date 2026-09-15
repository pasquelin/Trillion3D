import * as THREE from 'three';
import { frustumExcludesBox, type FrameMetrics } from '../sdk-core/index.ts';
import { SDK_BUILD_PROVENANCE } from './buildProvenance.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Audit opt-in, sans trace par image : ajouter `wgFrameAudit=1` à l'URL de l'hôte. */
export function frameCostAuditEnabled() {
  return (
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('wgFrameAudit') === '1'
  );
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
    camera: run.lastCamera && {
      position: run.lastCamera.position.toArray(),
      quaternion: run.lastCamera.quaternion.toArray(),
      fov: run.lastCamera.fov,
      near: run.lastCamera.near,
      far: run.lastCamera.far,
    },
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

/** Vue hôte, avec vrais compteurs Three quand ce moteur possède le rendu WebGL.
 * Les percentiles CPU détaillés sont publiés séparément par les profils existants. */
export function createHostFrameCostAudit() {
  const enabled = frameCostAuditEnabled();
  let last = -Infinity;
  return (
    backend: string,
    frame: number,
    metrics: FrameMetrics,
    renderer: THREE.WebGLRenderer | null,
  ) => {
    if (!enabled) return;
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
