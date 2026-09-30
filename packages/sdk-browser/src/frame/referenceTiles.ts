import { EngineError } from '../../../sdk-core/src/index.ts';
import { linearToSrgb8, srgbToLinear } from '../../../sdk-core/src/math/primitives/color.ts';
import type { ViewTile } from '../camera/engineCamera.ts';
import { devicePixels } from '../backend/common.ts';

/**
 * THE TILED SUPERSAMPLING OF THE REFERENCE (#1281). A frame drawn at `factor` samples per output
 * pixel and axis needs a target `factor` times the display on each side; the portable
 * `maxTextureDimension2D` (8192) caps that at 2 at the boss's case. The reference is therefore
 * drawn TILE by TILE — each tile's supersampled target fits the 8192 side — and every tile is
 * box-filtered and placed in linear light into the full display image. One renderer: the tiles
 * are the engine's own capture of the same camera, its projection scaled and shifted per tile
 * (`../camera/engineCamera.ts::ViewTile`).
 */
/** WebGPU's portable `maxTextureDimension2D`: the side every device grants a target. */
export const PORTABLE_TEXTURE_SIDE = 8192;
/** Samples per output pixel and axis the reference draws: heavy, never the canvas's few. */
const REFERENCE_TILE_FACTOR = 8;
/** Most tiles one reference image is drawn in: a cap on the work, not on the factor. */
export const REFERENCE_MAX_TILES = 64;

/** One tile of the reference: where its pixels land in the output, and how the camera's
 *  projection is scaled and shifted to draw it (`ViewTile`). */
export interface ReferenceTile extends ViewTile {
  /** Output pixel origin of the tile, bottom row first. */
  x: number;
  y: number;
  /** Output pixels the tile covers. */
  width: number;
  height: number;
}

/** The tiles an output `width × height` is drawn in, at `factor` samples per pixel and axis. */
export interface ReferenceTilePlan {
  factor: number;
  width: number;
  height: number;
  tiles: ReferenceTile[];
}

/**
 * The plan of the reference for a `width × height` CSS display at `pixelRatio`: the largest
 * `factor` up to the asked one at which each tile's supersampled target fits the portable side
 * and the whole image is at most `maxTiles` tiles. Every output pixel lies in exactly one tile.
 */
export function referenceTilePlan(
  width: number,
  height: number,
  pixelRatio: number,
  factor = REFERENCE_TILE_FACTOR,
  maxTiles = REFERENCE_MAX_TILES,
): ReferenceTilePlan {
  const outW = Math.max(1, devicePixels(width, pixelRatio)),
    outH = Math.max(1, devicePixels(height, pixelRatio));
  let samples = Math.max(1, Math.floor(factor)),
    cols: number,
    rows: number;
  for (;;) {
    // A tile no wider or taller than `side` output pixels has a supersampled target no larger
    // than `side · samples`, which the choice of `side` keeps within the portable side.
    const side = Math.max(1, Math.floor(PORTABLE_TEXTURE_SIDE / samples));
    cols = Math.max(1, Math.ceil(outW / side));
    rows = Math.max(1, Math.ceil(outH / side));
    if (cols * rows <= maxTiles || samples === 1) break;
    samples--;
  }
  const tiles: ReferenceTile[] = [];
  for (let j = 0; j < rows; j++) {
    const y0 = Math.floor((j * outH) / rows),
      y1 = Math.floor(((j + 1) * outH) / rows);
    for (let i = 0; i < cols; i++) {
      const x0 = Math.floor((i * outW) / cols),
        x1 = Math.floor(((i + 1) * outW) / cols);
      const w = x1 - x0,
        h = y1 - y0;
      // A perspective frustum's angular scale is isotropic: the tile's pixels are the full
      // view's over `s`, on both axes. The base projection is composed at the TARGET's shape,
      // so its x scale carries the tile's aspect; `scaleX` brings it back to the full one.
      const s = outH / h;
      const centerX = (x0 + x1) / outW - 1,
        centerY = (y0 + y1) / outH - 1;
      tiles.push({
        x: x0,
        y: y0,
        width: w,
        height: h,
        scaleX: s,
        scaleY: s,
        offsetX: (outW / w) * centerX,
        offsetY: s * centerY,
      });
    }
  }
  return { factor: samples, width: outW, height: outH, tiles };
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

/** Places a tile's resolved `width` × `height` pixels into `out`, a `imageWidth`-wide RGBA image
 *  bottom row first. */
export function placeTile(
  out: Uint8Array,
  imageWidth: number,
  tile: ReferenceTile,
  resolved: Uint8Array,
) {
  const stride = tile.width * 4;
  for (let row = 0; row < tile.height; row++)
    out.set(
      resolved.subarray(row * stride, (row + 1) * stride),
      ((tile.y + row) * imageWidth + tile.x) * 4,
    );
}

/** Refuses a reference drawn from a shadow pool the device shrank (`shadowResolutionBias` above
 *  0): such an image never passes for the reference. */
export function assertFullShadowPool(bias: number | null | undefined) {
  if (bias)
    throw new EngineError(
      'REFERENCE_SHADOWS_REDUCED',
      'The shadow pool runs below its full size: no reference image is drawn from it',
      { shadowResolutionBias: bias },
    );
}

/**
 * The reference image drawn by the engine's own captures: one `captureView` per tile, the camera
 * carrying the tile's projection, each result box-filtered and placed in linear light. Refused
 * while the shadow pool runs below its full size (`assertFullShadowPool`).
 */
export function referenceTilesCapture(
  captureView: (width: number, height: number) => Promise<Uint8Array>,
  setTile: (tile: ViewTile | null) => void,
  plan: ReferenceTilePlan,
  shadowBias: () => number | null | undefined,
) {
  return async () => {
    assertFullShadowPool(shadowBias());
    const out = new Uint8Array(plan.width * plan.height * 4);
    for (const tile of plan.tiles) {
      const target = tile.width * plan.factor;
      setTile(tile);
      let rgba: Uint8Array;
      try {
        rgba = await captureView(target, tile.height * plan.factor);
      } finally {
        setTile(null);
      }
      const filtered = resolveSupersampled(rgba, target, tile.height * plan.factor, plan.factor);
      placeTile(out, plan.width, tile, filtered);
    }
    return out;
  };
}
