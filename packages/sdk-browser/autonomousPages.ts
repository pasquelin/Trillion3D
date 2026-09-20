import * as THREE from 'three';
import { collectClusterPages, indexPagesByUrl, type PageRec } from './pageSelection.ts';
import { createAutonomousRender, createAutonomousRenderState } from './autonomousRender.ts';
import { createWebglFrameGate } from './webglFrameGate.ts';
import { decodePageOffThread } from './pageDecodeHost.ts';
import { createAutonomousGeometry } from './autonomousGeometry.ts';
import { createAutonomousInstances } from './autonomousInstances.ts';
import { prepareAutonomousManifest, autonomousBootstrap } from './autonomousManifest.ts';
import { comptePagesResidentes, createAutonomousResidency } from './autonomousResidency.ts';
import { installSceneLighting, sceneLightingApi } from './sceneLighting.ts';
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
    basePages = allPages.slice();
  const bootstrap = autonomousBootstrap(roots);
  const baseBootstrap = bootstrap.slice();
  const byUrl = indexPagesByUrl(allPages),
    bootstrapUrls = new Set(bootstrap.map((page) => page.url));
  const cap =
      context.maxResidentPages ??
      context.residentPagesDefault ??
      Math.max(1024, bootstrapUrls.size),
    scene = new THREE.Scene();
  const lighting = installSceneLighting(
    scene,
    context.sceneLighting ?? context.source,
    context.clearColor ?? 0x171d28,
  );
  const shown: PageRec[] = [],
    desired: PageRec[] = [],
    pending: string[] = [],
    retained: string[] = [];
  const baseMaterials = new Map(allPages.map((rec) => [rec, rec.material] as const)),
    colorMaterials = new Map<THREE.Material, THREE.Material>();
  const modifiedPages = new Set<string>();
  const state = createAutonomousRenderState(),
    gate = createWebglFrameGate();
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
  const instances = createAutonomousInstances({
    roots,
    baseRoots,
    allPages,
    basePages,
    bootstrap,
    baseBootstrap,
    byUrl,
    baseMaterials,
    colorMaterials,
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
        'glTF opaque and alpha-mask materials; independent positions, normals, UVs, tangents and colors',
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
      if (ready) renderFrame(camera);
    },
    ...instances,
    ...sceneLightingApi(lighting, gate.sceneChanged),
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
        drawCalls: shown.length,
        coverageReady: ready,
        coverageBudgetLimited: state.overBudget,
        frameHeld: state.frameHeld,
      };
    },
    dispose() {
      ready = false;
      for (const rec of allPages) {
        detach(rec);
        rec.geometry?.dispose();
        rec.geometry = undefined;
        rec.mesh = undefined;
        rec.array = undefined;
      }
      for (const material of colorMaterials.values()) material.dispose();
      scene.clear();
      gate.release();
    },
  };
};
