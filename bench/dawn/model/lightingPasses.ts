// The lighting's passes of the frame model (`passes.ts`): the surfaces' classification into tiles, the lit
// image's one pass (the first draws, the sun's light, the local lights' and the indirect light) and the fog, each a formula in
// what the frame holds — P pixels drawn, the `cover` share of them a surface's. The bytes are the
// compulsory ones: what a covered pixel's passes read of its surface and of the lit image, and write back;
// the lights' own work (the cell's list a pixel walks, a shadow's mask read past its first word) is
// data-dependent and stays in what a pass takes above its floor. Pure.
import {
  HEIGHT_FOG_PASS,
  SURFACE_COLOUR_PASS,
  TILE_CLASSIFICATION_PASS,
} from '../../../packages/sdk-browser/src/diagnostic/stage/passLabels.ts'
import { passKey } from '../report/summary.ts'
import * as K from './passConstants.ts'

/** What a covered pixel's light pass reads of its surface: its flags, base colour, normal, emission and
 *  occlusion, and depth. */
const SURFACE_READ =
  K.PIXEL_FLAGS + K.PIXEL_BASE + K.PIXEL_NORMAL + K.PIXEL_EMISSION + K.PIXEL_DEPTH
/** A pass that adds to the lit image reads its texel and writes it again. */
const ADDED = 2 * K.HDR_TEXEL

export const LIGHTING_PASSES: K.PassModel[] = [
  {
    label: passKey(TILE_CLASSIFICATION_PASS),
    formula: `P flags read (${K.PIXEL_FLAGS} B), a workgroup a tile of 8 × 8 pixels; 1 dispatch`,
    work: (f) => ({ bytes: K.PIXEL_FLAGS * f.P, texels: f.P, passes: 1 }),
    sources: [K.engine('lighting/deferred/classifyWgsl.ts', 'CLASSIFY_WGSL')],
  },
  {
    label: passKey(SURFACE_COLOUR_PASS),
    formula: `P·(${K.PIXEL_FLAGS} B flags + ${K.HDR_TEXEL} B written) + P·cover·(${K.PIXEL_BASE + K.PIXEL_EMISSION + K.OCCLUSION_BYTES} B base, emission and occlusion read) + the sun's, the local lights' (the cell's list walked above it) and the indirect light's draws, each P·cover·(${SURFACE_READ} B surface + its mask or occlusion and reflection read + ${ADDED} B lit image read and written), over the tiles of each class`,
    work: (f) => ({
      bytes:
        f.P * (K.PIXEL_FLAGS + K.HDR_TEXEL) +
        f.P * f.cover * (K.PIXEL_BASE + K.PIXEL_EMISSION + K.OCCLUSION_BYTES) +
        f.P * f.cover * (SURFACE_READ + K.MASK_BYTES + ADDED) * 2 +
        f.P * f.cover * (SURFACE_READ + K.OCCLUSION_BYTES + K.REFLECTION_BYTES + ADDED),
      fragments: f.P + f.P * f.cover * 3,
      passes: 1,
    }),
    sources: [
      K.engine('lighting/deferred/colourPassWgsl.ts', 'SURFACE_COLOUR_WGSL'),
      K.engine('lighting/deferred/lightPassWgsl.ts', 'sunPassWgsl'),
      K.engine('lighting/deferred/lightPassWgsl.ts', 'localPassWgsl'),
      K.engine('lighting/deferred/indirectPassWgsl.ts', 'indirectPassWgsl'),
    ],
  },
  {
    label: passKey(HEIGHT_FOG_PASS),
    formula: `P·(${K.PIXEL_FLAGS} B flags + ${ADDED} B lit image read and written) + P·cover·${K.PIXEL_DEPTH} B depth`,
    work: (f) => ({
      bytes: f.P * (K.PIXEL_FLAGS + ADDED) + f.P * f.cover * K.PIXEL_DEPTH,
      fragments: f.P,
      passes: 1,
    }),
    sources: [K.engine('lighting/fog/fogPassWgsl.ts', 'heightFogWgsl')],
  },
]
