import * as THREE from 'three';
import { asHostLibrary } from './hostResources.ts';
import { collectClusterPages, indexPagesByUrl, type PageRec } from './pageSelection.ts';
import { createAutonomousRender, createAutonomousRenderState } from './autonomousRender.ts';
import { createWebglFrameGate } from './webglFrameGate.ts';
import { decodePageOffThread } from './pageDecodeHost.ts';
import { createAutonomousGeometry } from './autonomousGeometry.ts';
import { createAutonomousInstances } from './autonomousInstances.ts';
import { prepareAutonomousManifest, autonomousBootstrap } from './autonomousManifest.ts';
import { comptePagesResidentes, createAutonomousResidency } from './autonomousResidency.ts';
import { createContractLighting } from './contractLightingApi.ts';
import { createThreeSceneDraw } from './threeSceneAdapter.ts';
import type { BackendFactory } from './backendTypes.ts';
import type { DecodedGeometryPage } from './geometryPage.ts';

/** WebGL2 path backed only by independently decoded prepared geometry pages. */
export const autonomousPagesBackend: BackendFactory = (context) => {
  const { metadata, descriptors } = prepareAutonomousManifest(context.metadata);
  const { roots, allPages, worlds } = collectClusterPages(
    context.source,
    metadata,
    new Map(),
    context.associations,
    { allowMissing: true },
  );
  const baseRoots = roots.slice(),
    basePages = allPages.slice(),
    bootstrap = autonomousBootstrap(roots),
    baseBootstrap = bootstrap.slice();
  const byUrl = indexPagesByUrl(allPages, (rec) => rec.url), // by page, not by stream bundle
    bootstrapUrls = new Set(bootstrap.map((page) => page.url));
  const cap =
      context.maxResidentPages ??
      context.residentPagesDefault ??
      Math.max(1024, bootstrapUrls.size),
    scene = new THREE.Scene();
  const shown: PageRec[] = [],
    desired: PageRec[] = [],
    pending: string[] = [],
    retained: string[] = [];
  const baseMaterials = new Map(allPages.map((rec) => [rec, rec.declaration] as const)),
    colorMaterials = new Map<THREE.Material, THREE.Material>();
  const modifiedPages = new Set<string>(),
    state = createAutonomousRenderState(),
    gate = createWebglFrameGate(),
    hostDraw = createThreeSceneDraw(context.webglContext, scene);
  // The engine's own lighting: the cache's radiometric light table where it declares one, the
  // source graph's lights otherwise (`contractLightingApi.ts`).
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
  const { detach, sync, storeGeometryPage, acceptGeometryPage } = geometryStore;
  const { disposeOwnedMaterials, ...instances } = createAutonomousInstances({
    roots,
    baseRoots,
    allPages,
    basePages,
    bootstrap,
    baseBootstrap,
    byUrl,
    baseMaterials,
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
    capabilities: {
      renderer: 'WebGL2 autonomous prepared pages',
      materials:
        'glTF opaque and alpha-mask materials; independent positions, normals, UVs and colors; tangents rebuilt per triangle',
      hierarchy: true,
      gpuDriven: false,
      simplification: !!context.metadata.simplification,
      eviction: true,
      unsupported: [
        'BLEND and transmission in autonomous mode',
        'GPU-driven selection and indirect drawing',
        'physical VRAM instrumentation',
        'global illumination',
      ],
    },
    get overBudget() {
      return state.overBudget;
    },
    get frameHeld() {
      return state.frameHeld;
    },
    async prepare() {
      if (!context.readGeometryPage) throw new Error('AUTONOMOUS_PAGE_READER_MISSING');
      if (bootstrap.length > cap) throw new Error('AUTONOMOUS_ROOT_BUDGET');
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
        drawCalls: shown.length,
        coverageReady: ready,
        coverageBudgetLimited: state.overBudget,
        frameHeld: state.frameHeld,
      };
    },
    dispose() {
      ready = false;
      hostDraw.dispose();
      for (const rec of allPages) {
        detach(rec);
        asHostLibrary<THREE.BufferGeometry | undefined>(rec.geometry)?.dispose();
        rec.geometry = undefined;
        rec.mesh = undefined;
        rec.array = undefined;
      }
      disposeOwnedMaterials();
      for (const material of colorMaterials.values()) material.dispose();
      scene.clear();
      gate.release();
    },
  };
};
