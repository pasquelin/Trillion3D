import { DIAGNOSTICS, type DiagnosticMode } from '../../../../sdk-core/src/index.ts'
import type { BeautyMaterials } from '../../host/scene/graphDiagnostic.ts'
import { families } from '../../host/families.ts'
import type { RenderBackend } from '../../backend/types.ts'
import type { HostDisposable } from '../../host/resources.ts'

type Inputs = {
  check: () => void
  active: () => RenderBackend
  backends: RenderBackend[]
  beautyMaterials: BeautyMaterials
  overlays: HostDisposable[]
  setMode: (mode: DiagnosticMode) => void
}

export function createExplorerDiagnosticApi(inputs: Inputs) {
  const { check, active: getActive, backends, beautyMaterials, overlays, setMode } = inputs
  const views = families.diagnostics,
    noop = () => {}
  let asked: DiagnosticMode = 'beauty'
  /** Repaints the display graph of each engine that publishes one, on the views' code. */
  const repaint = (mode: DiagnosticMode) => {
    const code = views.get()
    for (const backend of backends)
      if (!backend.setDiagnostic && backend.hostDiagnostics)
        code?.repaintHostGraph(
          backend.scene,
          mode,
          backend.hostDiagnostics,
          beautyMaterials,
          overlays,
        )
  }
  return {
    setDiagnostic(mode: DiagnosticMode) {
      check()
      if (!DIAGNOSTICS[mode].available) throw new Error(DIAGNOSTICS[mode].reason)
      if (
        (mode === 'clusters' ||
          mode === 'pages' ||
          mode === 'lod' ||
          mode === 'visibility' ||
          mode === 'screen-error') &&
        getActive().id === 'three-webgl-reference'
      )
        throw new Error('Reference has no clusters')
      // The class a pixel was resolved under exists on the visibility path alone: the forward
      // engines shade each material in one program and would show nothing true under that name.
      if (mode === 'materials' && getActive().id !== 'webgpu-page-raster')
        throw new Error('Only the WebGPU visibility path resolves by material class')
      for (const [mesh, material] of beautyMaterials) mesh.material = material
      overlays.splice(0).forEach((m) => m.dispose())
      for (const backend of backends)
        if (backend.setDiagnostic) backend.setDiagnostic(mode)
        else if (!backend.hostDiagnostics)
          throw new Error(`${backend.id} declares neither a diagnostic nor host builders`)
      // An engine that declares no diagnostic of its own is repainted on the display graph it
      // publishes, with the host builders it hands in beside that graph, by the views' code: a
      // family on demand, which the frames of a view wait for (`../session/familyUse.ts`) and which
      // repaints on its arrival, the view still asked. Beauty before any view has nothing to undo.
      asked = mode
      if (views.arrived) repaint(mode)
      else if (mode !== 'beauty')
        void views.load().then(() => asked === mode && repaint(mode), noop)
      setMode(mode)
    },
  }
}
