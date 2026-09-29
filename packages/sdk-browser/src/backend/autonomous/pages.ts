import { colouredHostSurface, hostPageScene, releaseHostSurface } from '../../host/pageObjects.ts';
import { pageDiagnostics } from '../../host/pageDiagnostics.ts';
import { attachedPages, autonomousPlacements } from '../../placement/autonomousPlacements.ts';
import { collectClusterPages, indexPagesByUrl } from '../../page/selection/selection.ts';
import { createAutonomousRender, createAutonomousRenderState } from './render.ts';
import { autonomousCapabilities, publishAutonomousCapabilities } from './capabilities.ts';
import { createWebglFrameGate } from '../../webgl/core/frameGate.ts';
import { createAutonomousGeometry } from './geometry.ts';
import { createAutonomousInstances } from './instances.ts';
import { createClassPages } from './classPages.ts';
import { prepareAutonomousManifest, autonomousBootstrap, readPages } from './manifest.ts';
import { createAutonomousResidency } from './residency.ts';
import { createAutonomousPool } from './poolApi.ts';
import { createHeldFloor } from './heldFloor.ts';
import { createWebglViews } from './views.ts';
import { createContractLighting, graphBackground } from '../../lighting/contractLightingApi.ts';
import { createSceneDraw } from '../../webgl/cluster/sceneDraw.ts';
import type { BackendFactory } from '../types.ts';
import { createBlendCopy } from '../../cluster/blendCopyMesh.ts';
import type { HostMaterial } from '../../host/resources.ts';
import { loadHostVertices } from '../../scene/meshes.ts';

