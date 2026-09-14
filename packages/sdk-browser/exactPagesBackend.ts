import { createExactPagesRender } from './exactPagesRender.ts';
import { createExactPagesCpu } from './exactPagesCpu.ts';
import { createExactPagesMetrics } from './exactPagesMetrics.ts';
import { createExactPagesRequests, createExactPagesRequestData } from './exactPagesRequests.ts';
import { createExactPagesAttachment } from './exactPagesAttachment.ts';
import { createExactPagesResidency } from './exactPagesResidency.ts';
import { createExactPagesMaterials } from './exactPagesMaterials.ts';
import { DEFAULT_CLEAR_COLOR, baseCapabilities, lighting } from './backendCommon.ts';
import { collectClusterPages, type PageRec } from './pageSelection.ts';
import { ClusterBatches } from './clusterBatches.ts';
import type { DiagnosticMode } from '../sdk-core/index.ts';
import { disposeTriangleGeometry } from './triangleDiagnostic.ts';
import type { BackendFactory } from './backendTypes.ts';
import * as THREE from 'three';

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
  const { roots, allPages, blendCopies, bootstrap, requestCount, prepared } = collectClusterPages(
    source,
    metadata,
    indices,
    associations,
  );
  const cap = maxResidentPages ?? Math.max(1024, prepared),
    scene = new THREE.Scene();
  const sceneLights = lighting(scene, clearColor, context.sceneLighting ?? source);
  const shown: PageRec[] = [],
    desired: PageRec[] = [],
    attached: PageRec[] = [];
  const requestData = createExactPagesRequestData(allPages, requestCount);
  // Un tampon d'index résident par primitive : la coupe visible n'est plus qu'une liste de plages.
  const batches = new ClusterBatches(scene, allPages);
  for (const copy of blendCopies) {
    copy.userData.sourceGeometry = copy.geometry;
    copy.userData.sourceMaterial = copy.material;
    scene.add(copy);
  }
  const indexByUrl = new Map<string, THREE.BufferAttribute>();
  for (const rec of allPages)
    if (rec.array && !indexByUrl.has(rec.url))
      indexByUrl.set(rec.url, new THREE.BufferAttribute(rec.array, 1));
  let diagnostic: DiagnosticMode = 'beauty';
  const renderState = {
    visible: 0,
    selectedTriangles: 0,
    frame: 0,
    overBudget: false,
    frustumRejected: 0,
    lodLevel: 0,
    lastCamera: undefined as THREE.PerspectiveCamera | undefined,
    lastPixelError: 0,
    cpuSelectMs: 0,
  };
  const motion: { last?: THREE.Vector3; lastMs?: number } = {};
  const { profile: cpuProfile, methods: cpuMethods } = createExactPagesCpu(
    context.onDiagnostic,
    () => renderState.frame,
  );
  const materials = createExactPagesMaterials({
    blendCopies,
    viewport,
    get diagnostic() {
      return diagnostic;
    },
    get lastCamera() {
      return renderState.lastCamera;
    },
    get lastPixelError() {
      return renderState.lastPixelError;
    },
  });
  const { materialFor, paint, paintBlend } = materials;
  const { release, attach } = createExactPagesAttachment(scene, indexByUrl, materialFor, paint);
  const metricsSeen = new Set<ArrayBufferView>();
  const disposeGeometry = (geometry: THREE.BufferGeometry) => {
    disposeTriangleGeometry(geometry);
    for (const name of Object.keys(geometry.attributes)) geometry.deleteAttribute(name);
    geometry.dispose();
  };
  const counters = { pagesDetached: 0, displayDetachments: 0 };
  const syncResident = createExactPagesResidency(
    shown,
    desired,
    attached,
    batches,
    release,
    attach,
    () => diagnostic,
    counters,
  );
  const requestMethods = createExactPagesRequests({
    ...requestData,
    bootstrap,
    desired,
    shown,
    viewport,
    roots,
    batches,
    indexByUrl,
    disposeGeometry,
    scene,
    get lastCamera() {
      return renderState.lastCamera;
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
    release,
    disposeGeometry,
    scene,
    get diagnostic() {
      return diagnostic;
    },
    get visible() {
      return renderState.visible;
    },
    get selectedTriangles() {
      return renderState.selectedTriangles;
    },
    get frustumRejected() {
      return renderState.frustumRejected;
    },
    get lodLevel() {
      return renderState.lodLevel;
    },
    get cpuSelectMs() {
      return renderState.cpuSelectMs;
    },
  });
  const renderFrame = createExactPagesRender(
    renderState,
    context,
    source,
    blendCopies,
    sceneLights,
    motion,
    roots,
    viewport,
    cap,
    desired,
    shown,
    syncResident,
    cpuProfile,
  );
  return {
    setDiagnostic(mode) {
      diagnostic = mode;
      paintBlend();
      syncResident();
    },
    id: 'exact-cluster-pages',
    capabilities: {
      ...baseCapabilities,
      hierarchy: true,
      eviction: true,
      unsupported: baseCapabilities.unsupported.filter((item) => item !== 'bounded GPU eviction'),
    },
    scene,
    async prepare() {},
    get overBudget() {
      return renderState.overBudget;
    },
    refreshSceneLighting: () => sceneLights.refresh(),
    render: renderFrame,
    ...cpuMethods,
    ...requestMethods,
    syncResident,
    ...metricMethods,
  };
};
