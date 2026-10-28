import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { ContractKey } from '../../lighting/deferred/contractCuts.ts'
import { chainReady } from '../../lighting/deferred/fullscreen.ts'
import { openWaterFrame, waterChain } from './waterFrame.ts'
import { waterDepthMarked } from './waterTargets.ts'
import {
  encodeColourCopy,
  encodeComposite,
  encodeFogBehindWater,
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
 *     copied, the water drawn into the copy — before the lights where the sun's shadow pages are
 *     marked at the water's surface (`encodeWaterDepth`); without it the shading writes the scene's
 *     depth itself;
 *  2. the scene without the water: its linear depth, at `singleLayerWaterRefractionDownsample`
 *     (`WATER_COPY_PASS`);
 *  3. the tiles that hold water (`WATER_TILES_PASS`), when the composite or the colour copy is tiled
 *     (`singleLayerWaterTiledComposite`, `singleLayerWaterTiledSceneColorCopy`): marked, then listed,
 *     with subgroup operations where `singleLayerWaterWaveOps` and the device allow;
 *  4. the scene's colour (`WATER_COPY_PASS`): over the target, or the listed tiles alone where the
 *     refraction mask limits what is read, undownsampled;
 *  4b. the height fog on that copy (`encodeFogBehindWater`, `singleLayerWaterUnderwaterFogWhenCameraIsAboveWater`, off by default);
 *  5. the mask of the refraction (`WATER_MASK_PASS`) where a culling asks for it;
 *  6. the water shaded over the scene (`WATER_PASS`, `fsWater`): volume and lights, no blend, its
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
    (waterDepthMarked(rt) ? 0 : encodeDepthPrepass(frame)) +
    encodeSceneDepth(frame) +
    encodeTileList(frame) +
    encodeColourCopy(frame) +
    encodeFogBehindWater(frame) +
    encodeRefractionMask(frame) +
    encodeShading(frame) +
    encodeComposite(frame)
  handOverDepth(frame)
  return drawn
}

/**
 * The water's depth pass (step 1 of `encodeWater`) drawn ahead of the image's lights, for the marking of
 * the sun's shadow pages (`waterDepthMarked`); `encodeWater` then goes on from it, the pass not drawn again.
 * Nothing where the image draws no water, draws it without the depth pass, or lacks a program of its
 * chain. Returns the draws encoded.
 */
export function encodeWaterDepth(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  key?: Partial<ContractKey>,
) {
  const frame = openWaterFrame(rt, device, encoder, key)
  if (!frame?.prepass || !chainReady(...waterChain(frame))) return 0
  frame.targets.depthAheadFor = rt.run.frame
  return encodeDepthPrepass(frame)
}
