import * as THREE from 'three';
import { EngineError } from '../sdk-core/index.ts';
import { PREFETCH_BATCH, PREFETCH_INTERVAL_MS } from './backendCommon.ts';
import { PRIORITY_PREFETCH } from './streamingPriority.ts';
import { createWebglFrameTimer } from './webglFrameTimer.ts';
import type { RenderBackend } from './backendTypes.ts';
import type { HostCpuProfile } from './hostCpuProfile.ts';
import { createHeldFrame } from './explorerHeldFrame.ts';
import type { createPageStreamer } from './streamingPages.ts';
import type { createExplorerStreaming } from './explorerStreaming.ts';
import type { ExplorerHostState } from './explorerHostState.ts';
import type { ExplorerSession } from './explorerSession.ts';

type Inputs = {
  camera: THREE.PerspectiveCamera;
  geometryUrls: Set<string>;
  streamer: ReturnType<typeof createPageStreamer>;
  streaming: ReturnType<typeof createExplorerStreaming>;
  directGpu: boolean;
  renderer: THREE.WebGLRenderer;
  baseline: RenderBackend;
  state: Pick<ExplorerHostState, 'measuring' | 'fallbackReason' | 'active'>;
};

/**
 * Les adresses de l'anneau que rien ne détient encore, au plus `limite`. L'anneau porte des milliers
 * d'adresses et le lot en prend quelques-unes : la boucle s'arrête au lot plein, là où un filtre de
 * l'anneau entier construisait un tableau complet pour n'en garder que la tête.
 */
export function anneauFroid(
  ring: readonly string[],
  streamer: Pick<ReturnType<typeof createPageStreamer>, 'has' | 'loading' | 'failed'>,
  limite: number,
) {
  const cold: string[] = [];
  for (let i = 0; i < ring.length && cold.length < limite; i++) {
    const url = ring[i];
    if (!streamer.has(url) && !streamer.loading(url) && !streamer.failed(url)) cold.push(url);
  }
  return cold;
}

/**
 * Les adresses qu'une requête déjà partie fera repartir ensuite. Mêmes adresses et même ordre
 * d'ajout qu'un tableau dédoublonné à la main : l'appartenance est celle de la structure, là où un
 * `includes` rebalayait toute la liste pour chaque adresse, image après image.
 */
export function empileEnAttente(attente: Set<string>, urls: readonly string[]) {
  for (const url of urls) attente.add(url);
}

