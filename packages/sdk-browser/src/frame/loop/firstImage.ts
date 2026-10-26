import { cpuNow } from '../../diagnostic/stopwatch.ts'
import { FALLBACK_REFRESH_MS } from '../scale/scaleTargets.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { viewLoading } from './unsettled.ts'

/**
 * THE SESSION'S FIRST IMAGE, SHOWN ONLY ONCE THE VIEW HAS LOADED: the initial load. A world is
 * never presented before the streaming of the cells around its viewer has completed: until the
 * main view has loaded once — every cell wished within its grid's loading range visible, its
 * content placed and its roots resident, the root cover in, the cut read back and the
 * view still (`viewLoading`) — each image is drawn whole, its cut read back, its pages and tiles asked,
 * but none is presented (`WebgpuRunState.imageWithheld`): the canvas keeps what it showed — the
 * page behind it, or the image of a session closed on it (`../../gpu/core/canvasHandover.ts`).
 * Every view's images are withheld with the main view's. During it the partition holds no cell
 * back from loading and weighs no slow streaming (`Engine.initialLoad`), and no HLOD switch waits
 * on a warm-up; it ends with the first image (`WorldCells.firstImageShown`).
 *
 * Meanwhile loading takes the whole main-thread frame (`FALLBACK_REFRESH_MS`, the frame of the
 * slowest display drawn for), not the share an image on screen leaves it (`FrameClock.widen`):
 * cells, arrivals, rows, tiles and the residency queue spend it, so the near cells arrive as fast
 * as the network and the device allow. The device stays bounded by the loop's own admission: no
 * image is drawn past the frames in flight (`skipsWebgpuFrame`).
 *
 * The first image is the first drawn once the view has loaded; from then on every image is
 * presented, but while a partition's load blocks on slow streaming (`Engine.streamingBlocks`,
 * `../../geometry/partition/slowStreaming.ts`): the gate closes again till the cells it waits for
 * show, the loop given the whole frame meanwhile. Any other move that outruns streaming is drawn by
 * what is resident, as any image. The opening is said once (`first-image`): the frame, and the
 * time since the page's navigation began — the page's time to its first image.
 *
 * Read at each image's entry, before its hold (`../render/render.ts`): what the last image left —
 * its cut adopted, its rows sent, the cells it switched — is what this one is drawn with.
 */
export function followFirstImage(rt: WebgpuPagesRuntime) {
  const { run, views, capture, clock, diag } = rt
  if (views.active !== views.main || capture.capturing) return
  if (!run.initialLoad) return followBlockingLoad(rt)
  if (viewLoading(rt)) return void clock.widen(FALLBACK_REFRESH_MS)
  run.imageWithheld = run.initialLoad = false
  run.gpuSelection?.world?.firstImageShown()
  clock.narrow()
  diag.engineDiagnostic('first-image', 'The view has loaded: its first image is shown', {
    frame: run.frame,
    sinceNavigationMs: cpuNow(),
  })
}

/** Once the first image is shown: the images withheld while a partition's load blocks on slow
 *  streaming, the loop's frame wide meanwhile, and presented again once it blocks no more. */
function followBlockingLoad({ run, clock }: WebgpuPagesRuntime) {
  if (run.imageWithheld === run.streamingBlocks) return
  run.imageWithheld = run.streamingBlocks
  if (run.imageWithheld) clock.widen(FALLBACK_REFRESH_MS)
  else clock.narrow()
}
