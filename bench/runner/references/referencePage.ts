// The page side of `references/reference.ts`: one pose drawn by the engine in its reference mode
// (`packages/sdk-browser/src/frame/referenceMode.ts`), held, and its resolved capture sent to
// Node. Served under `/runner/` and imported by URL, like `lighting/lightingPage.ts`.
import type * as SdkBrowser from '../../witnesses/measurement.ts'
import type * as ExplorerPageModule from '../harness/explorerPage.ts'
import type * as MeasurePageModule from '../harness/measurePage.ts'
import type { MeasureViewOptions } from '../harness/measureOptions.ts'

/** Frames a reference pose may take to hold: bounced light converges over many more frames than
 *  temporal accumulation does (`HOLD_FRAME_LIMIT`). */
const REFERENCE_HOLD_LIMIT = 2048

/** What one reference pose returns: the frames it took to hold and what the engine drew it with;
 *  or why it drew none. */
export type ReferenceViewResult =
  | { error: string }
  | { supersampling: number; approximations: readonly string[]; settleFrames: number }

type SdkNamespace = typeof SdkBrowser & Record<string, SdkBrowser.BackendFactory | undefined>

export async function referenceView(options: MeasureViewOptions): Promise<ReferenceViewResult> {
  const sdk = (await import(options.sdkUrl)) as SdkNamespace
  const factory = options.backend ? sdk[options.backend] : undefined
  if (!factory) return { error: `engine missing from dist: ${options.backend}` }
  const explorerPage = (await import(
    `${options.modulesUrl}harness/explorerPage.ts`
  )) as typeof ExplorerPageModule
  const measure = (await import(
    `${options.modulesUrl}harness/measurePage.ts`
  )) as typeof MeasurePageModule
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const lost: string[] = (globalThis.gpuIncidents = [])
  const explorer = await sdk.openMeasuredWorld(canvas, {
    onDiagnostic: measure.collecteDiagnostics(lost).onDiagnostic,
    ...explorerPage.explorerOptions(options, factory, null),
    reference: true,
  })
  const reference = explorer.reference,
    captureReference = explorer.captureReference
  if (!reference || !captureReference) return { error: 'this dist has no reference mode' }
  for (const light of options.lights ?? []) explorer.addLight(light)
  explorer.setPose(options.pose)
  for (let i = 0; i < options.warmup; i++) {
    await explorer.awaitPages()
    explorer.render(options.pose)
    await explorer.flush()
  }
  const settleFrames = await measure.calmPose(explorer, options.pose, REFERENCE_HOLD_LIMIT)
  if (settleFrames === null)
    return { error: `the pose did not hold in ${REFERENCE_HOLD_LIMIT} frames: ${lost.join('; ')}` }
  const { factor, approximations, tiles } = reference
  // The image: the engine's own renderer, captured tile by tile (`referenceTiles.ts`). Refused by
  // name while the shadows draw coarser than they ask, their page pool short
  // (`referenceTilesCapture`).
  const rgba = await captureReference()
  const response = await measure.posterCapture(options.captureFile, rgba, tiles.width, tiles.height)
  explorer.dispose()
  canvas.remove()
  if (!response.ok) return { error: `the capture was not received: HTTP ${response.status}` }
  return { supersampling: factor, approximations, settleFrames }
}
