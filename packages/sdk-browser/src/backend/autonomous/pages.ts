import { colouredHostSurface, hostPageScene, releaseHostSurface } from '../../host/pageObjects.ts';
import { pageDiagnostics } from '../../host/pageDiagnostics.ts';
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
import { comptePagesResidentes, createAutonomousResidency } from './residency.ts';
import { createContractLighting } from '../../lighting/contractLightingApi.ts';
import { createSceneDraw } from '../../webgl/cluster/sceneDraw.ts';
import type { BackendFactory } from '../types.ts';
import { createBlendCopy } from '../../cluster/blendCopyMesh.ts';
import type { HostMaterial } from '../../host/resources.ts';
import type { DecodedGeometryPage } from '../../page/decode/geometryPage.ts';

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
    desired: PageRec[] = [],
    pending: string[] = [],
    retained: string[] = [];
  const baseMaterials = new Map(allPages.map((rec) => [rec, rec.declaration] as const)),
    colorMaterials = new Map<HostMaterial, HostMaterial>();
  const modifiedPages = new Set<string>();
  const state = createAutonomousRenderState(),
    gate = createWebglFrameGate(),
    hostDraw = createSceneDraw(context.webglContext, scene, blendCopies);
  // The engine's own lighting: the cache's radiometric light table where it declares one, the
  // source graph's lights otherwise (`../../lighting/contractLightingApi.ts`). A transmissive
  // surface is not paged: it is a copy the program draws whole (`hostPageScene`).
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
  const { sync, storeGeometryPage, acceptGeometryPage } = geometryStore;
  // The tables a placement enters: instances and instance-buffer rows append to the same.
  const tables = { roots, allPages, bootstrap, byUrl, baseMaterials };
  const { disposeOwnedMaterials, ...instances } = createAutonomousInstances({
    ...tables,
    baseRoots,
    basePages,
    baseBootstrap,
    geometryStore,
    cap,
    sceneChanged: gate.sceneChanged,
  });
  const residency = createAutonomousResidency({
    bootstrapUrls,
    modifiedPages,
    shown,
    desired,
    pending,
    retained,
    byUrl,
    geometryStore,
  });
  const renderFrame = createAutonomousRender({
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
  });
  return {
    id: 'autonomous-pages-webgl',
    scene,
    hostDiagnostics: pageDiagnostics,
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
      ready = true;
      shown.push(...bootstrap);
      sync();
    },
    render(camera) {
      hostDraw.render(camera);
      if (ready) renderFrame(camera);
    },
    drawHostGeometry: hostDraw.drawHostGeometry,
    ...instances,
    ...autonomousPlacements({
      ...tables,
      blendCopies,
      scene,
      gate,
      rowsWritten: geometryStore.rowsWritten,
    }),
    ...lightingApi,
    ...residency,
    dropPage(url: string) {
      gate.resourcesChanged();
      residency.dropPage(url);
    },
    acceptGeometryPage(url: string, data: DecodedGeometryPage) {
      gate.resourcesChanged();
      acceptGeometryPage(url, data);
    },
    replaceGeometryPage(url, data) {
      if (!byUrl.has(url)) throw new Error('AUTONOMOUS_PAGE_MISSING');
      gate.resourcesChanged();
      storeGeometryPage(url, data);
      modifiedPages.add(url);
    },
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
        residentPages: comptePagesResidentes(allPages),
        geometryAllocationBytes: geometryStore.state.allocationBytes,
        cacheEvictions: residency.cacheEvictions,
        frustumRejected: state.frustumRejected,
        lodLevel: state.lodLevel,
        submittedTriangles: geometryStore.state.submittedTriangles,
        totalSubmittedTriangles: hostDraw.counters()?.triangles ?? null,
        drawCalls: attachedPages(shown),
        coverageReady: ready,
        coverageBudgetLimited: state.overBudget,
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
