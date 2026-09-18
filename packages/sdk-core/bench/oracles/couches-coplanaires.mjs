// Oracle de `depthLayer.ts`, réécrit d'après le contrat : la couche en unités matérielles, puis le
// biais posé sur les bits d'un f32 de profondeur, plafonné à 1.0f. Les constantes viennent du
// contrat, pour que l'oracle ne dérive pas en silence.
import { DEPTH_LAYER_BIAS_UNITS, MAX_DEPTH_LAYER } from '../../depthLayer.ts';

export function referenceDepthLayerUnits(layer) {
  if (!layer || !Number.isFinite(layer) || layer <= 0) return 0;
  return Math.min(Math.floor(layer), MAX_DEPTH_LAYER) * DEPTH_LAYER_BIAS_UNITS;
}

export function referenceBiasedDepthBits(bits, layer) {
  const units = referenceDepthLayerUnits(layer);
  if (units === 0) return bits >>> 0;
  return Math.min(0x3f800000, (bits >>> 0) + units) >>> 0;
}
