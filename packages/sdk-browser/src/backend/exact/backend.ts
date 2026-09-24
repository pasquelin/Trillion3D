import { createExactPagesRender, createExactPagesRenderState } from './render.ts';
import { createWebglFrameGate } from '../../webgl/core/frameGate.ts';
import { createExactPagesCpu } from './cpu.ts';
import { createExactPagesMetrics } from './metrics.ts';
import { createExactPagesRequests, createExactPagesRequestData } from './requests.ts';
import { createExactPagesAttachment } from './attachment.ts';
import { createExactPagesResidency } from './residency.ts';
import { createExactPagesMaterials } from './materials.ts';
import { DEFAULT_CLEAR_COLOR, baseCapabilities } from '../common.ts';
import { hostBackground, lighting } from '../../host/scene/objects.ts';
import { CONTRACT_LIGHTS_UNSUPPORTED } from './contractLights.ts';
import { contractLightingApi } from '../../lighting/contractLightingApi.ts';
import { collectClusterPages, type PageRec } from '../../page/selection/selection.ts';
import { createBlendCopy } from '../../cluster/blendCopyMesh.ts';
import type { DiagnosticMode } from '../../../../sdk-core/src/index.ts';
import { disposeTriangleGeometry } from '../../diagnostic/triangleDiagnostic.ts';
import type { BackendFactory } from '../types.ts';
import * as THREE from 'three';
import { asHostLibrary } from '../../host/resources.ts';
import type { CameraMotion } from '../../camera/world.ts';
import { createExactPagesClusterBatches } from './clusterBatches.ts';

export const exactPagesBackend: BackendFactory = (context) => {
  const {
    source,
    metadata,
    indices,
    associations,
    maxResidentPages,
    viewport,
    clearColor = DEFAULT_CLEAR_COLOR,
  } = context;
  // The witness draws its transparent surfaces with the host renderer: its copies are host
  // meshes, not the engine records the collection builds by default.
  const collected = collectClusterPages(source, metadata, indices, associations, {
    blendCopy: createBlendCopy,
  });
  const { roots, allPages, bootstrap, requestCount, prepared, worlds } = collected;
  // The witness draws the transparent copies with the host library it is written in: this is where
  // the engine's contract copies go back to being its meshes.
  const blendCopies = asHostLibrary<THREE.Mesh[]>(collected.blendCopies);
  const cap = maxResidentPages ?? context.residentPagesDefault ?? Math.max(1024, prepared),
    scene = new THREE.Scene();
  const sceneLights = lighting(scene, clearColor, context.sceneLighting ?? source);
  const shown: PageRec[] = [],
    desired: PageRec[] = [],
    attached: PageRec[] = [];
  const requestData = createExactPagesRequestData(allPages, requestCount);
  // One resident index buffer per primitive: the visible cut is now only a list of ranges.
  const { batches, refusal, drawHostGeometry } = createExactPagesClusterBatches(
    scene,
    allPages,
    blendCopies,
    context,
  );
  const indexByUrl = new Map<string, THREE.BufferAttribute>();
  for (const rec of allPages)
    if (rec.array && !indexByUrl.has(rec.url))
      indexByUrl.set(rec.url, new THREE.BufferAttribute(rec.array, 1));
  let diagnostic: DiagnosticMode = 'beauty';
  const renderState = createExactPagesRenderState();
  const gate = createWebglFrameGate();
  // Contract lights, translated into Three lights, and the lighting half of the API they drive.
  // As long as the host has neither declared a light nor asked for a view, the source graph
  // lights alone and the image is the previous one, pixel for pixel.
  const contract = contractLightingApi(scene, context.sceneLights, sceneLights, gate.sceneChanged);
  const motion: CameraMotion = {};
  const { profile: cpuProfile, methods: cpuMethods } = createExactPagesCpu(
    context.onDiagnostic,
    () => renderState.frame,
    context.stageProfile === true,
    () => renderState.cpuSelectMs,
  );
  const materials = createExactPagesMaterials({
    blendCopies,
    viewport,
    get diagnostic() {
      return diagnostic;
    },
    get cam() {
      return renderState.cam;
    },
    get lastPixelError() {
      return renderState.lastPixelError;
    },
  });
  const { materialFor, paint, paintBlend } = materials;
  const attach = createExactPagesAttachment(indexByUrl, materialFor, paint);
  const metricsSeen = new Set<ArrayBufferView>();
  const disposeGeometry = (geometry: THREE.BufferGeometry) => {
    disposeTriangleGeometry(geometry);
    for (const name of Object.keys(geometry.attributes)) geometry.deleteAttribute(name);
    geometry.dispose();
  };
  const counters = { pagesDetached: 0 };
  const syncResident = createExactPagesResidency(
    shown,
    desired,
    attached,
    batches,
    attach,
    () => diagnostic,
    counters,
  );
  const requestMethods = createExactPagesRequests({
    ...requestData,
    resourcesChanged: gate.resourcesChanged,
    bootstrap,
    desired,
    shown,
    viewport,
    roots,
    batches,
    indexByUrl,
    disposeGeometry,
    get cam() {
      return renderState.cam;
    },
    get lastPixelError() {
      return renderState.lastPixelError;
    },
    get frame() {
      return renderState.frame;
    },
    urlStamp: 0,
  });
  const metricMethods = createExactPagesMetrics({
    batches,
    blendCopies,
    metricsSeen,
    attached,
    counters,
    materials,
    allPages,
    disposeGeometry,
    scene,
    gate,
    get diagnostic() {
      return diagnostic;
    },
    state: renderState,
  });
  const renderFrame = createExactPagesRender({
    state: renderState,
    context,
    source,
    blendCopies,
    sceneLights,
    motion,
    roots,
    worlds,
    viewport,
    cap,
    desired,
    shown,
    syncResident,
    cpuProfile,
    gate,
  });
  return {
    setDiagnostic(mode) {
      diagnostic = mode;
      gate.sceneChanged();
      paintBlend();
      syncResident();
    },
    id: 'exact-cluster-pages',
    capabilities: {
      ...baseCapabilities,
      hierarchy: true,
      eviction: true,
      unsupported: CONTRACT_LIGHTS_UNSUPPORTED,
    },
    scene,
    prepare: async () => {
      if (refusal) throw refusal;
    },
    get overBudget() {
      return renderState.overBudget;
    },
    get frameHeld() {
      return renderState.frameHeld;
    },
    ...contract,
    setClearColor: hostBackground(scene, gate.resourcesChanged),
    render(camera) {
      renderFrame(camera);
    },
    selectedPageIds: () => (shown.length ? shown : desired).map((rec) => rec.clusterId),
    drawHostGeometry,
    clusterDraws: () => batches.drawList,
    ...cpuMethods,
    ...requestMethods,
    syncResident() {
      gate.resourcesChanged();
      syncResident();
    },
    ...metricMethods,
  };
};
