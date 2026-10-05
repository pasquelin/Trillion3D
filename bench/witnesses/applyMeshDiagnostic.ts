import { serialOf } from '../../packages/sdk-browser/src/host/graph/serial.ts';
import { hashId } from '../../packages/sdk-browser/src/diagnostic/colors.ts';
import { triangleGeometry } from '../../packages/sdk-browser/src/diagnostic/triangleDiagnostic.ts';
import { materialSide } from '../../packages/sdk-browser/src/scene/materialSide.ts';
import type {
  HostDiagnosticFactory,
  HostDiagnosticGeometry,
  HostDiagnosticMesh,
  HostDisposable,
} from '../../packages/sdk-browser/src/host/resources.ts';
import type { DiagnosticMode } from '../../packages/sdk-core/src/index.ts';

/**
 * Give a copy back its original geometry and material, kept in `userData`, then, in wireframe
 * mode, set its per-triangle colouring. The created material and copy go into `overlays`, to discard
 * with the mode.
 */
export function applyMeshDiagnostic(
  mesh: HostDiagnosticMesh,
  mode: DiagnosticMode,
  overlays: HostDisposable[],
  host: HostDiagnosticFactory,
) {
  const sourceGeometry = mesh.userData.sourceGeometry as HostDiagnosticGeometry;
  const sourceMaterial = mesh.userData.sourceMaterial as HostDiagnosticMesh['material'];
  mesh.geometry = sourceGeometry;
  mesh.material = sourceMaterial;
  if (mode !== 'wireframe') return;
  mesh.geometry = triangleGeometry(
    sourceGeometry,
    host,
    hashId(String(serialOf(mesh) ?? mesh.id)),
    overlays,
  );
  const material = host.triangleMaterial(materialSide(sourceMaterial));
  overlays.push(material);
  mesh.material = material;
}
