import type { BackendCapabilities, BackendContext, RenderBackend } from './backendTypes.ts';
import { createWebgpuPagesServices, type WebgpuPagesServices } from './webgpuPagesServices.ts';
import { createWebgpuDiagnostics } from './webgpuPagesDiagnostics.ts';
import { createWebgpuBlendState } from './webgpuBlendState.ts';
import { createWebgpuTexturePump } from './webgpuTexturePump.ts';
import { createTexturePriority } from './webgpuTexturePriority.ts';
import { createWebgpuPagesSetup, type WebgpuDiagnostics } from './webgpuPagesSetup.ts';
import { createWebgpuPagesLayout, type WebgpuPagesLayout } from './webgpuPagesLayout.ts';
import { createWebgpuGpuState, type WebgpuGpuState } from './webgpuPagesStateGpu.ts';
import { createWebgpuVisState, type WebgpuVisState } from './webgpuPagesStateVis.ts';
import { createWebgpuLightState, type WebgpuLightState } from './webgpuPagesStateLights.ts';
import { createWebgpuBounceState, type WebgpuBounceState } from './webgpuPagesStateBounce.ts';
import {
  createWebgpuCaptureState,
  createWebgpuRunState,
  type WebgpuCaptureState,
  type WebgpuRunState,
} from './webgpuPagesStateRun.ts';
import {
  createWebgpuStageProfiler,
  createWebgpuTimingState,
  type WebgpuTimingState,
} from './webgpuPagesStateTiming.ts';
import type { WebgpuPagesSetup } from './webgpuPagesSetup.ts';

export type WebgpuPagesBackend = RenderBackend & {
  flush(): Promise<void>;
  rasterRgba(): Uint8Array;
  selectedPageIds(): string[];
  visibilityIds(): Uint32Array;
};

/** The runtime before its services exist: what the service factory and the draw helpers are handed. */
export type WebgpuPagesCore = Omit<WebgpuPagesRuntime, 'services'>;

export const UNTEXTURED_MATERIALS = 'Untextured source color; double-sided when the material is';
/** Named only when the scene carries such a surface: no pass reads the image behind one yet. */
export const TRANSMISSION_UNSUPPORTED =
  'transmissive materials (KHR_materials_transmission): the surface is not drawn';
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
  // Le signal de priorité est celui de la coupe précédente : elle a déjà nommé les pages dessinées
  // et les maillages transparents visibles, donc les lire ne coûte ni passe GPU ni lecture bloquante.
  const priority = createTexturePriority(() => ({
    index: vis.materialLayers,
    drawn: run.drawn,
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
    },
    onColorReady: (slots) => vis.slots?.markReady(slots),
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
    bounce: createWebgpuBounceState(context.bounce !== false),
    run,
    capture: createWebgpuCaptureState(),
    timing: createWebgpuTimingState(context.stageProfile ? createWebgpuStageProfiler() : undefined),
    capabilities,
    blendState,
    texturePump,
  };
  return { ...core, services: createWebgpuPagesServices(core) };
}