/** WebGL2 path backed only by independently decoded prepared geometry pages. */
export const autonomousPagesBackend: BackendFactory = (context) => {
  const { metadata, descriptors, sourced } = prepareAutonomousManifest(context.metadata);
  const { roots, allPages, worlds, blendCopies, reassignBlend, blendOf, wears } =
    collectClusterPages(context.source, metadata, new Map(), context.associations, {
      allowMissing: true,
      blendCopy: createBlendCopy,
    });
  const [baseRoots, basePages] = [roots.slice(), allPages.slice()];
  const bootstrap = autonomousBootstrap(roots),
    baseBootstrap = bootstrap.slice();
  const byUrl = indexPagesByUrl(allPages, (rec) => rec.url), // by page, not by stream bundle
    bootstrapUrls = new Set(bootstrap.map((page) => page.url));
  // The display graph's page ceiling: the host's, or the default raised to the root cover (#527).
  const hostCeiling = context.maxResidentPages ?? Infinity,
    pageDefault = context.residentPagesDefault ?? Math.max(1024, bootstrapUrls.size),
    cap = hostCeiling < Infinity ? hostCeiling : pageDefault,
    scene = hostPageScene(blendCopies);
  const baseMaterials = new Map(allPages.map((rec) => [rec, rec.declaration] as const)),
    colorMaterials = new Map<HostMaterial, HostMaterial>(),
    modifiedPages = new Set<string>();
  const state = createAutonomousRenderState(),
    gate = createWebglFrameGate(),
    views = createWebglViews(context.viewport, gate, () => residency.keptChanged()),
    hostDraw = createSceneDraw(context.webglContext, scene, blendCopies, context);
  // The engine's own lighting (`contractLightingApi.ts`): the cache's lights, else the graph's.
  const { lighting, api: lightingApi } = createContractLighting(scene, context, gate.sceneChanged);
  let ready = false;
  const geometryStore = createAutonomousGeometry({
    ...{ scene, allPages, bootstrap, views, byUrl, descriptors },
    ...{ baseMaterials, colorMaterials, modifiedPages },
  });
  const { sync, acceptGeometryPage } = geometryStore;
  const classes = createClassPages({ context, geometryStore, wears, gate });
  // The tables a placement enters: instances and instance-buffer rows append to the same.
  const tables = { roots, allPages, bootstrap, byUrl, baseMaterials, blendOf };
  const heldFloor = createHeldFloor({ bootstrap, modifiedPages, byUrl, hostCeiling });
  const ceiling =
    hostCeiling < Infinity ? () => hostCeiling : () => Math.max(pageDefault, heldFloor.meshes());
  const { disposeOwnedMaterials, instanceCount, ...instances } = createAutonomousInstances({
    ...tables,
    baseRoots,
    basePages,
    baseBootstrap,
    geometryStore,
    hostCeiling,
    overCeiling: heldFloor.overCeiling,
    sceneChanged: gate.sceneChanged,
    coverChanged: heldFloor.placed,
  });
  const residency = createAutonomousResidency({
    bootstrapUrls,
    modifiedPages,
    views: views.all,
    geometryStore,
  });
  const pool = createAutonomousPool({
    ...tables,
    context,
    descriptors,
    bootstrapUrls,
    modifiedPages,
    cap,
    gate,
    geometryStore,
    residency,
    heldFloor,
    instanceCount,
    others: views.others,
  });
  const frame = createAutonomousRender({
    state,
    context,
    gate,
    lighting,
    roots,
    blendCopies,
    worlds,
    view: views.live,
    revision: () => heldFloor.placements,
    ceiling,
    geometry: geometryStore,
    residency,
    pool: pool.budget,
  });
  return {
    id: 'autonomous-pages-webgl',
    scene,
    hostTableBytes: frame.hostBytes,
    hostDiagnostics: pageDiagnostics,
    captureAside: views.captureAside,
    capabilities: autonomousCapabilities(!!context.metadata.simplification),
    get overBudget() {
      return state.overBudget;
    },
    get frameHeld() {
      return state.frameHeld;
    },
    async prepare() {
      if (!context.readGeometryPage) throw new Error('AUTONOMOUS_PAGE_READER_MISSING');
      if (heldFloor.overCeiling()) throw new Error('AUTONOMOUS_ROOT_BUDGET');
      const urls = [...bootstrapUrls];
      // A copy drawn whole reads its host vertices, which no session fetches up front.
      const read = readPages(context, urls, sourced);
      const [pages] = await Promise.all([read, loadHostVertices(blendCopies)]);
      pages.forEach((data, i) => acceptGeometryPage(urls[i], data));
      heldFloor.changed();
      ready = true;
      for (const page of bootstrap) views.live.shown.push(page); // a spread overflows the stack
      sync();
      residency.keptChanged();
      publishAutonomousCapabilities(context.onDiagnostic);
    },
    render(camera) {
      hostDraw.render(camera);
      if (ready) frame(camera);
    },
    ...hostDraw.host,
    ...instances,
    ...autonomousPlacements({
      ...tables,
      context,
      descriptors,
      bootstrapUrls,
      blendCopies,
      scene,
      gate,
      geometryStore,
      coverChanged: heldFloor.placed,
    }),
    ...lightingApi,
    setClearColor: graphBackground(scene, gate.resourcesChanged),
    pendingUrls: residency.pendingUrls,
    retainedRanks: residency.retainedRanks,
    ...pool.api,
    materialClassRefusal: (alpha) =>
      instances.materialClassRefusal(alpha) ?? classes.refusal(alpha, allPages),
    flush: () => classes.settled().then(pool.api.flush),
    syncResident() {
      gate.resourcesChanged();
      sync();
    },
    // A dynamic geometry's pages read its lists, uploaded as the next frame binds them (#573).
    updateVertices: () => (gate.sceneMoved(), true),
    refreshMaterials(values = true, alpha) {
      // Values reach the twins, clones; a picture alone (#362), shared, only lets the image go.
      if (values) colorMaterials.forEach((twin, original) => colouredHostSurface(original, twin));
      if (alpha && reassignBlend(allPages, alpha)) heldFloor.changed();
      if (alpha) classes.follow(alpha, allPages);
      (values ? gate.sceneChanged : gate.resourcesChanged)();
    },
    metrics() {
      return {
        clusters: state.visible,
        ...state.triangles,
        ...pool.metrics,
        cacheEvictions: residency.cacheEvictions,
        frustumRejected: state.frustumRejected,
        lodLevel: state.lodLevel,
        submittedTriangles: geometryStore.state.submittedTriangles,
        totalSubmittedTriangles: hostDraw.counters()?.triangles ?? null,
        drawCalls: attachedPages(views.live.shown),
        coverageReady: ready,
        coverageBudgetLimited: state.overBudget || pool.budget.coverageBudgetLimited,
        frameHeld: state.frameHeld,
      };
    },
    dispose() {
      ready = false;
      hostDraw.dispose();
      geometryStore.dispose();
      disposeOwnedMaterials();
      for (const material of colorMaterials.values()) releaseHostSurface(material);
      scene.clear();
      gate.release();
    },
  };
};
