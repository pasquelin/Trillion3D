import type { EngineCamera } from '../../camera/engineCamera.ts'
import { readSetting } from '../../../../sdk-core/src/contracts/settingRules.ts'
import {
  VOLUMETRIC_FOG_RULES,
  volumetricFogKnobs,
} from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import { fogVolumeMedium } from '../../frame/render/encodeFogVolume.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { cellGrid, sliceParams } from '../fog/layout.ts'
import { hizSetting } from '../../visibility/hiz/setting.ts'
import type { HizDepth } from '../../visibility/hiz/gpu/types.ts'

/** The fog cells, across the image and along the depth, a column keeps the lists of past the
 *  surfaces of its pixels: one, as the volume reads a cell's list one cell behind a surface. */
const FOG_MARGIN_CELLS = 1

/** What the view grid's pass cuts by this image: the pyramid it reads (none: it cuts nothing) and
 *  the eight numbers of `TileView.cull` and `TileView.sliceMap` — whether it cuts, the margin in
 *  pixels, the margin in fog cells, the near plane, then the fog's slice map `B, O, S`. */
export type LightGridCull = { depth: HizDepth | undefined; words: Float32Array<ArrayBuffer> }

const cull: LightGridCull = { depth: undefined, words: new Float32Array(8) }

/** The fog volume's margin (`cullWgsl.ts`) into `words`, where the image builds a volume: the
 *  volume's own grid (`cellGrid`) and slice map (`sliceParams`), the numbers it is built with. */
function writeFogMargin(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  cam: EngineCamera,
  words: Float32Array,
) {
  const medium = cam.perspective === 1 ? fogVolumeMedium(rt) : undefined
  const knobs = volumetricFogKnobs(
    readSetting(VOLUMETRIC_FOG_RULES, rt.context, 'volumetricFogQuality'),
  )
  if (!medium || !knobs) return
  const [width, height] = rt.gpu.allocatedSize
  const grid = cellGrid(
    width,
    height,
    knobs.cellSize,
    knobs.sliceCount,
    device.limits?.maxTextureDimension3D,
  )
  const spread = readSetting(VOLUMETRIC_FOG_RULES, rt.context, 'volumetricFogSliceSpread')
  const slices = sliceParams(Math.max(cam.near, medium.startAt), medium.farEnd, spread, grid.z)
  words[1] = FOG_MARGIN_CELLS * grid.pixelSize
  words[2] = FOG_MARGIN_CELLS
  words[3] = cam.near
  words[4] = slices.b
  words[5] = slices.o
  words[6] = slices.s
}

/**
 * THE VIEW GRID'S CULL OF THIS IMAGE: the pyramid of the image's own opaque depth, when the setting
 * `lightGridHizCull` is on, this image built it (`hizPyramidFresh`) and it covers the image's size —
 * else the pass cuts nothing, as the reference's grid without a depth pyramid — and the margin of
 * the fog volume the image builds. Written into one object the next image rewrites.
 */
export function lightGridCull(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  cam: EngineCamera,
): LightGridCull {
  const { words } = cull
  words.fill(0)
  cull.depth = undefined
  const hiz = rt.vis.gpuHiz,
    [width, height] = rt.gpu.targetSize
  if (!hiz || !rt.run.hizPyramidFresh || hiz.width < width || hiz.height < height) return cull
  if (!hizSetting(rt, 'lightGridHizCull')) return cull
  cull.depth = hiz.depth()
  if (!cull.depth) return cull
  words[0] = 1
  writeFogMargin(rt, device, cam, words)
  return cull
}
