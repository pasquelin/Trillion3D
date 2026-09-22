import { meshes, geometryBytes } from './sceneMeshes.ts';
import { asHostLibrary } from './hostResources.ts';
import { collectCover, buildIndex } from './threeLodHelpers.ts';
import { installSceneLighting, sceneLightingApi } from './sceneLighting.ts';
import { hostAimNode } from './backendCommon.ts';
import * as THREE from 'three';
import type { BackendFactory } from './backendTypes.ts';
import { applyMeshDiagnostic, disposeTriangleGeometry } from './triangleDiagnostic.ts';
import { isTransmissive } from './visibilityBuffer.ts';
import { setGeometryBounds } from './threeBounds.ts';
import { BOX_VALUES, boxEmpty, boxExpandByPoint } from '../sdk-core/index.ts';
import { resolveCameraWorld } from './cameraWorld.ts';
import { createThreeSceneDraw, hostDiagnostics } from './threeSceneAdapter.ts';

/** What this engine does not claim to do, with or without levels of detail. */
const HORS_PORTEE = [
  'GPU-driven selection/indirect draw',
  'occlusion culling',
  'bounded GPU eviction',
  'physical VRAM instrumentation',
];

/** Distance-based THREE.LOD from the same source meshes. Coarse levels exist only when QEM pages are present and loaded. */
export const threeLodBackend: BackendFactory = (context) => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(context.clearColor ?? 0x171d28);
  const lightSource = context.sceneLighting ?? context.source;
  const sceneLights = installSceneLighting(scene, lightSource, hostAimNode);
  const hostDraw = createThreeSceneDraw(context.webglContext, scene);
  const lods: THREE.LOD[] = [];
  let levels = 1,
    allocationBytes = 0,
    selectedTriangles = 0,
    lodLevel = 0,
    overBudget = false;
  const overlays: THREE.Material[] = [];
  const seen = new Set<ArrayBufferView>();
  let order = 0;
  for (const mesh of meshes(context.source)) {
    const association = context.associations.get(mesh);
    const primitive = context.metadata.primitives.find(
      (p) => p.mesh === association?.meshes && p.primitive === (association?.primitives ?? 0),
    );
    const lod = new THREE.LOD();
    lod.matrixAutoUpdate = false;
    lod.matrix.copy(mesh.matrixWorld);
    lod.userData.sourceMesh = mesh;
    const fine = new THREE.Mesh(mesh.geometry, mesh.material);
    fine.matrixAutoUpdate = false;
    fine.matrix.identity();
    fine.renderOrder = order;
    fine.frustumCulled = true;
    fine.userData.sourceGeometry = mesh.geometry;
    fine.userData.sourceMaterial = mesh.material;
    lod.addLevel(fine, 0);
    allocationBytes += geometryBytes(mesh.geometry, seen);
    if (primitive && primitive.pass !== 'shared-blend' && !isTransmissive(mesh.material)) {
      const coarseIds: number[] = [];
      collectCover(primitive.pages, coarseIds);
      if (
        primitive.pass === 'clustered-blend' ||
        (Array.isArray(mesh.material)
          ? mesh.material.some((material) => material.transparent)
          : mesh.material.transparent)
      ) {
        // A blended cover is drawn back to front in the source order the compiler recorded per cluster.
        coarseIds.sort((a, b) => (primitive.pages[a].start ?? a) - (primitive.pages[b].start ?? b));
      }
      const index = coarseIds.some((id) => primitive.pages[id].role === 'coarse')
        ? buildIndex(primitive.pages, coarseIds, context.indices)
        : null;
      if (index && index.length >= 3) {
        const geometry = new THREE.BufferGeometry();
        geometry.attributes = { ...mesh.geometry.attributes };
        geometry.setIndex(new THREE.BufferAttribute(index, 1));
        const box = new Float64Array(BOX_VALUES);
        boxEmpty(box, 0);
        for (const id of coarseIds) {
          const { min, max } = primitive.pages[id];
          boxExpandByPoint(box, 0, min[0], min[1], min[2]);
          boxExpandByPoint(box, 0, max[0], max[1], max[2]);
        }
        setGeometryBounds(geometry, box.subarray(0, 3), box.subarray(3, BOX_VALUES));
        const coarse = new THREE.Mesh(geometry, mesh.material);
        coarse.matrixAutoUpdate = false;
        coarse.matrix.identity();
        coarse.renderOrder = order;
        coarse.userData.lodLevel = 1;
        coarse.userData.sourceGeometry = geometry;
        coarse.userData.sourceMaterial = mesh.material;
        const radius = geometry.boundingSphere?.radius || mesh.geometry.boundingSphere?.radius || 1;
        lod.addLevel(coarse, Math.max(radius * 2, 1));
        levels = Math.max(levels, 2);
        allocationBytes += index.byteLength;
      }
    }
    scene.add(lod);
    lods.push(lod);
    order++;
  }
  return {
    id: 'three-lod',
    capabilities: {
      renderer: 'Three.js WebGL2 THREE.LOD',
      materials:
        'Converted glTF PBR, textures, alpha and double-sided flags preserved; no shadow map',
      hierarchy: levels > 1,
      gpuDriven: false,
      simplification: levels > 1,
      eviction: false,
      unsupported: levels > 1 ? HORS_PORTEE : ['general mesh LOD simplification', ...HORS_PORTEE],
    },
    get overBudget() {
      return overBudget;
    },
    scene,
    setDiagnostic(mode) {
      overlays.splice(0).forEach((m) => m.dispose());
      for (const lod of lods)
        for (const level of lod.levels)
          applyMeshDiagnostic(level.object as THREE.Mesh, mode, overlays, hostDiagnostics);
    },
    async prepare() {},
    // This engine rewalks the scene every frame: no revision has to teach it.
    ...sceneLightingApi(sceneLights, () => {}),
    render(camera) {
      hostDraw.render(camera);
      asHostLibrary<THREE.Object3D>(context.source).updateMatrixWorld(true);
      sceneLights.update();
      // Frame entry: the world pose, ancestors included, before any read (`cameraWorld.ts`).
      resolveCameraWorld(camera);
      selectedTriangles = 0;
      lodLevel = 0;
      overBudget = false;
      for (const lod of lods) {
        lod.matrix.copy((lod.userData.sourceMesh as THREE.Mesh).matrixWorld);
        lod.updateMatrixWorld(true);
        lod.update(camera);
        const current = lod.getCurrentLevel();
        lodLevel = Math.max(lodLevel, current);
        const object = lod.levels[current]?.object as THREE.Mesh | undefined;
        if (!object) continue;
        const index = object.geometry.getIndex();
        selectedTriangles +=
          (index ? index.count : object.geometry.getAttribute('position').count) / 3;
      }
    },
    metrics() {
      return {
        clusters: lods.length,
        selectedTriangles,
        residentPages: lods.length,
        geometryAllocationBytes: allocationBytes,
        pagesDetached: 0,
        frustumRejected: 0,
        lodLevel,
        submittedTriangles: selectedTriangles,
        totalSubmittedTriangles: hostDraw.counters()?.triangles ?? null,
        drawCalls: lods.length,
      };
    },
    drawHostGeometry: hostDraw.drawHostGeometry,
    dispose() {
      hostDraw.dispose();
      overlays.forEach((m) => m.dispose());
      for (const lod of lods) {
        for (const level of lod.levels) {
          const mesh = level.object as THREE.Mesh;
          const sourceGeometry = mesh.userData.sourceGeometry as THREE.BufferGeometry | undefined;
          if (sourceGeometry) disposeTriangleGeometry(sourceGeometry);
          if (
            mesh.geometry &&
            mesh.geometry !== (lod.levels[0]?.object as THREE.Mesh | undefined)?.geometry
          ) {
            for (const name of Object.keys(mesh.geometry.attributes))
              mesh.geometry.deleteAttribute(name);
            mesh.geometry.setIndex(null);
            mesh.geometry.dispose();
          }
        }
        lod.clear();
      }
      scene.clear();
    },
  };
};
