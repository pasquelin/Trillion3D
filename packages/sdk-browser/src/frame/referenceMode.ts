import { explorerSwitch } from '../../../sdk-core/src/runtime/explorerSwitches.ts'
import { EngineError } from '../../../sdk-core/src/index.ts'
import { DEFAULT_HEIGHT, DEFAULT_PIXEL_RATIO, DEFAULT_WIDTH } from '../backend/common.ts'
import {
  assertFullShadowPool,
  referenceTilePlan,
  type ReferenceTilePlan,
} from './referenceTiles.ts'
import type { MeasuredWorldOptions } from '../world/session/options.ts'
import { REFERENCE_APPROXIMATIONS, REFERENCE_BOUNCE_BUDGET_MS } from './referenceApproximations.ts'

/**
 * THE ENGINE'S REFERENCE MODE: the image a rendering technique is held to (CONTRIBUTING.md,
 * "Image and fidelity", class 2), drawn by this very renderer with every approximation it names
 * switched off — never a second renderer:
 * - `renderScale`: the frame drawn at the display, 1, never reconstructed from fewer pixels;
 * - `temporalReuse`: no temporal antialiasing, no jitter, no history — one frame is the image;
 * - `probeBudget`: bounced light traces every probe at its per-frame ceiling, and the held frame a
 *   capture waits for is one whose probes converged (`unsettledMask`, `bounceProbes`);
 * - `shadowResolution`: shadows at the level they ask, from the full page pool; a pool the GPU
 *   budget shrank, or a full one whose fill raised the maps' resolution bias
 *   (`shadowResolutionBias` above 0), refuses the capture by name, never passes for the reference;
 * - `supersampling`: the frame drawn as tiles, each at `factor` samples per output pixel and axis
 *   and the most the portable texture side holds, box-filtered back in linear light and assembled
 *   (`referenceTiles.ts`);
 * - `reflectionTrace`: a rough reflection sample walks every pixel of its ray and resolves a miss
 *   by the program's whole fallback, never the capped Hi-Z walk (`reflections/hizTraceWgsl.ts`).
 * A still frame already shades every light of its tile (`LIGHT_SETTINGS.samplesPerPixel` samples a
 * moving one only): the capture is of a held, still frame.
 */

/** What the reference mode of an open session draws: the tiles it is drawn in, at which factor,
 *  and every approximation it names. */
export interface ReferenceMode {
  /** Samples per output pixel and axis the tiles reach. */
  factor: number
  approximations: typeof REFERENCE_APPROXIMATIONS
  /** The tiles the image is drawn in, each box-filtered and placed in linear light. */
  tiles: ReferenceTilePlan
}

/** The options a session opens on: `options` itself outside reference mode; in it, every named
 *  approximation off. The reference is drawn at the display, tile by tile (`referenceTiles.ts`),
 *  so the canvas keeps the display's size. */
export function referenceOptions(options: MeasuredWorldOptions): {
  options: MeasuredWorldOptions
  reference: ReferenceMode | null
} {
  if (!options.reference) return { options, reference: null }
  // A resize would change the tile plan under the reference: a reference is a still capture of a
  // fixed size, never a live canvas.
  if (explorerSwitch(options, 'interactive'))
    throw new EngineError(
      'REFERENCE_INTERACTIVE',
      'Reference mode draws a fixed size: open it without `interactive`',
    )
  const tiles = referenceTilePlan(
    options.width ?? DEFAULT_WIDTH,
    options.height ?? DEFAULT_HEIGHT,
    options.pixelRatio ?? DEFAULT_PIXEL_RATIO,
  )
  return {
    options: {
      ...options,
      renderScale: 1,
      temporalAntialiasing: false,
      bounceBudgetMs: REFERENCE_BOUNCE_BUDGET_MS,
    },
    reference: { factor: tiles.factor, approximations: REFERENCE_APPROXIMATIONS, tiles },
  }
}

/**
 * The session's `capture` in reference mode: the drawn frame, refused while the shadows draw
 * coarser than they ask, their page pool short (`assertFullShadowPool`). The canvas is at the
 * display — the tiles are drawn aside — so nothing is resolved here. Outside reference mode,
 * `capture` itself.
 */
export function referenceCapture(
  capture: () => Uint8Array,
  reference: ReferenceMode | null,
  shadowBias: () => number | null | undefined,
) {
  if (!reference) return capture
  return () => {
    assertFullShadowPool(shadowBias())
    return capture()
  }
}
