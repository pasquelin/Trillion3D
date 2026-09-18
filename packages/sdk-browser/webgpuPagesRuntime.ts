import { BOUNCE_SETTINGS } from '../sdk-core/index.ts';
import { MOTION_CAPABILITY, TAA_CAPABILITY } from './taaPrepare.ts';
import type { BackendCapabilities, BackendContext, RenderBackend } from './backendTypes.ts';
import { createWebgpuPagesServices, type WebgpuPagesServices } from './webgpuPagesServices.ts';
import { createWebgpuDiagnostics } from './webgpuPagesDiagnostics.ts';
import { createWebgpuBlendState } from './webgpuBlendState.ts';
import { createWebgpuTexturePump } from './webgpuTexturePump.ts';
import { createTexturePriority } from './webgpuTexturePriority.ts';
import { createTextureBudget } from './textureBudget.ts';
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
  /** L'ordre dicté par l'écran et le registre d'octets engagés qu'il alimente. */
  texturePriority: ReturnType<typeof createTexturePriority>;
  textureLedger: ReturnType<typeof createTextureBudget>;
  /** Residency machinery, built once the state exists; it reads the runtime lazily. */
  services: WebgpuPagesServices;
}

/** Une boîte qui contient tout le monde : le signal « tout a changé » de l'ordonnanceur d'ombres. */
const EVERYWHERE_MIN = [-1e30, -1e30, -1e30],
  EVERYWHERE_MAX = [1e30, 1e30, 1e30];

/**
 * Un niveau de couleur de plus est résident : la découpe alpha que les cartes d'ombre lisent vient
 * de changer pour toute surface qui porte cette texture, et une carte dessinée au niveau d'avant
 * décrirait un feuillage qui n'est plus celui de l'image. Toutes les pages repartent donc en
 * attente, sous le budget ordinaire de l'étape Ombres. Sans ce signal, deux exécutions identiques
 * rendaient deux ombres différentes, selon le moment où chaque page avait été dessinée.
 */
function shadowsFollowTextures(lights: WebgpuLightState) {
  lights.plan.worldChanged(EVERYWHERE_MIN, EVERYWHERE_MAX);
}

export function createWebgpuPagesRuntime(context: BackendContext): WebgpuPagesRuntime {
  const traceEnabled = !!context.onDiagnostic && context.diagnosticDetail !== 'summary';
  const diag = { ...createWebgpuDiagnostics(context.onDiagnostic, traceEnabled), traceEnabled };
  const setup = createWebgpuPagesSetup(context, diag);
  const layout = createWebgpuPagesLayout(setup);
  const vis = createWebgpuVisState();
  const run = createWebgpuRunState();
  const blendState = createWebgpuBlendState();
  const lights = createWebgpuLightState(context.sceneLights);
  // Le signal de priorité est celui de la coupe précédente : elle a déjà nommé les pages demandées
  // au cache et les maillages transparents visibles, donc les lire ne coûte ni passe GPU ni lecture
  // bloquante. `run.desired` et non `run.drawn` : voir `webgpuTexturePriority.ts`.
  const priority = createTexturePriority(() => ({
    index: vis.materialLayers,
    requested: run.desired,
    blend: blendState.visibleBlend,
    cam: run.gate.cam,
    viewport: setup.viewport,
    colorTexels: vis.colorAtlas?.texels,
    dataTexels: vis.dataAtlas?.texels,
    // Les grappes distinctes du catalogue : les lignes tenues d'une image à l'autre sont rangées par
    // clé de grappe, un placement de plus n'en ajoutant aucune.
    keyCount: setup.tracking.keyCount,
  }));
  const textureLedger = createTextureBudget({
    budget: setup.textureResidencyBudget,
    // Les deux atlas sont alloués en entier à la préparation : ce qu'ils portent est déjà engagé sur
    // la carte, transfert ou pas. Le registre le sait, sans quoi il refuserait pour rien.
    allocated: () => (vis.colorAtlas?.bytes ?? 0) + (vis.dataAtlas?.bytes ?? 0),
    scoreOf: priority.scoreOf,
  });
  const texturePump = createWebgpuTexturePump({
    device: setup.gpuDevice,
    jobs: vis.textureJobs,
    budget: setup.textureBudget,
    ledger: textureLedger,
    colorAtlas: () => vis.colorAtlas,
    dataAtlas: () => vis.dataAtlas,
    order: priority.order,
    onResident: priority.markLevel,
    screenKnown: () => priority.screenKnown,
    onLevel: (kind, slot, level, pyramid) => {
      if (pyramid) vis.slots?.markLevel(kind, slot, level, pyramid);
      // Origine du changement de ressources : un niveau progressif vient d'atteindre l'atlas.
      run.gate.resourcesChanged();
      if (kind === 'color') shadowsFollowTextures(lights);
    },
    onReady: (kind, slots) => {
      vis.slots?.markReady(kind, slots);
      run.gate.resourcesChanged();
      if (kind === 'color') shadowsFollowTextures(lights);
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
      'global illumination and surface cache',
      MOTION_CAPABILITY,
      TAA_CAPABILITY,
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
    lights,
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
    texturePriority: priority,
    textureLedger,
  };
  return { ...core, services: createWebgpuPagesServices(core) };
}
