import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { ContractKey } from '../../lighting/deferred/contractCuts.ts'
import { chainReady } from '../../lighting/deferred/fullscreen.ts'
import { openWaterFrame, waterChain } from './waterFrame.ts'
import {
  encodeColourCopy,
  encodeComposite,
  encodeDepthPrepass,
  encodeRefractionMask,
  encodeSceneDepth,
  encodeShading,
  encodeTileList,
  handOverDepth,
} from './waterPassPhases.ts'

/**
 * THE SINGLE-LAYER WATER'S PASSES, after the opaque scene is lit and before any translucent layer is
 * drawn over it (`encodeBlend`), in the order the water has:
 *  1. the water's depth (`WATER_DEPTH_PASS`, with `singleLayerWaterDepthPrepass`): the scene's depth
 *     copied, the water drawn into the copy; without it the shading writes the scene's depth itself;
 *  2. the scene without the water: its linear depth, at `singleLayerWaterRefractionDownsample`
 *     (`WATER_COPY_PASS`);
 *  3. the tiles that hold water (`WATER_TILES_PASS`), when the composite or the colour copy is tiled
 *     (`singleLayerWaterTiledComposite`, `singleLayerWaterTiledSceneColorCopy`): marked, then listed,
 *     with subgroup operations where `singleLayerWaterWaveOps` and the device allow;
 *  4. the scene's colour (`WATER_COPY_PASS`): over the target, or the listed tiles alone where the
 *     refraction mask limits what is read, undownsampled;
 *  5. the mask of the refraction (`WATER_MASK_PASS`) where a culling asks for it;
 *  6. the water shaded over the scene (`WATER_PASS`, `fsWater`): volume, lights and fog, no blend, its
 *     surface written beside;
 *  7. the reflection composite (`WATER_COMPOSITE_PASS`, `fsWaterComposite`): the reflection of that
 *     surface added over the water, over the target or the listed tiles, unless the water reflects nothing;
 *  8. the water's depth is the scene's from here on, so that every layer drawn after is hidden by it.
 * Returns the draws encoded.
 */
export function encodeWater(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  key?: Partial<ContractKey>,
) {
  const frame = openWaterFrame(rt, device, encoder, key)
  // One chain: each pass reads what the one before wrote (the depths, the tiles, the copies, the
  // shaded surface), so none is encoded while a program of the chain compiles.
  if (!frame || !chainReady(...waterChain(frame))) return 0
  const drawn =
    encodeDepthPrepass(frame) +
    encodeSceneDepth(frame) +
    encodeTileList(frame) +
    encodeColourCopy(frame) +
    encodeRefractionMask(frame) +
    encodeShading(frame) +
    encodeComposite(frame)
  handOverDepth(frame)
  return drawn
}
