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
  /** Le fond figé que la passe de transmission relit : une copie de la cible HDR et de la
   *  profondeur, prises après les opaques et les mélanges. Un texel 1×1 tant que la scène ne porte
   *  aucune surface transmissive — la liaison existe alors sans rien coûter. */
  backdrop: TransmissionBackdrop | undefined;
  surfaces: SurfaceBuffer | undefined;
  /** Le dernier relevé adopté déclarait une page voulue non encore arrivée : l'image attend cette
   *  page, elle ne retombe pas sur la coupe processeur. */
  cutIncomplete: boolean;
  /** Le dernier relevé adopté dépassait le plafond : l'image ne peut pas s'en servir. */
  cutTruncated: boolean;
  /** La sélection GPU a été abandonnée pour la session : ce qui est mesuré depuis est la coupe
   *  processeur de secours. Publié dans les métriques sous `gpuSelectionFallback`. */
  selectionFallback: boolean;
  targetSize: [number, number];
  positionBuffers: Map<THREE.BufferGeometry['attributes'], GPUBuffer>;
  /** Indices, UV et normales des transparents, tenus par la géométrie source : deux instances d'un
   *  même objet partagent la même géométrie, donc les mêmes tampons. `undefined` retenu dans la
   *  table dit « cette géométrie n'a pas cet attribut », et se distingue d'une absence d'entrée. */
  blendIndexBuffers: Map<THREE.BufferAttribute | THREE.InterleavedBufferAttribute, GPUBuffer>;
  blendUvBuffers: Map<THREE.BufferGeometry['attributes'], GPUBuffer | undefined>;
  blendNormalBuffers: Map<THREE.BufferGeometry['attributes'], GPUBuffer | undefined>;
  /** Octets de sommets tenus au fil des allocations : tampons de positions, puis index, UV et
   *  normales des maillages transparents. Le relevé les lit au lieu de les resommer par image. */
  vertexBytes: number;
  positionIds: WeakMap<GPUBuffer, number>;
  nextPositionId: number;
  uniformBuffer: GPUBuffer | undefined;
  uniformPacked: Float32Array<ArrayBuffer>;
  /** Le volume glTF d'un item transparent par entrée, lu à décalage dynamique comme l'uniforme. */
  volumeBuffer: GPUBuffer | undefined;
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

/** Les deux copies que la passe de transmission lit, et leurs vues. */
export interface TransmissionBackdrop {
  color: GPUTexture;
  colorView: GPUTextureView;
  depth: GPUTexture;
  depthView: GPUTextureView;
  /** Vrai quand les copies sont à la taille de la cible et que la copie vaut la peine. */
  active: boolean;
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
    backdrop: undefined,
    surfaces: undefined,
    cutIncomplete: false,
    cutTruncated: false,
    selectionFallback: false,
    targetSize: [viewport[0] ?? 1, viewport[1] ?? 1],
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
