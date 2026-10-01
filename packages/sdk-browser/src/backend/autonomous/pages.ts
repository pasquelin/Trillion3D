import { colouredHostSurface, hostPageScene, releaseHostSurface } from '../../host/pageObjects.ts';
import { pageDiagnostics } from '../../host/pageDiagnostics.ts';
import { autonomousPlacements } from '../../placement/autonomousPlacements.ts';
import { backendMetrics } from './metrics.ts';
import { collectClusterPages, indexPagesByUrl } from '../../page/selection/selection.ts';
import { createAutonomousRender, createAutonomousRenderState } from './render.ts';
import { autonomousCapabilities, publishAutonomousCapabilities } from './capabilities.ts';
import { createWebglFrameGate } from '../../webgl/core/frameGate.ts';
import { createAutonomousGeometry } from './geometry.ts';
import { createPageDraws } from './pageDraws.ts';
import { createAutonomousInstances } from './instances.ts';
import { createClassPages } from './classPages.ts';
import {
  prepareAutonomousManifest,
  autonomousBootstrap,
  readPages,
  showRootCover,
} from './manifest.ts';
import { createAutonomousResidency } from './residency.ts';
import { createAutonomousPool } from './poolApi.ts';
import { createHeldFloor } from './heldFloor.ts';
import { createWebglViews } from './views.ts';
import { autonomousRenderScale } from './renderScale.ts';
import { createContractLighting, graphBackground } from '../../lighting/contractLightingApi.ts';
import { createSceneDraw } from '../../webgl/cluster/sceneDraw.ts';
import type { BackendFactory } from '../types.ts';
import { createBlendCopy } from '../../cluster/blendCopyMesh.ts';
import type { HostMaterial } from '../../host/resources.ts';
import { createWebglDeformation } from '../../deformation/webglFrame.ts';
import { webglImpostorTier } from '../../webgl/impostor/code.ts';

/** WebGL2 path backed only by independently decoded prepared geometry pages. */
export const autonomousPagesBackend: BackendFactory = (context) => {
  const { metadata, descriptors, sourced } = prepareAutonomousManifest(context.metadata);
  const { roots, allPages, worlds, blendCopies, reassignBlend, blendOf, wears } =
    collectClusterPages(context.source, metadata, new Map(), context.associations, {
      allowMissing: true,
      blendCopy: createBlendCopy,
      pendingPlaced: true, // mounted in place once the view reads them (#751)
    });
  const [baseRoots, basePages] = [roots.slice(), allPages.slice()];
  const bootstrap = autonomousBootstrap(roots),
    baseBootstrap = bootstrap.slice();
  const byUrl = indexPagesByUrl(allPages, (rec) => rec.url), // by page, not by stream bundle
    bootstrapUrls = new Set(bootstrap.map((page) => page.url));
  const hostCeiling = context.maxResidentPages ?? Infinity,
    pageDefault = context.residentPagesDefault ?? Math.max(1024, bootstrapUrls.size),
    cap = hostCeiling < Infinity ? hostCeiling : pageDefault,
    scene = hostPageScene(blendCopies);
  const draws = createPageDraws(roots);
  for (const rec of allPages) draws.forEachDraw(rec, (draw) => (draw.material = rec.declaration));
  const declared = () =>
      allPages.flatMap((rec) => (draws.materialOf(rec) ? [draws.materialOf(rec)!] : [])),
    colorMaterials = new Map<HostMaterial, HostMaterial>(),
    modifiedPages = new Set<string>();
  const state = createAutonomousRenderState(),
    gate = createWebglFrameGate(),
    deformation = createWebglDeformation(roots, worlds, blendCopies), // the roots' records (#357)
    impostors = webglImpostorTier(context, roots, gate, () => hostDraw.textureRoom()),
    hosts = { ...context, deformation: deformation.source, cards: impostors?.cards },
    views = createWebglViews(context.viewport, gate, () => residency.keptChanged()),
    hostDraw = createSceneDraw(context.webglContext, scene, blendCopies, hosts, declared);
  const { lighting, api: lightingApi } = createContractLighting(scene, context, gate.sceneChanged);
  let ready = false;
  const geometryStore = createAutonomousGeometry({
    ...{ scene, roots, allPages, bootstrap, views, byUrl, descriptors },
    ...{ draws, colorMaterials, modifiedPages, deformWord: deformation.wordOf },
  });
  const { sync, acceptGeometryPage } = geometryStore;
  const classes = createClassPages({ context, roots, draws, geometryStore, wears, gate });
  // The tables a placement enters: instances and instance-buffer rows append to the same.
  const tables = { roots, allPages, bootstrap, byUrl, draws, blendOf };
  const heldFloor = createHeldFloor({ roots, bootstrap, modifiedPages, byUrl, draws, hostCeiling });
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
    fixedBytes: deformation.bytes,
    gate,
    geometryStore,
    residency,
    heldFloor,
    instanceCount,
    views,
  });
  const frame = createAutonomousRender({
    ...{ state, context, gate, lighting, roots, draws, blendCopies, worlds, deformation, ceiling },
    impostors,
    view: views.live,
    revision: () => heldFloor.placements,
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
      // The draw's own preparation, before any frame (`sceneDraw.ts`).
      const [pages] = await Promise.all([readPages(context, urls, sourced), hostDraw.prepare()]);
      pages.forEach((data, i) => acceptGeometryPage(urls[i], data));
      heldFloor.changed();
      ready = true;
      showRootCover(roots, views.live.shown, views.live.shownPacked);
      sync();
      residency.keptChanged();
      publishAutonomousCapabilities(context.onDiagnostic);
    },
    render(camera) {
      hostDraw.render(camera);
      if (ready) frame(camera);
    },
    ...hostDraw.host,
    ...hostDraw.materials,
    ...instances,
    ...autonomousPlacements({
      ...{ ...tables, context, descriptors, bootstrapUrls, blendCopies },
      ...{ scene, gate, geometryStore, coverChanged: heldFloor.placed },
    }),
    ...lightingApi,
    ...autonomousRenderScale(context),
    setClearColor: graphBackground(scene, gate.resourcesChanged),
    pendingUrls: residency.pendingUrls,
    retainedRanks: residency.retainedRanks,
    ...pool.api,
    materialClassRefusal: (alpha) =>
      instances.materialClassRefusal(alpha) ?? classes.refusal(alpha, allPages),
    flush: () => classes.settled().then(pool.api.flush),
    syncResident: () => (gate.resourcesChanged(), sync()),
    // A dynamic geometry's pages read its lists, uploaded as the next frame binds them (#573).
    updateVertices: () => (gate.sceneMoved(), true),
    refreshMaterials(values = true, alpha) {
      // Values reach the twins, clones; a picture alone (#362), shared, only lets the image go.
      if (values) colorMaterials.forEach((twin, original) => colouredHostSurface(original, twin));
      if (alpha && reassignBlend(allPages, alpha)) heldFloor.changed();
      if (alpha) classes.follow(alpha, allPages);
      (values ? gate.sceneChanged : gate.resourcesChanged)();
    },
    metrics: () =>
      backendMetrics({
        state,
        pool,
        residency,
        geometryStore,
        hostDraw,
        shown: views.live.shown,
        roots,
        rootRankOf: draws.rootRankOf,
        ready,
      }),
    dispose() {
      ready = false;
      hostDraw.dispose();
      impostors?.dispose();
      geometryStore.dispose();
      disposeOwnedMaterials();
      for (const material of colorMaterials.values()) releaseHostSurface(material);
      scene.clear();
      gate.release();
    },
  };
};
