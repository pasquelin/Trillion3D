import { DIAGNOSTICS, type DiagnosticMode } from '../sdk-core/src/index.ts';
import { repaintHostGraph, type BeautyMaterials } from './hostGraphDiagnostic.ts';
import type { RenderBackend } from './backendTypes.ts';
import type { HostDiagnosticMaterial } from './hostResources.ts';

type Inputs = {
  check: () => void;
  active: () => RenderBackend;
  backends: RenderBackend[];
  beautyMaterials: BeautyMaterials;
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
        // An engine that declares no diagnostic of its own is repainted on the display graph it
        // publishes, with the host builders it hands in beside that graph.
        if (!backend.hostDiagnostics)
          throw new Error(`${backend.id} declares neither a diagnostic nor host builders`);
        repaintHostGraph(backend.scene, mode, backend.hostDiagnostics, beautyMaterials, overlays);
      }
      setMode(mode);
    },
  };
}
