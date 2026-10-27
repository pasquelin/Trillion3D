// Setup of the GPU-cut resume bench, split from its cases so neither file exceeds the line
// limit. Cases live in `resume.test.ts`.
import { createPresentClasses } from '../../../gpu/core/presentClasses.ts'
import { IDENTITY_MATRIX4 } from '../../../../../math/src/matrix/matrix4.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { renderGpuCut } from '../../../frame/render/gpuCut.ts'
import { createScaleControl } from '../../../frame/scale/scaleControl.ts'
import { fixtureTotals, mountCutAdopter } from './adopter.fixture.ts'
import { cameraSelectionUniforms, createSelectionUniforms } from '../../../gpu/core/selection.ts'
import { createEngineCamera, writeEngineCamera } from '../../../camera/engineCamera.ts'
import { createWebgpuBudgetState } from '../../residency/budgetState.ts'
import type { GpuCut, GpuSelection, PageResidency } from '../../../gpu/core/selection.ts'
import type { PageRec } from '../../selection/types.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { createViewHidden } from '../../../frame/render/viewHidden.ts'

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
  // What the rays' scene was told of the draw distances at each image: the main eye, the view.
  const codes: string[] = []
  const residentFlags = new Uint32Array(1)
  const bootstrapState = { ready: false }
  // What GPU selection believes of residency, and the shown list it takes from it at each dispatch.
  let vueResidence = 0
  let releve: GpuCut = {
    uniforms,
    result: {
      pageIds: [0],
      requests: { pages: [0], counts: [1], priorities: [1] },
      drawablePageIds: [],
      frustumRejected: 0,
      lodLevel: 0,
      ...fixtureTotals(),
      occluded: 0,
      postHidden: 0,
    },
    worldRevision: 0,
  }
  const selection = {
    worldRevision: 0,
    // The lists' caps the session's settings give the cut: this bench's selection has no lists.
    holdLists() {},
    updateResidency(flags: PageResidency) {
      comptes.residence++
      const change = vueResidence !== flags.flag(0)
      vueResidence = flags.flag(0)
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
          requests: { pages: [0], counts: [1], priorities: [1] },
          drawablePageIds: vueResidence === 1 ? [0] : [],
          frustumRejected: 0,
          lodLevel: 0,
          ...fixtureTotals(),
          occluded: 0,
          postHidden: 0,
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
  const clusters = {
    candidateCount: 1,
    residency: { length: 1, flag: (page: number) => residentFlags[page] },
    residencyChanges: undefined,
    clearResidencyChanges: () => {},
  }
  // The world's render scale: the cut asks it for the edge scale's fraction.
  const mainView = { scale: createScaleControl(undefined) }
  const rt = {
    run: {
      gpuSelection: selection,
      selectionUniforms: uniforms,
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
    gpu: { device: fakeDevice().device, cache: {}, targetSize: VIEWPORT },
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
    // No light cut ran.
    lights: {},
    // No texture streams: the residency stream pumps no tile; no displaced surface.
    vis: { materialTable: { displaced: { count: 0 } }, presentClasses: createPresentClasses() },
    layout: {
      clusters,
      selectionRoots: [],
      rootIndex: { revision: 0 },
      viewHidden: createViewHidden(),
    },
    setup: { viewport: VIEWPORT, slots: 10 },
    timing: { marks: {} },
    services: {
      bootstrapState,
      residencySets: {
        get requestedCount() {
          return desired.length
        },
      },
      residency: { qualityScale: 1 },
      queueCutResidency: () => {
        comptes.queue++
      },
      followCut: () => {},
      syncClusters: () => {
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
    image: () => renderGpuCut(rt, camera, 0, 0),
    arrive: () => {
      page.array = new Uint32Array([0, 1, 2])
    },
  }
}
