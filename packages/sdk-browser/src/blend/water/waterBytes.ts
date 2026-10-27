import { texelBytesOf } from '../../gpu/core/textureBytes.ts'
import { DEPTH_FORMAT, HDR_FORMAT } from '../../scene/targetFormats.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { readSingleLayerWaterSetting } from '../../../../sdk-core/src/contracts/singleLayerWaterOptions.ts'
import { waterSeparates, waterWanted } from './waterTargets.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import {
  WATER_NORMALS_FORMAT,
  WATER_PARAMS_WORDS,
  WATER_SPECULAR_FORMAT,
  WATER_TILE_PIXELS,
} from './waterLayout.ts'
import { WATER_DEPTH_FORMAT, WATER_MASK_FORMAT, WATER_SUN_FORMAT } from './waterSceneStages.ts'

/**
 * WHAT THE SINGLE-LAYER WATER'S TARGETS COST (`WaterTargets`), counted with the frame's extras
 * (`frameExtraBytes`) where the plan holds a water the settings draw: the copy of the scene's colour and
 * depth at `1 / singleLayerWaterRefractionDownsample` of the render size, the water's depth, the
 * refraction mask, the water's surface (normal and reflectance), the separated sun where the programs keep it, the tile mask, list and arguments, and
 * the uniform. Zero without water.
 */
export function waterBytes(rt: WebgpuPagesRuntime, width: number, height: number) {
  if (!waterWanted(rt)) return 0
  const factor = readSingleLayerWaterSetting(rt, 'singleLayerWaterRefractionDownsample')
  const copy = ceilDiv(width, factor) * ceilDiv(height, factor),
    full = width * height,
    tiles = ceilDiv(width, WATER_TILE_PIXELS) * ceilDiv(height, WATER_TILE_PIXELS)
  const texel = (format: GPUTextureFormat) => texelBytesOf(format)!
  return (
    copy * (texel(HDR_FORMAT) + texel(WATER_DEPTH_FORMAT)) +
    full *
      (texel(DEPTH_FORMAT) +
        texel(WATER_MASK_FORMAT) +
        texel(WATER_NORMALS_FORMAT) +
        texel(WATER_SPECULAR_FORMAT) +
        (waterSeparates(rt) ? texel(WATER_SUN_FORMAT) : 0)) +
    ceilDiv(tiles, 32) * 4 +
    tiles * 4 +
    16 +
    WATER_PARAMS_WORDS * 4
  )
}
