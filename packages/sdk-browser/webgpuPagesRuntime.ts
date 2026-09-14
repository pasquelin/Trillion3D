import type { BackendCapabilities, BackendContext, RenderBackend } from './backendTypes.ts';
import { createWebgpuDiagnostics } from './webgpuPagesDiagnostics.ts';
import { createWebgpuBlendState } from './webgpuBlendState.ts';
import { createWebgpuTexturePump } from './webgpuTexturePump.ts';
import { createWebgpuPagesSetup, type WebgpuDiagnostics } from './webgpuPagesSetup.ts';
import { createWebgpuPagesLayout, type WebgpuPagesLayout } from './webgpuPagesLayout.ts';
import { createWebgpuGpuState, type WebgpuGpuState } from './webgpuPagesStateGpu.ts';
import { createWebgpuVisState, type WebgpuVisState } from './webgpuPagesStateVis.ts';
import {
  createWebgpuCaptureState,
  createWebgpuRunState,
  type WebgpuCaptureState,
  type WebgpuRunState,
} from './webgpuPagesStateRun.ts';
import { createWebgpuTimingState, type WebgpuTimingState } from './webgpuPagesStateTiming.ts';
import type { WebgpuPagesSetup } from './webgpuPagesSetup.ts';
import type { WebgpuPagesServices } from './webgpuPagesServices.ts';

export type WebgpuPagesBackend = RenderBackend & {
  flush(): Promise<void>;
  rasterRgba(): Uint8Array;
  selectedPageIds(): string[];
  visibilityIds(): Uint32Array;
};

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
  run: WebgpuRunState;
  capture: WebgpuCaptureState;
  timing: WebgpuTimingState;
  capabilities: BackendCapabilities;
  blendState: ReturnType<typeof createWebgpuBlendState>;
  texturePump: ReturnType<typeof createWebgpuTexturePump>;
  /** Residency machinery, built once the state exists; it reads the runtime lazily. */
  services: WebgpuPagesServices;
  /** The backend object itself, assigned once it exists: services re-enter it for fallbacks. */
  backend: WebgpuPagesBackend;
}

export function createWebgpuPagesRuntime(context: BackendContext): WebgpuPagesRuntime {
  const diagnosticDetail = (context as typeof context & { diagnosticDetail?: 'summary' | 'trace' })
    .diagnosticDetail;
  const traceEnabled = !!context.onDiagnostic && diagnosticDetail !== 'summary';
  const diag = { ...createWebgpuDiagnostics(context.onDiagnostic, traceEnabled), traceEnabled };
  const setup = createWebgpuPagesSetup(context, diag);
  const layout = createWebgpuPagesLayout(setup);
  const vis = createWebgpuVisState();
  const texturePump = createWebgpuTexturePump({
    device: setup.gpuDevice,
    jobs: vis.textureJobs,
    budget: setup.textureBudget,
    colorScales: vis.uvScales,
    dataScales: vis.dataUvScales,
    colorAtlas: () => ({ texture: vis.mapsTexture, size: vis.textureColorSize }),
    dataAtlas: () => ({ texture: vis.dataMapsTexture, size: vis.textureDataSize }),
    onFailure: diag.diagnosticFailure,
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
      'environment maps, light shadows, area lights and light probes',
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
  return {
    context,
    diag,
    setup,
    layout,
    gpu: createWebgpuGpuState(setup.viewport),
    vis,
    run: createWebgpuRunState(),
    capture: createWebgpuCaptureState(),
    timing: createWebgpuTimingState(),
    capabilities,
    blendState: createWebgpuBlendState(),
    texturePump,
    services: undefined as unknown as WebgpuPagesServices,
    backend: undefined as unknown as WebgpuPagesBackend,
  };
}
