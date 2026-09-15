import type * as THREE from 'three';
import type { createGpuPageCache } from './gpuPages.ts';
import type { createGpuPresenter, createSynchronousCanvasCapture } from './gpuPresentation.ts';
import type { createDeferredLighting } from './deferredLighting.ts';
import type { SurfaceBuffer } from './surfaceBuffer.ts';
import { UNIFORM_STRIDE } from './webgpuBlendUniforms.ts';

/** GPU resources of the forward path: page cache, pipelines, frame targets and presentation. */
export interface WebgpuGpuState {
  cache: ReturnType<typeof createGpuPageCache> | undefined;
  bindGroupLayout: GPUBindGroupLayout | undefined;
  pipelineBack: GPURenderPipeline | undefined;
  pipelineBackCw: GPURenderPipeline | undefined;
  pipelineNone: GPURenderPipeline | undefined;
  pipelineBlend: GPURenderPipeline | undefined;
  colorTexture: GPUTexture | undefined;
  depthTexture: GPUTexture | undefined;
  colorView: GPUTextureView | undefined;
  depthView: GPUTextureView | undefined;
  hdrTexture: GPUTexture | undefined;
  hdrView: GPUTextureView | undefined;
  surfaces: SurfaceBuffer | undefined;
  targetSize: [number, number];
  positionBuffers: Map<THREE.BufferGeometry['attributes'], GPUBuffer>;
  /** Octets de sommets tenus au fil des allocations : tampons de positions, puis index, UV et
   *  normales des maillages transparents. Le relevé les lit au lieu de les resommer par image. */
  vertexBytes: number;
  positionIds: WeakMap<GPUBuffer, number>;
  nextPositionId: number;
  uniformBuffer: GPUBuffer | undefined;
  uniformPacked: Float32Array<ArrayBuffer>;
  bindGroups: Map<number, GPUBindGroup>;
  clusterRgbCache: Map<string, [number, number, number]>;
  zeroUv: GPUBuffer | undefined;
  synchronousCapture: ReturnType<typeof createSynchronousCanvasCapture> | undefined;
  presenter: ReturnType<typeof createGpuPresenter> | undefined;
  canvasTexture: THREE.CanvasTexture | undefined;
  blitMaterial: THREE.ShaderMaterial | undefined;
  blit: THREE.Mesh | undefined;
  deferred: Awaited<ReturnType<typeof createDeferredLighting>> | undefined;
}

export function createWebgpuGpuState(viewport: readonly [number, number]): WebgpuGpuState {
  return {
    cache: undefined,
    bindGroupLayout: undefined,
    pipelineBack: undefined,
    pipelineBackCw: undefined,
    pipelineNone: undefined,
    pipelineBlend: undefined,
    colorTexture: undefined,
    depthTexture: undefined,
    colorView: undefined,
    depthView: undefined,
    hdrTexture: undefined,
    hdrView: undefined,
    surfaces: undefined,
    targetSize: [viewport[0] ?? 1, viewport[1] ?? 1],
    positionBuffers: new Map(),
    vertexBytes: 0,
    positionIds: new WeakMap(),
    nextPositionId: 1,
    uniformBuffer: undefined,
    uniformPacked: new Float32Array(UNIFORM_STRIDE / 4),
    bindGroups: new Map(),
    clusterRgbCache: new Map(),
    zeroUv: undefined,
    synchronousCapture: undefined,
    presenter: undefined,
    canvasTexture: undefined,
    blitMaterial: undefined,
    blit: undefined,
    deferred: undefined,
  };
}
