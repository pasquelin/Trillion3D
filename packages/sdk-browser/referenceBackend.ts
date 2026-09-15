import { meshes as objects, geometryBytes } from './sceneMeshes.ts';
import { baseCapabilities, hashId, lighting, DEFAULT_CLEAR_COLOR } from './backendCommon.ts';
import { sceneLightingApi } from './sceneLighting.ts';
import {
  createTriangleDiagnosticMaterial,
  disposeTriangleGeometry,
  materialSide,
  triangleGeometry,
} from './triangleDiagnostic.ts';
import type { BackendFactory } from './backendTypes.ts';
import type { DiagnosticMode } from '../sdk-core/index.ts';
import * as THREE from 'three';

export const referenceBackend: BackendFactory = ({
  source,
  sceneLighting,
  clearColor = DEFAULT_CLEAR_COLOR,
}) => {
  const scene = new THREE.Scene();
  const sceneLights = lighting(scene, clearColor, sceneLighting ?? source);
  let order = 0,
    allocationBytes = 0,
    selectedTriangles = 0;
  const seen = new Set<ArrayBufferView>();
  const copies: THREE.Mesh[] = [];
  const overlays: THREE.Material[] = [];
  for (const mesh of objects(source)) {
    const copy = new THREE.Mesh(mesh.geometry, mesh.material);
    copy.matrixAutoUpdate = false;
    copy.matrix.copy(mesh.matrixWorld);
    copy.renderOrder = order++;
    copy.userData.sourceMesh = mesh;
    copy.userData.sourceGeometry = mesh.geometry;
    copy.userData.sourceMaterial = mesh.material;
    scene.add(copy);
    copies.push(copy);
    allocationBytes += geometryBytes(mesh.geometry, seen);
  }
  const applyDiagnostic = (mode: DiagnosticMode) => {
    overlays.splice(0).forEach((m) => m.dispose());
    for (const mesh of copies) {
      const sourceGeometry = mesh.userData.sourceGeometry as THREE.BufferGeometry;
      const sourceMaterial = mesh.userData.sourceMaterial as THREE.Material | THREE.Material[];
      mesh.geometry = sourceGeometry;
      mesh.material = sourceMaterial;
      if (mode === 'wireframe') {
        mesh.geometry = triangleGeometry(sourceGeometry, hashId(String(mesh.id)));
        const material = createTriangleDiagnosticMaterial(materialSide(sourceMaterial));
        overlays.push(material);
        mesh.material = material;
      }
    }
  };
  return {
    id: 'three-webgl-reference',
    capabilities: baseCapabilities,
    overBudget: false,
    scene,
    setDiagnostic: applyDiagnostic,
    async prepare() {},
    ...sceneLightingApi(sceneLights),
    render() {
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
    metrics: () => ({
      clusters: null,
      selectedTriangles,
      residentPages: null,
      geometryAllocationBytes: allocationBytes,
      pagesDetached: null,
      frustumRejected: null,
      lodLevel: null,
      submittedTriangles: selectedTriangles,
    }),
    dispose() {
      overlays.forEach((m) => m.dispose());
      for (const mesh of copies)
        disposeTriangleGeometry(mesh.userData.sourceGeometry as THREE.BufferGeometry);
      scene.clear();
    },
  };
};
