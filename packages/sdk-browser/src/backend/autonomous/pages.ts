import { colouredHostSurface, hostPageScene, releaseHostSurface } from '../../host/pageObjects.ts';
import { attachedPages, autonomousPlacements } from '../../placement/autonomousPlacements.ts';
import { collectClusterPages, indexPagesByUrl } from '../../page/selection/selection.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import { createAutonomousRender, createAutonomousRenderState } from './render.ts';
import { autonomousCapabilities } from './capabilities.ts';
import { createWebglFrameGate } from '../../webgl/core/frameGate.ts';
import { decodePageOffThread } from '../../page/decode/host.ts';
import { createAutonomousGeometry } from './geometry.ts';
import { createAutonomousInstances } from './instances.ts';
import { prepareAutonomousManifest, autonomousBootstrap } from './manifest.ts';
import { createAutonomousResidency } from './residency.ts';
import { createAutonomousPool } from './poolApi.ts';
import { createHeldFloor } from './heldFloor.ts';
import { createContractLighting } from '../../lighting/contractLightingApi.ts';
import { createThreeSceneDraw, hostDiagnostics } from '../../host/three/sceneAdapter.ts';
import { hostBackground } from '../../host/scene/objects.ts';
import type { BackendFactory } from '../types.ts';
import { createBlendCopy } from '../../cluster/blendCopyMesh.ts';
import type { HostMaterial } from '../../host/resources.ts';

/** WebGL2 path backed only by independently decoded prepared geometry pages. */
export const autonomousPagesBackend: BackendFactory = (context) => {
  const { metadata, descriptors } = prepareAutonomousManifest(context.metadata);
  const { roots, allPages, worlds, blendCopies } = collectClusterPages(
    context.source,
    metadata,
    new Map(),
    context.associations,
    { allowMissing: true, blendCopy: createBlendCopy },
  );
  const [baseRoots, basePages] = [roots.slice(), allPages.slice()];
  const bootstrap = autonomousBootstrap(roots),
    baseBootstrap = bootstrap.slice();
  const byUrl = indexPagesByUrl(allPages, (rec) => rec.url), // by page, not by stream bundle
    bootstrapUrls = new Set(bootstrap.map((page) => page.url));
  const cap =
      context.maxResidentPages ??
      context.residentPagesDefault ??
      Math.max(1024, bootstrapUrls.size),
    scene = hostPageScene(blendCopies);
  const shown: PageRec[] = [],
    desired: PageRec[] = [];
  const baseMaterials = new Map(allPages.map((rec) => [rec, rec.declaration] as const)),
    colorMaterials = new Map<HostMaterial, HostMaterial>();
  const modifiedPages = new Set<string>();
  const state = createAutonomousRenderState(),
    gate = createWebglFrameGate(),
    hostDraw = createThreeSceneDraw(context.webglContext, scene);
  // The engine's own lighting: the cache's radiometric light table where it declares one, the
  // source graph's lights otherwise (`../../lighting/contractLightingApi.ts`). A transmissive surface is not
  // paged: it is a host copy the host renderer draws whole (`hostPageScene`).
  const { lighting, api: lightingApi } = createContractLighting(scene, context, gate.sceneChanged);
  let ready = false;
  const geometryStore = createAutonomousGeometry({
    scene,
    allPages,
    bootstrap,
    shown,
    desired,
    byUrl,
    descriptors,
    baseMaterials,
    colorMaterials,
    modifiedPages,
  });
  const { sync, acceptGeometryPage } = geometryStore;
  // The tables a placement enters: instances and instance-buffer rows append to the same.
  const tables = { roots, allPages, bootstrap, byUrl, baseMaterials };
  const heldFloor = createHeldFloor({ bootstrap, modifiedPages, byUrl });
  const { disposeOwnedMaterials, instanceCount, ...instances } = createAutonomousInstances({
    ...tables,
    baseRoots,
    basePages,
    baseBootstrap,
    geometryStore,
    cap,
    sceneChanged: gate.sceneChanged,
    coverChanged: heldFloor.changed,
  });
  const residency = createAutonomousResidency({
    bootstrapUrls,
    modifiedPages,
    shown,
    desired,
    geometryStore,
  });
  const pool = createAutonomousPool({
    byUrl,
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
    settle: () => cut.settle(),
  });
  const cut = createAutonomousRender({
    state,
    context,
    gate,
    lighting,
    roots,
    worlds,
    shown,
    desired,
    bootstrap,
    cap,
    sync,
    keptChanged: residency.keptChanged,
    pool: pool.budget,
  });
  return {
    id: 'autonomous-pages-webgl',
    scene,
    hostDiagnostics,
    capabilities: autonomousCapabilities(!!context.metadata.simplification),
    get overBudget() {
      return state.overBudget;
    },
    get frameHeld() {
      return state.frameHeld;
    },
    async prepare() {
      if (!context.readGeometryPage) throw new Error('AUTONOMOUS_PAGE_READER_MISSING');
      if (attachedPages(bootstrap) > cap) throw new Error('AUTONOMOUS_ROOT_BUDGET');
      await Promise.all(
        [...bootstrapUrls].map(async (url) => {
          context.signal?.throwIfAborted();
          const bytes = await context.readGeometryPage!(url);
          context.signal?.throwIfAborted();
          acceptGeometryPage(url, await decodePageOffThread(bytes, context.signal));
        }),
      );
      heldFloor.changed();
      ready = true;
      shown.push(...bootstrap);
      sync();
      residency.keptChanged();
    },
    render(camera) {
      hostDraw.render(camera);
      if (ready) cut.frame(camera);
    },
    drawHostGeometry: hostDraw.drawHostGeometry,
    ...instances,
    ...autonomousPlacements({
      ...tables,
      blendCopies,
      scene,
      gate,
      rowsWritten: geometryStore.rowsWritten,
      coverChanged: heldFloor.changed,
    }),
    ...lightingApi,
    setClearColor: hostBackground(scene, gate.sceneMoved),
    pendingUrls: residency.pendingUrls,
    pageUrls: residency.pageUrls,
    ...pool.api,
    syncResident() {
      gate.resourcesChanged();
      sync();
    },
    refreshMaterials() {
      // The pages draw the repainted surfaces themselves; a vertex-coloured twin is a clone.
      for (const [original, twin] of colorMaterials) colouredHostSurface(original, twin);
      gate.sceneChanged();
    },
    metrics() {
      return {
        clusters: state.visible,
        selectedTriangles: state.selectedTriangles,
        ...pool.metrics,
        cacheEvictions: residency.cacheEvictions,
        frustumRejected: state.frustumRejected,
        lodLevel: state.lodLevel,
        submittedTriangles: geometryStore.state.submittedTriangles,
        totalSubmittedTriangles: hostDraw.counters()?.triangles ?? null,
        drawCalls: attachedPages(shown),
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
