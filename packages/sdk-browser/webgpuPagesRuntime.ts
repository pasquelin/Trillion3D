import { BOUNCE_SETTINGS } from '../sdk-core/index.ts';
import type { BackendCapabilities, BackendContext, RenderBackend } from './backendTypes.ts';
import { createWebgpuPagesServices, type WebgpuPagesServices } from './webgpuPagesServices.ts';
import { createWebgpuDiagnostics } from './webgpuPagesDiagnostics.ts';
import { createWebgpuBlendState } from './webgpuBlendState.ts';
import { createWebgpuTexturePump } from './webgpuTexturePump.ts';
import { bumpResources } from './frameRevisions.ts';
import { createTexturePriority } from './webgpuTexturePriority.ts';
import { createWebgpuPagesSetup, type WebgpuDiagnostics } from './webgpuPagesSetup.ts';
import { createWebgpuPagesLayout, type WebgpuPagesLayout } from './webgpuPagesLayout.ts';
import { createWebgpuGpuState, type WebgpuGpuState } from './webgpuPagesStateGpu.ts';
import { createWebgpuVisState, type WebgpuVisState } from './webgpuPagesStateVis.ts';
import { createWebgpuLightState, type WebgpuLightState } from './webgpuPagesStateLights.ts';
import { createWebgpuBounceState, type WebgpuBounceState } from './webgpuPagesStateBounce.ts';
import { createWebgpuSunFarState, type WebgpuSunFarState } from './webgpuPagesStateSunFar.ts';
import { createWebgpuRunState, type WebgpuRunState } from './webgpuPagesStateRun.ts';
import { createWebgpuCaptureState, type WebgpuCaptureState } from './webgpuPagesStateCapture.ts';
import {
  createWebgpuStageProfiler,
  createWebgpuTimingState,
  type WebgpuTimingState,
} from './webgpuPagesStateTiming.ts';
import type { HostCpuProfile } from './hostCpuProfile.ts';
import type { WebgpuPagesSetup } from './webgpuPagesSetup.ts';

export type WebgpuPagesBackend = RenderBackend &
  HostCpuProfile & {
    flush(): Promise<void>;
    rasterRgba(): Uint8Array;
    selectedPageIds(): string[];
    visibilityIds(): Uint32Array;
  };

/** The runtime before its services exist: what the service factory and the draw helpers are handed. */
export type WebgpuPagesCore = Omit<WebgpuPagesRuntime, 'services'>;

export const UNTEXTURED_MATERIALS = 'Untextured source color; double-sided when the material is';
export const VIS_FEATURES = [
  'visibility buffer',
  'textured PBR maps',
  'occlusion culling',
  'temporal occlusion culling',
];

/** The shared state of one WebGPU page-raster backend, handed to every module that implements a
 *  part of it. `setup` and `layout` never change after construction; the other groups do. */
export interface WebgpuPagesRuntime {
  context: BackendContext;
  diag: WebgpuDiagnostics;
  setup: WebgpuPagesSetup;
  layout: WebgpuPagesLayout;
  gpu: WebgpuGpuState;
  vis: WebgpuVisState;
  /** Les lampes du contrat, leurs listes par tuile et leur atlas d'ombres. */
  lights: WebgpuLightState;
  /** Le proxy résident et la grille de sondes de la lumière qui rebondit. */
  bounce: WebgpuBounceState;
  /** L'ombre du soleil au-delà de la dernière cascade, tirée contre le proxy résident. */
  sunFar: WebgpuSunFarState;
  run: WebgpuRunState;
  capture: WebgpuCaptureState;
  timing: WebgpuTimingState;
  capabilities: BackendCapabilities;
  blendState: ReturnType<typeof createWebgpuBlendState>;
  texturePump: ReturnType<typeof createWebgpuTexturePump>;
  /** Residency machinery, built once the state exists; it reads the runtime lazily. */
  services: WebgpuPagesServices;
}

export function createWebgpuPagesRuntime(context: BackendContext): WebgpuPagesRuntime {
  const traceEnabled = !!context.onDiagnostic && context.diagnosticDetail !== 'summary';
  const diag = { ...createWebgpuDiagnostics(context.onDiagnostic, traceEnabled), traceEnabled };
  const setup = createWebgpuPagesSetup(context, diag);
  const layout = createWebgpuPagesLayout(setup);
  const vis = createWebgpuVisState();
  const run = createWebgpuRunState();
  const blendState = createWebgpuBlendState();
  // Le signal de priorité est celui de la coupe précédente : elle a déjà nommé les pages demandées
  // au cache et les maillages transparents visibles, donc les lire ne coûte ni passe GPU ni lecture
  // bloquante. `run.desired` et non `run.drawn` : voir `webgpuTexturePriority.ts`.
  const priority = createTexturePriority(() => ({
    index: vis.materialLayers,
    requested: run.desired,
    blend: blendState.visibleBlend,
  }));
  const texturePump = createWebgpuTexturePump({
    device: setup.gpuDevice,
    jobs: vis.textureJobs,
    budget: setup.textureBudget,
    colorAtlas: () => vis.colorAtlas,
    dataAtlas: () => vis.dataAtlas,
    order: priority.order,
    onLevel: (slot, level, pyramid) => {
      if (pyramid) vis.slots?.markLevel(slot, level, pyramid);
      // Origine du changement de ressources : un niveau progressif vient d'atteindre l'atlas.
      bumpResources(run.revisions);
    },
    onColorReady: (slots) => {
      vis.slots?.markReady(slots);
      bumpResources(run.revisions);
    },
    onFailure: diag.diagnosticFailure,
    onAbandon: (details) =>
      diag.engineDiagnostic(
        'progressive-texture-abandoned',
        'Texture sortie de la file après refus répétés du transfert',
        details,
      ),
  });
  const capabilities: BackendCapabilities = {
    renderer: 'WebGPU page raster',
    materials: UNTEXTURED_MATERIALS,
    hierarchy: true,
    gpuDriven: false,
    simplification: false,
    eviction: true,
    unsupported: [
      'material extensions, skinning and morph targets in WebGPU',
      'per-texture transforms, UV channels and sampler modes',
      'environment maps, area lights and light probes',
      'contract scene lights with shadow atlas',
      'indirect draw',
      'occlusion culling',
      'temporal occlusion culling',
      'small-triangle compute raster',
      'physical VRAM instrumentation',
      'global illumination, surface cache and motion vectors',
      'sun shadows beyond the last cascade',
      'textured PBR maps',
      'visibility buffer',
      'direct WebGPU present',
    ],
  };
  const core: WebgpuPagesCore = {
    context,
    diag,
    setup,
    layout,
    gpu: createWebgpuGpuState(setup.viewport),
    vis,
    lights: createWebgpuLightState(context.sceneLights),
    bounce: createWebgpuBounceState(
      context.bounce === true,
      context.bounceBudgetMs ?? BOUNCE_SETTINGS.budgetMs,
    ),
    sunFar: createWebgpuSunFarState(),
    run,
    capture: createWebgpuCaptureState(),
    timing: createWebgpuTimingState(context.stageProfile ? createWebgpuStageProfiler() : undefined),
    capabilities,
    blendState,
    texturePump,
  };
  return { ...core, services: createWebgpuPagesServices(core) };
}
