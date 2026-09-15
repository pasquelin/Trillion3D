import * as THREE from 'three';
import {
  collectClusterPages,
  indexPagesByUrl,
  resolvePixelError,
  selectVisiblePages,
  type PageRec,
} from './pageSelection.ts';
import { decodeGeometryPage } from './geometryPage.ts';
import { createAutonomousGeometry } from './autonomousGeometry.ts';
import { createAutonomousInstances } from './autonomousInstances.ts';
import { prepareAutonomousManifest, autonomousBootstrap } from './autonomousManifest.ts';
import { comptePagesResidentes, createAutonomousResidency } from './autonomousResidency.ts';
import { installSceneLighting } from './sceneLighting.ts';
import type { BackendFactory } from './backendTypes.ts';

/** WebGL2 path backed only by independently decoded prepared geometry pages. */
export const autonomousPagesBackend: BackendFactory = (context) => {
  const { metadata, descriptors } = prepareAutonomousManifest(context.metadata);
  const { roots, allPages } = collectClusterPages(
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
  const cap = context.maxResidentPages ?? Math.max(1024, bootstrapUrls.size),
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
  let visible = 0,
    selectedTriangles = 0,
    frustumRejected = 0,
    lodLevel = 0,
    overBudget = false,
    ready = false;
  const motion: { last?: THREE.Vector3; lastMs?: number } = {};
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
      return overBudget;
    },
    async prepare() {
      if (!context.readGeometryPage) throw new Error('AUTONOMOUS_PAGE_READER_MISSING');
      if (bootstrap.length > cap) throw new Error('AUTONOMOUS_ROOT_BUDGET');
      await Promise.all(
        [...bootstrapUrls].map(async (url) => {
          context.signal?.throwIfAborted();
          const bytes = await context.readGeometryPage!(url);
          context.signal?.throwIfAborted();
          acceptGeometryPage(url, await decodeGeometryPage(bytes));
        }),
      );
      ready = true;
      shown.push(...bootstrap);
      sync();
    },
    render(camera) {
      if (!ready) return;
      context.source.updateMatrixWorld(true);
      lighting.update();
      const selected = selectVisiblePages(
        roots,
        camera,
        {
          pixelError: resolvePixelError(context, camera, motion),
          viewport: context.viewport,
          holdResident: true,
        },
        shown,
      );
      desired.length = 0;
      desired.push(...selected.wanted);
      visible = selected.visible;
      selectedTriangles = selected.selectedTriangles;
      frustumRejected = selected.frustumRejected;
      lodLevel = selected.lodLevel;
      overBudget = shown.length > cap;
      if (overBudget) {
        shown.length = 0;
        shown.push(...bootstrap);
      }
      sync();
    },
    ...instances,
    refreshSceneLighting() {
      lighting.refresh();
    },
    ...residency,
    acceptGeometryPage,
    replaceGeometryPage(url, data) {
      if (!byUrl.has(url)) throw new Error('AUTONOMOUS_PAGE_MISSING');
      storeGeometryPage(url, data);
      modifiedPages.add(url);
    },
    syncResident: sync,
    metrics() {
      return {
        clusters: visible,
        selectedTriangles,
        residentPages: comptePagesResidentes(allPages),
        geometryAllocationBytes: geometryStore.state.allocationBytes,
        cacheEvictions: residency.cacheEvictions,
        frustumRejected,
        lodLevel,
        submittedTriangles: geometryStore.state.submittedTriangles,
        drawCalls: shown.length,
        coverageReady: ready,
        coverageBudgetLimited: overBudget,
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
    },
  };
};
