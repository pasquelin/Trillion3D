import { EngineError } from '../../../sdk-core/src/index.ts';
import { linearToSrgb8, srgbToLinear } from '../../../sdk-core/src/math/primitives/color.ts';
import {
  DEFAULT_HEIGHT,
  DEFAULT_PIXEL_RATIO,
  DEFAULT_WIDTH,
  devicePixels,
} from '../backend/common.ts';
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
 * - `supersampling`: the frame drawn at `supersampling` times the display's pixels per axis, the
 *   most the portable texture side holds, and box-filtered back to the display in linear light.
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

/** Most samples per display pixel and axis the reference draws. */
const REFERENCE_MAX_SUPERSAMPLING = 4;
/** The bounce target of the reference, in milliseconds: far past any frame, so the budget never
 *  lowers the probes traced below their per-frame ceiling (`createBounceBudget`). */
export const REFERENCE_BOUNCE_BUDGET_MS = 1000;
/** WebGPU's portable `maxTextureDimension2D`: the side every device grants a target. */
const PORTABLE_TEXTURE_SIDE = 8192;

/** What the reference mode of an open session drew: its samples per display pixel and axis. */
export interface ReferenceMode {
  supersampling: number;
  approximations: typeof REFERENCE_APPROXIMATIONS;
}

/** Samples per display pixel and axis for a display of `width` × `height` CSS pixels at
 *  `pixelRatio`: the most, up to `REFERENCE_MAX_SUPERSAMPLING`, whose frame fits the portable
 *  texture side; 1 when the display alone fills it. */
export function referenceSupersampling(width: number, height: number, pixelRatio: number) {
  const side = Math.max(devicePixels(width, pixelRatio), devicePixels(height, pixelRatio));
  return Math.max(
    1,
    Math.min(REFERENCE_MAX_SUPERSAMPLING, Math.floor(PORTABLE_TEXTURE_SIDE / side)),
  );
}

/** The options a session opens on: `options` itself outside reference mode; in it, every named
 *  approximation off and the pixel ratio raised by the supersampling. */
export function referenceOptions(options: MeasuredWorldOptions): {
  options: MeasuredWorldOptions;
  reference: ReferenceMode | null;
} {
  if (!options.reference) return { options, reference: null };
  // A resize would set the host's pixel ratio back under the supersampling: a reference is a
  // still capture of a fixed size, never a live canvas.
  if (options.interactive)
    throw new EngineError(
      'REFERENCE_INTERACTIVE',
      'Reference mode draws a fixed size: open it without `interactive`',
    );
  const pixelRatio = options.pixelRatio ?? DEFAULT_PIXEL_RATIO;
  const supersampling = referenceSupersampling(
    options.width ?? DEFAULT_WIDTH,
    options.height ?? DEFAULT_HEIGHT,
    pixelRatio,
  );
  return {
    options: {
      ...options,
      renderScale: 1,
      temporalAntialiasing: false,
      bounceBudgetMs: REFERENCE_BOUNCE_BUDGET_MS,
      pixelRatio: pixelRatio * supersampling,
    },
    reference: { supersampling, approximations: REFERENCE_APPROXIMATIONS },
  };
}

/** sRGB byte to linear light, once for the 256 values. */
const LINEAR = Float32Array.from({ length: 256 }, (_, byte) => srgbToLinear(byte / 255));

/**
 * The RGBA image `rgba` of `width` × `height`, box-filtered `factor` times per axis: each output
 * pixel is the mean of its `factor`² samples, colour in linear light and re-encoded to sRGB, alpha
 * as is. Rows keep their order (bottom first in, bottom first out); a remainder past a whole
 * block is left out.
 */
export function resolveSupersampled(
  rgba: Uint8Array,
  width: number,
  height: number,
  factor: number,
) {
  if (factor === 1) return rgba;
  const w = Math.floor(width / factor),
    h = Math.floor(height / factor),
    samples = factor * factor;
  const out = new Uint8Array(w * h * 4);
  const sum = new Float64Array(4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      sum.fill(0);
      for (let dy = 0; dy < factor; dy++)
        for (let dx = 0; dx < factor; dx++) {
          const i = ((y * factor + dy) * width + x * factor + dx) * 4;
          sum[0] += LINEAR[rgba[i]];
          sum[1] += LINEAR[rgba[i + 1]];
          sum[2] += LINEAR[rgba[i + 2]];
          sum[3] += rgba[i + 3];
        }
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) out[o + c] = linearToSrgb8(sum[c] / samples);
      out[o + 3] = Math.round(sum[3] / samples);
    }
  return out;
}

/**
 * The session's `capture` in reference mode: the drawn frame resolved to the display, refused
 * while the shadow pool runs below its full size. Outside reference mode, `capture` itself.
 */
export function referenceCapture(
  capture: () => Uint8Array,
  canvas: { width: number; height: number },
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
    return resolveSupersampled(capture(), canvas.width, canvas.height, reference.supersampling);
  };
}