export function createExplorerDraw(session: ExplorerSession, inputs: Inputs) {
  const { scope, emit, diagnose } = session;
  const { camera, geometryUrls, streamer, streaming, directGpu, baseline, state } = inputs;
  const ownedRenderer = inputs.renderer;
  // WebGL2 ne sait pas horodater une passe : le chronomètre entoure la soumission de l'image entière,
  // et n'est monté que si l'hôte a demandé le profil par étape.
  const gpuTimer =
    session.options.stageProfile === true && !directGpu && ownedRenderer
      ? createWebglFrameTimer(ownedRenderer.getContext() as WebGL2RenderingContext)
      : null;
  /**
   * La chaîne d'affichage du moteur rendu par Three, réglée sur la vue du moteur — la même règle que
   * le chemin du contrat. Une scène sans lampe déclarée compose par l'identité : du linéaire vers
   * sRGB et rien d'autre, l'albédo tel quel (P6). Dès qu'une lampe existe, l'exposition et ACES
   * reviennent, derniers maillons de la chaîne (P4). Le drapeau vient des lampes installées, jamais
   * d'un réglage d'hôte, et n'est écrit que lorsqu'il change : Three recompile ses programmes sinon.
   */
  // La dernière image complète, gardée pour qu'une image tenue la réaffiche au lieu de redessiner
  // la scène entière. Voir `createHeldFrame` : le canevas ne garde rien d'une image à l'autre.
  const heldFrame = createHeldFrame();
  const drawingSize = new THREE.Vector2();
  const setDisplayChain = (backend: RenderBackend) => {
    const tone = backend.sceneLit?.() === false ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    if (ownedRenderer.toneMapping !== tone) ownedRenderer.toneMapping = tone;
  };
  const drawBackend = (backend: RenderBackend, target: THREE.WebGLRenderTarget | null) => {
    const { measuring } = state;
    const steps = backend as HostCpuProfile;
    backend.render(camera);
    const renderEnd = performance.now();
    const missing = backend.pendingUrls?.() ?? [];
    if (missing.length > 0) {
      streaming.queueCached(backend, missing);
      const needFetch = missing.filter(
        (url) =>
          (geometryUrls.has(url) || !streamer.has(url)) &&
          !streamer.loading(url) &&
          !streamer.failed(url) &&
          !streaming.decodeFailures.has(url),
      );
      if (needFetch.length > 0) {
        if (!measuring && !streaming.promise) streaming.startFetch(needFetch);
        else if (!measuring && streaming.promise) {
          empileEnAttente(streaming.queuedFetch, needFetch);
          streaming.backgroundFetchController?.abort(
            new DOMException('Camera request superseded', 'AbortError'),
          );
        }
      }
    } else if (
      !measuring &&
      !streaming.promise &&
      !streaming.queuedFetch.size &&
      performance.now() - streaming.lastPrefetch > PREFETCH_INTERVAL_MS &&
      streamer.stats().loading === 0
    ) {
      // The network is idle and nothing visible is missing: pull the ring around the cut ahead of the
      // camera, at a priority any visible request outranks. A second selection pass costs as much as
      // the first, so it runs on a timer, never on every frame.
      streaming.lastPrefetch = performance.now();
      const ring = backend.prefetchUrls?.();
      if (ring && ring.length) {
        const cold = anneauFroid(ring, streamer, PREFETCH_BATCH);
        if (cold.length) streaming.startFetch(cold, PRIORITY_PREFETCH);
      }
    }
    const pendingEnd = performance.now();
    const visibleUrls = backend.pageUrls?.();
    if (visibleUrls) streamer.retain(visibleUrls);
    const retainEnd = performance.now();
    steps.cpuStep?.('pendingMs', pendingEnd - renderEnd);
    steps.cpuStep?.('retainMs', retainEnd - pendingEnd);
    if (directGpu) {
      // Le moteur dessine dans le canevas de la page : rien à composer, mais l'image se clôt ici,
      // là où les bornes que l'hôte vient de relever appartiennent encore à elle.
      steps.cpuFrameEnd?.();
      if (backend.overBudget)
        throw new EngineError('PAGE_BUDGET', 'Visible pages exceed the resident budget');
      return;
    }
    ownedRenderer.setRenderTarget(target);
    if (backend.overBudget && backend !== baseline) {
      if (measuring)
        throw new EngineError(
          'PAGE_BUDGET',
          'Visible pages exceed the resident budget; no incomplete surface is rendered',
        );
      const fallbackReason = 'Visible pages exceed resident budget';
      state.fallbackReason = fallbackReason;
      state.active = baseline;
      baseline.render(camera);
      setDisplayChain(baseline);
      ownedRenderer.render(baseline.scene, camera);
      emit({
        eventVersion: 1,
        type: 'fallback',
        audience: 'diagnostic',
        recovered: true,
        code: 'PAGE_BUDGET',
        detail: fallbackReason,
      });
      diagnose('fallback', 'Visible pages exceed resident budget', {
        kind: 'fallback',
        reason: fallbackReason,
        from: backend.id,
        to: baseline.id,
        scope,
      });
      return;
    }
    setDisplayChain(backend);
    gpuTimer?.begin();
    // Une image tenue ne peut pas différer de la précédente : le moteur vient de le dire. Elle est
    // réaffichée d'une commande, et la scène n'est pas reparcourue. Sans image gardée à cette
    // taille — la première, ou un redimensionnement — l'image est dessinée puis gardée.
    ownedRenderer.getDrawingBufferSize(drawingSize);
    const tenue = backend.frameHeld === true && !target && heldFrame.holds(drawingSize);
    if (tenue) heldFrame.present(ownedRenderer);
    else {
      ownedRenderer.render(backend.scene, camera);
      if (!target) heldFrame.keep(ownedRenderer, drawingSize);
    }
    gpuTimer?.end();
    steps.cpuStep?.('submitMs', performance.now() - retainEnd);
    if (gpuTimer) {
      // Une requête relue quelques images plus tard : la lecture ne bloque jamais l'image en cours.
      const read = gpuTimer.poll();
      steps.gpuImageMs?.(read.ms, gpuTimer.supported, read.reason ?? gpuTimer.reason);
    }
    steps.cpuFrameEnd?.();
  };
  return drawBackend;
}
