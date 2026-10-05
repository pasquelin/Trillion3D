import type { RasterView } from '../../../../packages/sdk-browser/src/webgpu/pages/runtime.ts';
import { shadeVisibility } from './shade.ts';
import { rasterVisibilityIds } from './raster.ts';

/** The visibility identifiers the CPU raster draws of the pages the WebGPU backend drew last. */
export const backendVisibilityIds = (v: RasterView) =>
  rasterVisibilityIds(v.pages, v.locations, v.cam, v.size, v.pixelRatio);

/** The CPU image of those pages: the oracle the GPU image is compared to. */
export const backendRasterRgba = (v: RasterView) =>
  shadeVisibility(
    backendVisibilityIds(v),
    v.pages,
    v.locations,
    v.cam,
    v.size,
    v.clearColor,
    v.pixelRatio,
  );
