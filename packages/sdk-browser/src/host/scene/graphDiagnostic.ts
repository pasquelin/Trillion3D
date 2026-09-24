import { hashId } from '../../diagnostic/colors.ts';
import { materialSide } from '../../scene/materialSide.ts';
import { triangleGeometry } from '../../diagnostic/triangleDiagnostic.ts';
import { isDrawnNode } from '../graph/kinds.ts';
import type { DiagnosticMode } from '../../../../sdk-core/src/index.ts';
import type {
  HostDiagnosticFactory,
  HostDiagnosticGeometry,
  HostDiagnosticMesh,
  HostDisposable,
  HostScene,
} from '../resources.ts';

/**
 * The diagnostic of an engine that declares none: its display graph is repainted mesh by mesh,
 * from outside. Every number is the engine's — the salt of a mesh, the cluster a tint stands for,
 * the side a copy keeps — and every object hung on the graph is the host's, made by the factory
 * the engine handed in with it (`RenderBackend.hostDiagnostics`). No rendering library is named
 * here, and none is loaded by this file.
 *
 * `beautyMaterials` is the pair kept beside the graph: the surface a mesh wore before any view,
 * given back on `beauty` and read again for every other mode, so that two views in a row paint
 * the source surface rather than the previous view's copy. `overlays` collects what was made,
 * for its owner to discard with the mode.
 */
export type BeautyMaterials = Map<HostDiagnosticMesh, HostDiagnosticMesh['material']>;

export function repaintHostGraph(
  scene: HostScene,
  mode: DiagnosticMode,
  host: HostDiagnosticFactory,
  beautyMaterials: BeautyMaterials,
  overlays: HostDisposable[],
) {
  scene.traverse((node) => {
    if (!isDrawnNode(node)) return;
    // A view swaps the factory's own surfaces and geometries onto the mesh: it writes through
    // the diagnostic shape the witnesses share.
    const mesh: HostDiagnosticMesh = node;
    if (!beautyMaterials.has(mesh)) beautyMaterials.set(mesh, mesh.material);
    if (!mesh.userData.sourceGeometry) mesh.userData.sourceGeometry = mesh.geometry;
    const sourceGeometry = mesh.userData.sourceGeometry as HostDiagnosticGeometry;
    const sourceMaterial = beautyMaterials.get(mesh)!;
    mesh.material = sourceMaterial;
    mesh.geometry = sourceGeometry;
    if (mode === 'beauty') return;
    if (mode === 'wireframe') {
      const salt = hashId(String(mesh.userData.clusterId ?? mesh.serial ?? mesh.id));
      mesh.geometry = triangleGeometry(sourceGeometry, host, salt, overlays);
      const material = host.triangleMaterial(materialSide(sourceMaterial));
      overlays.push(material);
      mesh.material = material;
      return;
    }
    const clusterId = mesh.userData.clusterId;
    const originals = Array.isArray(sourceMaterial) ? sourceMaterial : [sourceMaterial];
    const painted = originals.map((original) => {
      const material =
        mode === 'clusters' && clusterId
          ? host.clusterMaterial(String(clusterId), original.side)
          : original.clone();
      overlays.push(material);
      return material;
    });
    mesh.material = painted.length === 1 ? painted[0] : painted;
  });
}
