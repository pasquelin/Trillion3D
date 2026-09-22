import { DIAGNOSTICS, type DiagnosticMode } from '../sdk-core/index.ts';
import { hashId } from './backendCommon.ts';
import { hostClusterMaterial, hostTriangleMaterial } from './threeSceneAdapter.ts';
import { triangleGeometry } from './triangleDiagnostic.ts';
import { materialSide } from './materialSide.ts';
import type { RenderBackend } from './backendTypes.ts';
import type {
  HostDiagnosticGeometry,
  HostDiagnosticMaterial,
  HostDiagnosticMesh,
  HostNode,
} from './hostResources.ts';

type Inputs = {
  check: () => void;
  active: () => RenderBackend;
  backends: RenderBackend[];
  beautyMaterials: Map<HostDiagnosticMesh, HostDiagnosticMesh['material']>;
  overlays: HostDiagnosticMaterial[];
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
        backend.scene.traverse((node: HostNode) => {
          const mesh = node as unknown as HostDiagnosticMesh;
          if (!mesh.isMesh) return;
          if (!beautyMaterials.has(mesh)) beautyMaterials.set(mesh, mesh.material);
          if (!mesh.userData.sourceGeometry) mesh.userData.sourceGeometry = mesh.geometry;
          mesh.material = beautyMaterials.get(mesh)!;
          mesh.geometry = mesh.userData.sourceGeometry as HostDiagnosticGeometry;
          if (mode === 'wireframe') {
            mesh.geometry = triangleGeometry(
              mesh.userData.sourceGeometry as HostDiagnosticGeometry,
              hashId(String(mesh.userData.clusterId ?? mesh.id)),
            );
            const material = hostTriangleMaterial(materialSide(mesh.material));
            overlays.push(material);
            mesh.material = material;
            return;
          }
          if (mode !== 'beauty') {
            const originals = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            const painted = originals.map((original) => {
              const material =
                mode === 'clusters' && mesh.userData.clusterId
                  ? hostClusterMaterial(String(mesh.userData.clusterId), original.side)
                  : original.clone();
              overlays.push(material);
              return material;
            });
            mesh.material = painted.length === 1 ? painted[0] : painted;
          }
        });
      }
      setMode(mode);
    },
  };
}
