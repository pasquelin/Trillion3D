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
import { attachContractLights } from './exactPagesContractLights.ts';
import { collectClusterPages, type PageRec } from './pageSelection.ts';
import { ClusterBatches } from './clusterBatches.ts';
import type { DiagnosticMode } from '../sdk-core/index.ts';
import { disposeTriangleGeometry } from './triangleDiagnostic.ts';
import type { BackendFactory } from './backendTypes.ts';
import * as THREE from 'three';

/** Ce moteur applique les lampes du contrat ; seules leurs ombres lui manquent — Three n'en
 *  fournirait qu'au prix d'une carte par lampe, six faces pour une ponctuelle, hors budget d'image. */
const EXACT_PAGES_LIGHTING = {
  shadows: false,
  reason: "lampes du contrat sans ombre portée ; la vue 'bounce' y vaut la vue éclairée",
};
const RETIRES = ['bounded GPU eviction', 'contract scene lights with shadow atlas'];
const EXACT_PAGES_UNSUPPORTED = baseCapabilities.unsupported
  .filter((item) => !RETIRES.includes(item))
  .concat('contract scene light shadows');

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
  const renderState = createExactPagesRenderState();
  const gate = createWebglFrameGate();
  // Les lampes du contrat, traduites en lampes Three. Tant que l'hôte n'a ni déclaré de lampe ni
  // demandé de vue, le graphe source éclaire seul et l'image est celle d'avant, au pixel près.
  const contract = attachContractLights(scene, context.sceneLights, sceneLights, gate.sceneChanged);
  const motion: { last?: THREE.Vector3; lastMs?: number } = {};
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
    resourcesChanged: gate.resourcesChanged,
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
      unsupported: EXACT_PAGES_UNSUPPORTED,
    },
    scene,
    async prepare() {},
    get overBudget() {
      return renderState.overBudget;
    },
    get frameHeld() {
      return renderState.frameHeld;
    },
    ...sceneLightingApi(sceneLights, gate.sceneChanged),
    /** L'image sort en lumière réelle dès que l'un des deux jeux de lampes en porte une. */
    sceneLit: () => contract.lit,
    refreshSceneLights: contract.apply,
    lighting: EXACT_PAGES_LIGHTING,
    render: renderFrame,
    ...cpuMethods,
    ...requestMethods,
    syncResident() {
      gate.resourcesChanged();
      syncResident();
    },
    ...metricMethods,
  };
};
