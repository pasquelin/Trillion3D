import { EngineError, LIGHT_SETTINGS } from '../../../sdk-core/src/index.ts';
import { DEFAULT_HEIGHT, DEFAULT_PIXEL_RATIO, DEFAULT_WIDTH } from '../backend/common.ts';
import { referenceTilePlan, type ReferenceTilePlan } from './referenceTiles.ts';
import type { MeasuredWorldOptions } from '../world/session/options.ts';

/**
 * THE ENGINE'S REFERENCE MODE (#1281): the image a rendering technique is held to (CONTRIBUTING.md,
 * "Image and fidelity", class 2), drawn by this very renderer with every approximation it names
 * switched off — never a second renderer:
 * - `renderScale`: the frame drawn at the display, 1, never reconstructed from fewer pixels;
 * - `temporalReuse`: no temporal antialiasing, no jitter, no history — one frame is the image;
 * - `probeBudget`: bounced light traces every probe at its per-frame ceiling, and the held frame a
 *   capture waits for is one whose probes converged (`unsettledMask`, `bounceProbes`);
 * - `shadowResolution`: shadows at the pool's full size; a pool the device shrank
 *   (`shadowResolutionBias` above 0) refuses the capture by name, never passes for the reference;
 * - `supersampling`: the frame drawn as tiles, each at `factor` samples per output pixel and axis
 *   and the most the portable texture side holds, box-filtered back in linear light and assembled
 *   (`referenceTiles.ts`).
 * A still frame already shades every light of its tile (`LIGHT_SETTINGS.samplesPerPixel` samples a
 * moving one only): the capture is of a held, still frame.
 */
export const REFERENCE_APPROXIMATIONS = [
  'renderScale',
  'temporalReuse',
  'probeBudget',
  'shadowResolution',
  'supersampling',
] as const;

/** The bounce target of the reference, in milliseconds: far past any frame, so the budget never
 *  lowers the probes traced below their per-frame ceiling (`createBounceBudget`). */
export const REFERENCE_BOUNCE_BUDGET_MS = 1000;

/** The boss's case (#1281): 1728 × 1117 CSS at DPR 2, a 55° vertical field. */
export const REFERENCE_VIEW_HEIGHT_PX = 1117 * 2;
export const REFERENCE_VIEW_FOV_DEG = 55;

/**
 * Pages a side of a clipmap level a view of `height` device pixels at vertical field `fov` needs
 * so every pixel reads the finest level: a pixel at the top edge sits `height / tan(fov/2)` device
 * pixels from the camera axis, and a window of `pages` reaches `pages · shadowPage / 2` each way
 * (`contracts.ts`, `sunLevels.ts`). Rounded up to an even window — `sunLevels` centres it on the
 * camera by whole pages — and never below the ordinary constant. At the boss's case:
 * 2234 / tan(27.5°) = 4291, so `pages · 64 ≥ 4291` gives 68.
 */
export function referenceSunWindow(
  height = REFERENCE_VIEW_HEIGHT_PX,
  fov = REFERENCE_VIEW_FOV_DEG,
) {
  const extent = height / Math.tan((fov * Math.PI) / 360);
  const pages = Math.ceil((2 * extent) / LIGHT_SETTINGS.shadowPage);
  return Math.max(LIGHT_SETTINGS.sunLevelPages, pages + (pages % 2));
}

/** The sun clipmap window a reference session runs with (`referenceSunWindow`): 68 at the boss's
 *  case, so every shadow texel is full resolution everywhere — no outer pixel reads a coarser
 *  level. Threaded into the plan, the page table, the atlas and the shadow shader. */
export const REFERENCE_SUN_WINDOW = referenceSunWindow();

/** What the reference mode of an open session draws: the tiles it is drawn in, at which factor,
 *  and every approximation it names. */
export interface ReferenceMode {
  /** Samples per output pixel and axis the tiles reach. */
  factor: number;
  approximations: typeof REFERENCE_APPROXIMATIONS;
  /** The tiles the image is drawn in, each box-filtered and placed in linear light. */
  tiles: ReferenceTilePlan;
}

/** The options a session opens on: `options` itself outside reference mode; in it, every named
 *  approximation off. The reference is drawn at the display, tile by tile (`referenceTiles.ts`),
 *  so the canvas keeps the display's size. */
export function referenceOptions(options: MeasuredWorldOptions): {
  options: MeasuredWorldOptions;
  reference: ReferenceMode | null;
} {
  if (!options.reference) return { options, reference: null };
  // A resize would change the tile plan under the reference: a reference is a still capture of a
  // fixed size, never a live canvas.
  if (options.interactive)
    throw new EngineError(
      'REFERENCE_INTERACTIVE',
      'Reference mode draws a fixed size: open it without `interactive`',
    );
  const tiles = referenceTilePlan(
    options.width ?? DEFAULT_WIDTH,
    options.height ?? DEFAULT_HEIGHT,
    options.pixelRatio ?? DEFAULT_PIXEL_RATIO,
  );
  return {
    options: {
      ...options,
      renderScale: 1,
      temporalAntialiasing: false,
      bounceBudgetMs: REFERENCE_BOUNCE_BUDGET_MS,
    },
    reference: { factor: tiles.factor, approximations: REFERENCE_APPROXIMATIONS, tiles },
  };
}

/**
 * The session's `capture` in reference mode: the drawn frame, refused while the shadow pool runs
 * below its full size. The canvas is at the display — the tiles are drawn aside — so nothing is
 * resolved here. Outside reference mode, `capture` itself.
 */
export function referenceCapture(
  capture: () => Uint8Array,
  reference: ReferenceMode | null,
  shadowBias: () => number | null | undefined,
) {
  if (!reference) return capture;
  return () => {
    const bias = shadowBias();
    if (bias)
      throw new EngineError(
        'REFERENCE_SHADOWS_REDUCED',
        'The shadow pool runs below its full size: no reference image is drawn from it',
        { shadowResolutionBias: bias },
      );
    return capture();
  };
}

export { resolveSupersampled } from './referenceTiles.ts';
