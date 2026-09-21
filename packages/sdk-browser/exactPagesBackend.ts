import { createExactPagesRender, createExactPagesRenderState } from './exactPagesRender.ts';
import { createWebglFrameGate } from './webglFrameGate.ts';
import { createExactPagesCpu } from './exactPagesCpu.ts';
import { createExactPagesMetrics } from './exactPagesMetrics.ts';
import { createExactPagesRequests, createExactPagesRequestData } from './exactPagesRequests.ts';
import { createExactPagesAttachment } from './exactPagesAttachment.ts';
import { createExactPagesResidency } from './exactPagesResidency.ts';
import { createExactPagesMaterials } from './exactPagesMaterials.ts';
import { DEFAULT_CLEAR_COLOR, baseCapabilities, lighting } from './backendCommon.ts';
import { sceneLightingApi } from './sceneLighting.ts';
import {
  attachContractLights,
  CONTRACT_LIGHTS_LIGHTING,
  CONTRACT_LIGHTS_UNSUPPORTED,
} from './exactPagesContractLights.ts';
import { collectClusterPages, type PageRec } from './pageSelection.ts';
import type { DiagnosticMode } from '../sdk-core/index.ts';
import { disposeTriangleGeometry } from './triangleDiagnostic.ts';
import type { BackendFactory } from './backendTypes.ts';
import * as THREE from 'three';
import type { CameraMotion } from './cameraWorld.ts';
import { createExactPagesClusterBatches } from './exactPagesClusterBatches.ts';

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
  const { roots, allPages, blendCopies, bootstrap, requestCount, prepared, worlds } =
    collectClusterPages(source, metadata, indices, associations);
  const cap = maxResidentPages ?? context.residentPagesDefault ?? Math.max(1024, prepared),
    scene = new THREE.Scene();
  const sceneLights = lighting(scene, clearColor, context.sceneLighting ?? source);
  const shown: PageRec[] = [],
    desired: PageRec[] = [],
    attached: PageRec[] = [];
  const requestData = createExactPagesRequestData(allPages, requestCount);
  // One resident index buffer per primitive: the visible cut is now only a list of ranges.
  const { batches, refusal, ownedCopies, hostDraw } = createExactPagesClusterBatches(
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
  // Contract lights, translated into Three lights. As long as the host has neither declared a
  // light nor asked for a view, the source graph lights alone and the image is the previous one, pixel for pixel.
  const contract = attachContractLights(scene, context.sceneLights, sceneLights, gate.sceneChanged);
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
    ownedCopies,
    hostDraw,
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
    ...sceneLightingApi(sceneLights, gate.sceneChanged),
    /** The image comes out in real light as soon as either light set carries one. */
    sceneLit: () => contract.lit,
    refreshSceneLights: contract.apply,
    lighting: CONTRACT_LIGHTS_LIGHTING,
    render(camera) {
      hostDraw.render(camera);
      renderFrame(camera);
    },
    selectedPageIds() {
      return (shown.length ? shown : desired).map((rec) => rec.clusterId);
    },
    drawHostGeometry: hostDraw.drawHostGeometry,
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
