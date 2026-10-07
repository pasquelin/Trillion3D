import { EngineError } from '../../../sdk-core/src/index.ts'
import type { ViewTile } from '../camera/engineCamera.ts'
import { devicePixels } from '../engine/common.ts'
import { GUARANTEED_SIDE } from '../gpu/core/textureLimits.ts'
import {
  type ReferenceTile,
  resolveSupersampled,
  placeTile,
  REFERENCE_MAX_TILES,
} from './referenceTilePlacement.ts'

/**
 * THE TILED SUPERSAMPLING OF THE REFERENCE. A frame drawn at `factor` samples per output
 * pixel and axis needs a target `factor` times the display on each side; the portable
 * `maxTextureDimension2D` (8192) caps that at 2 on a large display. The reference is therefore
 * drawn TILE by TILE — each tile's supersampled target fits the 8192 side — and every tile is
 * box-filtered and placed in linear light into the full display image. The tiles are the engine's
 * own capture of the same camera, its projection scaled and shifted per tile
 * (`../camera/engineCamera.ts::ViewTile`).
 */

/** Samples per output pixel and axis the reference draws: heavy, never the canvas's few. */
const REFERENCE_TILE_FACTOR = 8

/** The tiles an output `width × height` is drawn in, at `factor` samples per pixel and axis. */
export interface ReferenceTilePlan {
  factor: number
  width: number
  height: number
  tiles: ReferenceTile[]
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
    outH = Math.max(1, devicePixels(height, pixelRatio))
  let samples = Math.max(1, Math.floor(factor)),
    cols: number,
    rows: number
  for (;;) {
    // A tile no wider or taller than `side` output pixels has a supersampled target no larger
    // than `side · samples`, which the choice of `side` keeps within the portable side.
    const side = Math.max(1, Math.floor(GUARANTEED_SIDE / samples))
    cols = Math.max(1, Math.ceil(outW / side))
    rows = Math.max(1, Math.ceil(outH / side))
    if (cols * rows <= maxTiles || samples === 1) break
    samples--
  }
  const tiles: ReferenceTile[] = []
  for (let j = 0; j < rows; j++) {
    const y0 = Math.floor((j * outH) / rows),
      y1 = Math.floor(((j + 1) * outH) / rows)
    for (let i = 0; i < cols; i++) {
      const x0 = Math.floor((i * outW) / cols),
        x1 = Math.floor(((i + 1) * outW) / cols)
      const w = x1 - x0,
        h = y1 - y0
      // A perspective frustum's angular scale is isotropic: the tile's pixels are the full
      // view's over `s`, on both axes. The base projection is composed at the TARGET's shape,
      // so its x scale carries the tile's aspect; `scaleX` brings it back to the full one.
      const s = outH / h
      const centerX = (x0 + x1) / outW - 1,
        centerY = (y0 + y1) / outH - 1
      tiles.push({
        x: x0,
        y: y0,
        width: w,
        height: h,
        scaleX: s,
        scaleY: s,
        offsetX: (outW / w) * centerX,
        offsetY: s * centerY,
      })
    }
  }
  return { factor: samples, width: outW, height: outH, tiles }
}

/** Refuses a reference whose shadows draw coarser than they ask because of their page pool
 *  (`shadowResolutionBias` above 0, `vsmStats.ts`): a pool the GPU budget shrank, or a full one
 *  whose fill raised the maps' resolution bias. Such an image never passes for the reference.
 *  Null — no shadow map ran — and 0 pass. */
export function assertFullShadowPool(bias: number | null | undefined) {
  if (bias)
    throw new EngineError(
      'REFERENCE_SHADOWS_REDUCED',
      'The shadows draw coarser than asked, their page pool short: no reference is drawn',
      { shadowResolutionBias: bias },
    )
}

/**
 * The reference image drawn by the engine's own captures: one `captureView` per tile, the camera
 * carrying the tile's projection, each result box-filtered and placed in linear light. Refused
 * while the shadows draw coarser than they ask, their page pool short (`assertFullShadowPool`).
 */
export function referenceTilesCapture(
  captureView: (width: number, height: number) => Promise<Uint8Array>,
  setTile: (tile: ViewTile | null) => void,
  plan: ReferenceTilePlan,
  shadowBias: () => number | null | undefined,
) {
  return async () => {
    assertFullShadowPool(shadowBias())
    const out = new Uint8Array(plan.width * plan.height * 4)
    for (const tile of plan.tiles) {
      const target = tile.width * plan.factor
      setTile(tile)
      let rgba: Uint8Array
      try {
        rgba = await captureView(target, tile.height * plan.factor)
      } finally {
        setTile(null)
      }
      const filtered = resolveSupersampled(rgba, target, tile.height * plan.factor, plan.factor)
      placeTile(out, plan.width, tile, filtered)
    }
    return out
  }
}
