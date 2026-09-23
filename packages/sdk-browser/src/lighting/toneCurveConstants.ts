/**
 * The display curves' constants (`toneMappingWgsl.ts`, `../webgl/core/outputGlsl.ts`), once for both
 * languages: the matrices as numbers, column after column, and the expressions whose text both
 * languages read alike as text. Each is the published operator's.
 */
import { glslMatrix3, shaderFloat, wgslMatrix3 } from './shaderConstants.ts';

const both = (m: readonly number[]) => ({ wgsl: wgslMatrix3(m), glsl: glslMatrix3(m) });

/** ACES, the reference's filmic fit: its exposure scale, its two colour matrices around the
 *  rational fit of `c`. */
export const ACES = {
  exposure: shaderFloat(0.6),
  input: both([0.59719, 0.076, 0.0284, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777]),
  output: both([
    1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602,
  ]),
  numerator: 'c*(c+0.0245786)-0.000090537',
  denominator: 'c*(0.983729*c+0.4329510)+0.238081',
};

/** Sobotka's AgX: to the BT.2020 primaries and back, the inset and outset, the log2 range in EV
 *  and the sixth-degree contrast fit over `c`, `c2 = c²`, `c4 = c⁴`. */
export const AGX = {
  toWide: both([0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.088, 0.0433, 0.0113, 0.8956]),
  toNarrow: both([1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187]),
  inset: both([
    0.856627153315983, 0.137318972929847, 0.11189821299995, 0.0951212405381588, 0.761241990602591,
    0.0767994186031903, 0.0482516061458583, 0.101439036467562, 0.811302368396859,
  ]),
  outset: both([
    1.1271005818144368, -0.1413297634984383, -0.14132976349843826, -0.11060664309660323,
    1.157823702216272, -0.11060664309660294, -0.016493938717834573, -0.016493938717834257,
    1.2519364065950405,
  ]),
  low: -12.47393,
  high: 4.026069,
  contrast: '15.5*c4*c2-40.14*c4*c+31.96*c4-6.868*c2*c+0.4298*c2+0.1191*c-0.00232',
};

/** Hejl and Burgess-Dawson's filmic fit of `x = max(0, c − 0.004)`, display gamma included. */
export const CINEON = {
  offset: shaderFloat(0.004),
  curve: '(x*(6.2*x+0.5))/(x*(6.2*x+1.7)+0.06)',
};

/** The Khronos PBR Neutral operator: its toe below 0.08, its knee at 0.76, its shoulder. */
export const NEUTRAL = {
  toe: 'low<0.08',
  toeOffset: 'low-6.25*low*low',
  offset: shaderFloat(0.04),
  knee: shaderFloat(0.76),
  top: '1.0-0.0576/(peak-0.52)',
  blend: '1.0-1.0/(0.15*(peak-top)+1.0)',
};
