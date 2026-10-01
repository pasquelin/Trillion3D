import { DIAGNOSTICS, type DiagnosticMode } from '../../../../sdk-core/src/index.ts';
import type { RenderBackend } from '../../backend/types.ts';
import { families } from '../../host/families.ts';
import type { BeautyMaterials } from '../../host/scene/graphDiagnostic.ts';
import { isDrawnNode } from '../../host/graph/kinds.ts';
import type { HostDisposable, HostDiagnosticMesh } from '../../host/resources.ts';

/** The public spelling shares the world's diagnostic vocabulary. Unsupported modes fail by name. */
export function viewDiagnostic(name: string): DiagnosticMode {
  const mode = (name === 'triangles' ? 'wireframe' : name) as DiagnosticMode;
  if (!DIAGNOSTICS[mode]?.available) throw new Error(`VIEW_DIAGNOSTIC_UNSUPPORTED:${name}`);
  return mode;
}

/** A host diagnostic borrows the shared graph only through the current view's composition. */
export function withViewDisplay(
  backend: RenderBackend,
  beauty: BeautyMaterials,
  mode: DiagnosticMode,
  current: DiagnosticMode,
  draw: () => void,
) {
  const saved: [
    HostDiagnosticMesh,
    HostDiagnosticMesh['material'],
    HostDiagnosticMesh['geometry'],
  ][] = [];
  const overlays: HostDisposable[] = [];
  try {
    if (mode !== current) {
      const code = families.diagnostics.get();
      if (!code || !backend.hostDiagnostics) throw new Error('VIEW_DIAGNOSTIC_NOT_READY');
      backend.scene.traverse((node) => {
        if (isDrawnNode(node)) saved.push([node, node.material, node.geometry]);
      });
      code.repaintHostGraph(backend.scene, mode, backend.hostDiagnostics, beauty, overlays);
    }
    draw();
  } finally {
    for (const [mesh, material, geometry] of saved) {
      mesh.material = material;
      mesh.geometry = geometry;
    }
    for (const overlay of overlays) overlay.dispose();
  }
}
