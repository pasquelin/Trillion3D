// Setup of the GPU-cut resume bench, split from its cases so neither file exceeds the line
// limit. Cases live in `resume.test.ts`.
import { IDENTITY_MATRIX4 } from '../../../../sdk-core/src/index.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { renderGpuCut } from '../pages/render/gpuCut.ts'
import { fixtureTotals, mountCutAdopter } from './adopter.fixture.ts'
import { cameraSelectionUniforms, createSelectionUniforms } from '../../gpu/core/selection.ts'
import { createEngineCamera, writeEngineCamera } from '../../camera/engineCamera.ts'
import { createWebgpuBudgetState } from '../residency/budgetState.ts'
import type { GpuCut, GpuSelection } from '../../gpu/core/selection.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'

const VIEWPORT: [number, number] = [512, 512]

/**
 * A minimal bench around `renderGpuCut`, while the root cover loads: one page, a simulated GPU
 * selection and simulated residency services. The page does not yet have its bytes; `arrive()`
 * gives them to it, as a CPU transfer decode would.
 */
export function banc(panne?: 'envoi') {
  // The kernel reads the engine camera only: posed at z = 5, looking down the axis.
  const camera = createEngineCamera()
  camera.world.set(IDENTITY_MATRIX4)
  camera.world[14] = 5
  writeEngineCamera(camera, { fov: 55, aspect: 1, near: 0.1, far: 100, zoom: 1 })
  const uniforms = createSelectionUniforms()
  cameraSelectionUniforms(camera, 0, VIEWPORT, uniforms)
  const page = {
    url: 'p0',
    triangles: 1,
    transparent: false,
  } as unknown as PageRec & { array?: Uint32Array }
  const comptes = { queue: 0, sync: 0, residence: 0, envois: 0, attentes: 0, disposes: 0 }
  const codes: string[] = []
  const residentFlags = new Uint32Array(1)
  const bootstrapState = { ready: false }
  // What GPU selection believes of residency, and the shown list it takes from it at each dispatch.
  let vueResidence = 0
  let releve: GpuCut = {
    uniforms,
    result: {
      pageIds: [0],
      drawablePageIds: [],
      frustumRejected: 0,
      lodLevel: 0,
      ...fixtureTotals(),
    },
    worldRevision: 0,
  }
  const selection = {
    worldRevision: 0,
    updateResidency(flags: Uint32Array) {
      comptes.residence++
      const change = vueResidence !== flags[0]
      vueResidence = flags[0]!
      return change
    },
    dispose() {
      comptes.disposes++
    },
    dispatch() {
      comptes.envois++
      if (panne === 'envoi') throw new Error('ENVOI_PERDU')
      // Selection draws the page once it believes it resident.
      releve = {
        uniforms,
        result: {
          pageIds: [0],
          drawablePageIds: vueResidence === 1 ? [0] : [],
          frustumRejected: 0,
          lodLevel: 0,
          ...fixtureTotals(),
        },
        worldRevision: 0,
      }
      return undefined
    },
    peek: () => releve,
    adopt: () => undefined,
  } as unknown as GpuSelection
  const { adopter, desired, shown } = mountCutAdopter({
    packedPages: [page],
    uniforms,
    selection: () => selection,
  })
  const rows = {
    // Already set: `ensurePageTable` has no device to ask on this bench.
    pageTableFloats: new Float32Array(4),
    rowsDenied: 0,
    packedCount: 0,
    candidateCount: 1,
    residentFlags,
    residencyChanges: undefined,
    clearResidencyChanges: () => {},
  }
  const mainView = {}
  const rt = {
    run: {
      gpuSelection: selection,
      selectionUniforms: uniforms,
      motion: {}, // a still camera: no view ahead
      ...createWebgpuBudgetState(),
      gpuMetricsReady: false,
      lost: false,
      frameHeld: false,
      desired,
      gate: { resourcesChanged: () => {}, revisions: { view: 0 } },
      frame: 0,
      imageRevision: 1,
      clearColor: 0,
    },
    gpu: { device: fakeDevice().device, cache: {} },
    capabilities: { unsupported: [] },
    views: { main: mainView, active: mainView },
    diag: {
      traceEnabled: true,
      // Only the waiting record counts (`traceGpuCutWaiting`): another trace is no wait.
      traceDiagnostic: (_phase: string, _message: string, payload: unknown) => {
        if ((payload as { coverage?: { ready: boolean } } | undefined)?.coverage?.ready === false)
          comptes.attentes++
      },
      engineDiagnostic: (code: string) => codes.push(code),
      diagnosticFailure: (code: string) => codes.push(code),
    },
    context: {},
    // No light cut ran: the lower residency tier receives nothing.
    lights: {},
    layout: { rows, drawSlots: 4 },
    setup: { viewport: VIEWPORT, slots: 10 },
    timing: { marks: {} },
    services: {
      bootstrapState,
      residencySets: {
        get requestedCount() {
          return desired.length
        },
      },
      residency: { short: () => false },
      queueCutResidency: () => {
        comptes.queue++
      },
      followEvictions: () => {},
      followCut: () => {},
      blendCasters: { asked: 0, used: 0 },
      syncRows: () => {
        comptes.sync++
        // Residency follows the bytes: a decoded page becomes resident for selection.
        residentFlags[0] = page.array ? 1 : 0
      },
      adoptGpuCut: () => adopter.adopt(),
      adoptViewCut: () => adopter.adopt(),
    },
  } as unknown as WebgpuPagesRuntime
  return {
    camera,
    comptes,
    codes,
    shown,
    desired,
    rt,
    image: () => renderGpuCut(rt, camera, 0, 0, 0),
    arrive: () => {
      page.array = new Uint32Array([0, 1, 2])
    },
  }
}
