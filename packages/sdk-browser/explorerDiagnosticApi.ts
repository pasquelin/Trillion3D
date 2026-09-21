import * as THREE from 'three';
import { DIAGNOSTICS, type DiagnosticMode } from '../sdk-core/index.ts';
import { clusterColor, hashId } from './backendCommon.ts';
import { createTriangleDiagnosticMaterial, triangleGeometry } from './triangleDiagnostic.ts';
import { materialSide } from './materialSide.ts';
import type { RenderBackend } from './backendTypes.ts';

type Inputs = {
  check: () => void;
  active: () => RenderBackend;
  backends: RenderBackend[];
  beautyMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
  overlays: THREE.Material[];
  setMode: (mode: DiagnosticMode) => void;
};

export function createExplorerDiagnosticApi(inputs: Inputs) {
  const { check, active: getActive, backends, beautyMaterials, overlays, setMode } = inputs;
  return {
    setDiagnostic(mode: DiagnosticMode) {
      check();
      if (!DIAGNOSTICS[mode].available) throw new Error(DIAGNOSTICS[mode].reason);
      if (
        (mode === 'clusters' ||
          mode === 'pages' ||
          mode === 'lod' ||
          mode === 'visibility' ||
          mode === 'screen-error') &&
        getActive().id === 'three-webgl-reference'
      )
        throw new Error('Reference has no clusters');
      // The class a pixel was resolved under exists on the visibility path alone: the forward
      // engines shade each material in one program and would show nothing true under that name.
      if (mode === 'materials' && getActive().id !== 'webgpu-page-raster')
        throw new Error('Only the WebGPU visibility path resolves by material class');
      for (const [mesh, material] of beautyMaterials) mesh.material = material;
      overlays.splice(0).forEach((m) => m.dispose());
      for (const backend of backends) {
        if (backend.setDiagnostic) {
          backend.setDiagnostic(mode);
          continue;
        }
        backend.scene.traverse((o) => {
          if (!(o as THREE.Mesh).isMesh) return;
          const mesh = o as THREE.Mesh;
          if (!beautyMaterials.has(mesh)) beautyMaterials.set(mesh, mesh.material);
          if (!mesh.userData.sourceGeometry) mesh.userData.sourceGeometry = mesh.geometry;
          mesh.material = beautyMaterials.get(mesh)!;
          mesh.geometry = mesh.userData.sourceGeometry as THREE.BufferGeometry;
          if (mode === 'wireframe') {
            mesh.geometry = triangleGeometry(
              mesh.userData.sourceGeometry as THREE.BufferGeometry,
              hashId(String(mesh.userData.clusterId ?? mesh.id)),
            );
            const material = createTriangleDiagnosticMaterial(materialSide(mesh.material));
            overlays.push(material);
            mesh.material = material;
            return;
          }
          if (mode !== 'beauty') {
            const originals = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mesh.material = originals.map((original) => {
              if (mode === 'clusters' && mesh.userData.clusterId) {
                const basic = new THREE.MeshBasicMaterial({
                  color: clusterColor(String(mesh.userData.clusterId), 0.75),
                  side: original.side,
                });
                overlays.push(basic);
                return basic;
              }
              const material = original.clone();
              overlays.push(material);
              return material;
            });
            if (mesh.material.length === 1) mesh.material = mesh.material[0];
          }
        });
      }
      setMode(mode);
    },
  };
}
