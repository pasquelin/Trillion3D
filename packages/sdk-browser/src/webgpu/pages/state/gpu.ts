import type { ScreenReflection } from '../../../reflections/gpu.ts';
import type { HostAttribute, HostAttributes } from '../../../host/resources.ts';
import type { createGpuPageCache } from '../../../gpu/page/pages.ts';
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../../core/bindIdentity.ts';
import type {
  createGpuPresenter,
  createSynchronousCanvasCapture,
} from '../../../gpu/core/presentation.ts';
import type { createDeferredLighting } from '../../../lighting/deferred/deferred.ts';
import type { SurfaceBuffer } from '../../../scene/surfaceBuffer.ts';
import type { AsIsShare } from '../../../lighting/deferred/asIsShare.ts';
import type { DisplayFilter } from '../../blend/displayFilter.ts';
import type { TemporalAntialiasing } from '../../../taa/temporalAntialiasing.ts';
import type { WebgpuEffects } from '../../effects/webgpuEffects.ts';
import { UNIFORM_STRIDE } from '../../blend/uniforms.ts';
import type { ModePipelines } from '../../blend/stagePipelines.ts';
import type { WebgpuGuidePass } from '../../../guides/guidePass.ts';
import type { WebgpuParticles } from '../../../particles/webgpuParticles.ts';
import type { DeviceGrant } from '../../../gpu/core/errorScope.ts';
import type { FrameSize } from './renderScale.ts';
import type { FloatAtlas } from '../../core/floatAtlas.ts';
import type { WebgpuImpostors } from '../../impostor/frame.ts';
import type * as ImpostorCode from '../../../impostor/impostorCode.ts';

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
  pipelineBlend: ModePipelines | undefined;
  colorTexture: GPUTexture | undefined;
  depthTexture: GPUTexture | undefined;
  colorView: GPUTextureView | undefined;
  depthView: GPUTextureView | undefined;
  hdrTexture: GPUTexture | undefined;
  hdrView: GPUTextureView | undefined;
  /** The display colour composition writes, guides draw over and presentation shows: the colour
   *  target itself at native size, a target of the display's size when the frame is drawn below
   *  it (`../prepare/targets.ts`). */
  displayTexture: GPUTexture | undefined;
  displayView: GPUTextureView | undefined;
  /** What transparents ask of virtual textures, one tile rank per pixel: a target, never a fragment-
   *  stage write, which would cost early-z reject. */
  feedbackTexture: GPUTexture | undefined;
  feedbackView: GPUTextureView | undefined;
  /** Frozen backdrop the water pass rereads: a copy of the HDR target taken after opaques and
   *  blends, and the depth its surfaces write. A 1×1 texel while the scene carries no transmissive
   *  surface — the binding then exists without costing anything. */
  backdrop: TransmissionBackdrop | undefined;
  reflection?: ScreenReflection;
  surfaces: SurfaceBuffer | undefined;
  asIsShare: AsIsShare | undefined;
  /** The display filter, made by the first image whose blends filter and kept while the plan
   *  holds such a blend (`../../blend/displayFilter.ts`). */
  displayFilter: DisplayFilter | undefined;
  /** The last adopted sample exceeded the ceiling: the image cannot use it. */
  cutTruncated: boolean;
  /** GPU selection has been dropped for the session: what is measured since is the fallback CPU cut.
   *  Published in the metrics under `gpuSelectionFallback`. */
  selectionFallback: boolean;
  /** The size every pass up to the temporal resolve draws at, this image: the display's, or below
   *  it, in the top-left of the render targets (`../state/renderScale.ts`, `drawFrameAt`). */
  targetSize: [number, number];
  /** The size the render targets are made at: the largest `targetSize` a scale change draws at
   *  without remaking them. */
  allocatedSize: [number, number];
  /** The size the resolve, the effect chain, composition, guides and presentation run at, and
   *  what decides detail reads: the host's viewport when the targets were made. */
  displaySize: [number, number];
  /** Bytes of the image targets of this size, those the image budget admitted. */
  targetBytes: number;
  /** The frame targets asked of the device (`targetGrant.ts`): in flight, or settled when refused
   *  at that size; gone once granted. */
  targetGrant: (FrameSize & DeviceGrant & { retryAt?: number }) | undefined;
  positionBuffers: Map<HostAttributes, GPUBuffer>;
  /** Indices, UVs and normals of transparents, held by the source geometry: two instances of the same
   *  object share the same geometry, therefore the same buffers. `undefined` kept in the table says
   *  "this geometry does not have this attribute", and is distinct from a missing entry. */
  blendIndexBuffers: Map<HostAttribute, GPUBuffer>;
  blendUvBuffers: Map<HostAttributes, GPUBuffer | undefined>;
  /** Each transparent geometry's normal atlas (`../../blend/buffers.ts`). */
  blendNormalBuffers: Map<HostAttributes, FloatAtlas | undefined>;
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
  /** The effect chain's targets and programs, made at the first frame with a pass. */
  effects: WebgpuEffects | undefined;
  /** Revision of the chain the last encoded image drew, -1 while its programs compile: another
   *  one breaks the hold. */
  effectsRevision: number;
  /** The guide pass, built by the first image that shows a guide (`guidePass.ts`). */
  guides: WebgpuGuidePass | undefined;
  /** Revision of the page's guides the last encoded image drew (`encodeGuides.ts`). */
  guideRevision: number;
  /** The particle step, made by the first image with a pool (`../../../particles/`). */
  particles: WebgpuParticles | undefined;
  /** The impostor cards and their atlases, made by the first image of a baked cache (#1335). */
  impostors: WebgpuImpostors | undefined;
  /** The impostor draw's code, awaited by the prepare of a baked cache (`../../../impostor/code.ts`). */
  impostorCode: typeof ImpostorCode | undefined;
}

/** The frozen colour the water composite rereads and the depth its surface stage tests and
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
    displayTexture: undefined,
    displayView: undefined,
    feedbackTexture: undefined,
    feedbackView: undefined,
    backdrop: undefined,
    surfaces: undefined,
    asIsShare: undefined,
    displayFilter: undefined,
    cutTruncated: false,
    selectionFallback: false,
    targetSize: [viewport[0] ?? 1, viewport[1] ?? 1],
    allocatedSize: [viewport[0] ?? 1, viewport[1] ?? 1],
    displaySize: [viewport[0] ?? 1, viewport[1] ?? 1],
    targetBytes: 0,
    targetGrant: undefined,
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
    effects: undefined,
    effectsRevision: 0,
    guides: undefined,
    guideRevision: 0,
    particles: undefined,
    impostors: undefined,
    impostorCode: undefined,
  };
}
