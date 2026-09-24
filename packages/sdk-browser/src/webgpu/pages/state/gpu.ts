import type { HostAttribute, HostAttributes } from '../../../host/resources.ts';
import type { createGpuPageCache } from '../../../gpu/page/pages.ts';
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../../core/bindIdentity.ts';
import type {
  createGpuPresenter,
  createSynchronousCanvasCapture,
} from '../../../gpu/core/presentation.ts';
import type { createDeferredLighting } from '../../../lighting/deferred/deferred.ts';
import type { SurfaceBuffer } from '../../../scene/surfaceBuffer.ts';
import type { TemporalAntialiasing } from '../../../taa/temporalAntialiasing.ts';
import { UNIFORM_STRIDE } from '../../blend/uniforms.ts';

/** GPU resources of the forward path: page cache, pipelines, frame targets and presentation. */
export interface WebgpuGpuState {
  /** The session's handle on the device (`gpu/core/deviceOwners.ts`), from `prepare`: everything
   *  the session creates goes through it, so that the labels name the session. */
  device: GPUDevice | undefined;
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
  /** What transparents ask of virtual textures, one tile rank per pixel: a target, never a fragment-
   *  stage write, which would cost early-z reject. */
  feedbackTexture: GPUTexture | undefined;
  feedbackView: GPUTextureView | undefined;
  /** Frozen backdrop the water pass rereads: a copy of the HDR target taken after opaques and
   *  blends, and the depth its surfaces write. A 1×1 texel while the scene carries no transmissive
   *  surface — the binding then exists without costing anything. */
  backdrop: TransmissionBackdrop | undefined;
  surfaces: SurfaceBuffer | undefined;
  /** The last adopted sample declared a wanted page not yet arrived: the image waits for that page,
   *  it does not fall back to the CPU cut. */
  cutIncomplete: boolean;
  /** The last adopted sample exceeded the ceiling: the image cannot use it. */
  cutTruncated: boolean;
  /** GPU selection has been dropped for the session: what is measured since is the fallback CPU cut.
   *  Published in the metrics under `gpuSelectionFallback`. */
  selectionFallback: boolean;
  targetSize: [number, number];
  /** Bytes of the image targets of this size, those the image budget admitted. */
  targetBytes: number;
  positionBuffers: Map<HostAttributes, GPUBuffer>;
  /** Indices, UVs and normals of transparents, held by the source geometry: two instances of the same
   *  object share the same geometry, therefore the same buffers. `undefined` kept in the table says
   *  "this geometry does not have this attribute", and is distinct from a missing entry. */
  blendIndexBuffers: Map<HostAttribute, GPUBuffer>;
  blendUvBuffers: Map<HostAttributes, GPUBuffer | undefined>;
  blendNormalBuffers: Map<HostAttributes, GPUBuffer | undefined>;
  /** Vertex bytes held through allocations: position buffers, then indices, UVs and normals of
   *  transparent meshes. The sample reads them instead of resuming them per image. */
  vertexBytes: number;
  positionIds: WeakMap<GPUBuffer, number>;
  nextPositionId: number;
  uniformBuffer: GPUBuffer | undefined;
  uniformPacked: Float32Array<ArrayBuffer>;
  /** glTF volume of each transmissive item, read by water rank in the composite. */
  volumeBuffer: GPUBuffer | undefined;
  bindGroups: Map<number, GPUBindGroup>;
  /** What those groups currently name besides their position buffer: a moved identity voids them. */
  fallbackIdentity: WebgpuBindIdentity;
  clusterRgbCache: Map<string, [number, number, number]>;
  zeroUv: GPUBuffer | undefined;
  synchronousCapture: ReturnType<typeof createSynchronousCanvasCapture> | undefined;
  presenter: ReturnType<typeof createGpuPresenter> | undefined;
  deferred: Awaited<ReturnType<typeof createDeferredLighting>> | undefined;
  /** Temporal-antialiasing pass and its two history targets; absent when the host refuses it or the
   *  device does not host it. */
  temporal: TemporalAntialiasing | undefined;
  /** Whether the host wants the pass: set at preparation, then by `setTemporalAntialiasing`. */
  temporalWanted: boolean;
}

/** The frozen colour the water composite rereads, and the depth its surface stage tests and
 *  writes, with their views (`../../transparent/transmission.ts`). */
export interface TransmissionBackdrop {
  color: GPUTexture;
  colorView: GPUTextureView;
  waterDepth: GPUTexture;
  waterDepthView: GPUTextureView;
  /** True when the copies are at the target size and the copy is worth it. */
  active: boolean;
}

export function createWebgpuGpuState(viewport: readonly [number, number]): WebgpuGpuState {
  return {
    device: undefined,
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
    feedbackTexture: undefined,
    feedbackView: undefined,
    backdrop: undefined,
    surfaces: undefined,
    cutIncomplete: false,
    cutTruncated: false,
    selectionFallback: false,
    targetSize: [viewport[0] ?? 1, viewport[1] ?? 1],
    targetBytes: 0,
    positionBuffers: new Map(),
    blendIndexBuffers: new Map(),
    blendUvBuffers: new Map(),
    blendNormalBuffers: new Map(),
    vertexBytes: 0,
    positionIds: new WeakMap(),
    nextPositionId: 1,
    uniformBuffer: undefined,
    uniformPacked: new Float32Array(UNIFORM_STRIDE / 4),
    volumeBuffer: undefined,
    bindGroups: new Map(),
    fallbackIdentity: createWebgpuBindIdentity(),
    clusterRgbCache: new Map(),
    zeroUv: undefined,
    synchronousCapture: undefined,
    presenter: undefined,
    deferred: undefined,
    temporal: undefined,
    temporalWanted: true,
  };
}
