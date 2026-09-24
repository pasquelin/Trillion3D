import { meshes as objects, geometryBytes } from '../../packages/sdk-browser/src/scene/meshes.ts';
import { copyElements } from '../../packages/sdk-browser/src/math/matrixElements.ts';
import { threeMeshCopy } from './three/fromGraphNodes.ts';
import {
  baseCapabilities,
  DEFAULT_CLEAR_COLOR,
} from '../../packages/sdk-browser/src/backend/common.ts';
import { lighting } from './three/displayObjects.ts';
import { sceneLightingApi } from '../../packages/sdk-browser/src/lighting/sceneLighting.ts';
import { createThreeSceneDraw, hostDiagnostics } from './three/sceneAdapter.ts';
import {
  applyMeshDiagnostic,
  disposeTriangleGeometry,
} from '../../packages/sdk-browser/src/diagnostic/triangleDiagnostic.ts';
import type { BackendFactory } from '../../packages/sdk-browser/src/backend/types.ts';
import type { DiagnosticMode } from '../../packages/sdk-core/src/index.ts';
import * as THREE from 'three';

export const referenceBackend: BackendFactory = ({
  source,
  sceneLighting,
  clearColor = DEFAULT_CLEAR_COLOR,
  webglContext,
}) => {
  const scene = new THREE.Scene();
  const sceneLights = lighting(scene, clearColor, sceneLighting ?? source);
  // The witness draws itself, with the host library, through the adapter it shares (#85).
  const hostDraw = createThreeSceneDraw(webglContext, scene);
  let order = 0,
    allocationBytes = 0,
    selectedTriangles = 0;
  const seen = new Set<ArrayBufferView>();
  const copies: THREE.Mesh[] = [];
  const overlays: THREE.Material[] = [];
  for (const mesh of objects(source)) {
    const copy = threeMeshCopy(mesh);
    copy.matrixAutoUpdate = false;
    copyElements(copy.matrix.elements, mesh.matrixWorld.elements);
    copy.renderOrder = order++;
    copy.userData.sourceMesh = mesh;
    copy.userData.sourceGeometry = copy.geometry;
    copy.userData.sourceMaterial = copy.material;
    scene.add(copy);
    copies.push(copy);
    allocationBytes += geometryBytes(mesh.geometry, seen);
  }
  const applyDiagnostic = (mode: DiagnosticMode) => {
    overlays.splice(0).forEach((m) => m.dispose());
    for (const mesh of copies) applyMeshDiagnostic(mesh, mode, overlays, hostDiagnostics);
  };
  return {
    id: 'three-webgl-reference',
    capabilities: baseCapabilities,
    overBudget: false,
    scene,
    setDiagnostic: applyDiagnostic,
    async prepare() {},
    // This engine re-traverses scene on every frame: no revision needs to notify it.
    ...sceneLightingApi(sceneLights, () => {}),
    render(camera) {
      hostDraw.render(camera);
      source.updateMatrixWorld(true);
      sceneLights.update();
      selectedTriangles = 0;
      for (const mesh of copies) {
        mesh.matrix.copy((mesh.userData.sourceMesh as THREE.Mesh).matrixWorld);
        const index = mesh.geometry.getIndex();
        selectedTriangles +=
          (index ? index.count : mesh.geometry.getAttribute('position').count) / 3;
      }
    },
    drawHostGeometry: hostDraw.drawHostGeometry,
    // What the adapter submitted this frame: the meshes in view, and the calls they took.
    metrics: () => ({
      clusters: null,
      selectedTriangles,
      residentPages: null,
      geometryAllocationBytes: allocationBytes,
      pagesDetached: null,
      frustumRejected: null,
      lodLevel: null,
      submittedTriangles: selectedTriangles,
      totalSubmittedTriangles: hostDraw.counters()?.triangles ?? null,
      drawCalls: hostDraw.counters()?.calls,
    }),
    dispose() {
      hostDraw.dispose();
      overlays.forEach((m) => m.dispose());
      for (const mesh of copies)
        disposeTriangleGeometry(mesh.userData.sourceGeometry as THREE.BufferGeometry);
      scene.clear();
    },
  };
};
