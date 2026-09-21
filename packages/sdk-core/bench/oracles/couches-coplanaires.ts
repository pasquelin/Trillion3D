// Oracle of `depthLayer.ts`, rewritten according to the contract: layer in hardware units, then the
// depth bias applied on f32 depth bits, clamped to 1.0f. Constants come from the
// contract so that the oracle does not silently drift.
import { DEPTH_LAYER_BIAS_UNITS, MAX_DEPTH_LAYER } from '../../depthLayer.ts';

export function referenceDepthLayerUnits(layer: number | undefined) {
  if (!layer || !Number.isFinite(layer) || layer <= 0) return 0;
  return Math.min(Math.floor(layer), MAX_DEPTH_LAYER) * DEPTH_LAYER_BIAS_UNITS;
}

export function referenceBiasedDepthBits(bits: number, layer: number | undefined) {
  const units = referenceDepthLayerUnits(layer);
  if (units === 0) return bits >>> 0;
  return Math.min(0x3f800000, (bits >>> 0) + units) >>> 0;
}
