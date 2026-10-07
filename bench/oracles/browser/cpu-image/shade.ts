import { RASTER_BACKGROUND } from '../../../../packages/sdk-browser/src/page/raster.ts'
import { backgroundRgb } from './math.ts'
import { createVisibilityFrame } from './frame.ts'
import { shadePixel } from './shadePixel.ts'
import { type VisPage } from '../../../../packages/sdk-browser/src/visibility/types.ts'
import type { EngineCamera } from '../../../../packages/sdk-browser/src/camera/world.ts'
import { DEFAULT_PIXEL_RATIO } from '../../../../packages/sdk-browser/src/engine/common.ts'
import { type PageLocations } from '../../../../packages/sdk-browser/src/page/selection/placements.ts'

/** Documented visbuffer beauty: MeshBasicMaterial = source color × map (same 8-bit path as rasterPages). MeshStandardMaterial = Cook-Torrance GGX microfacet BRDF with the explorer hemisphere/directional lights. */
export function shadeVisibility(
  ids: Uint32Array,
  pages: VisPage[],
  locations: PageLocations,
  cam: EngineCamera,
  viewport: [number, number],
  background = RASTER_BACKGROUND,
  pixelRatio = DEFAULT_PIXEL_RATIO,
) {
  const [width, height] = viewport,
    pixels = new Uint8Array(width * height * 4)
  const bg = backgroundRgb(background) as [number, number, number]
  const frame = createVisibilityFrame(pages, locations, cam, width, height, pixelRatio)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = y * width + x,
        rgb = shadePixel(frame, ids[o], cam, x, y, bg)
      const p = o * 4
      pixels[p] = rgb[0] ?? bg[0]
      pixels[p + 1] = rgb[1] ?? bg[1]
      pixels[p + 2] = rgb[2] ?? bg[2]
      pixels[p + 3] = 255
    }
  return pixels
}
