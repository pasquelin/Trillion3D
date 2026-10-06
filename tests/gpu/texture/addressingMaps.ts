// Defect 8: a material whose six maps do not share one wrap mode, and the addressing nibble each
// map's header carries. The GPU proof (`texture-addressing.gpu.ts`) and the unit test of the
// nibbles (`visibility/wrapModes.test.ts`) both read this material: one thing to read again when
// the modes change.
import { importHostTexture } from '../../../packages/sdk-browser/src/host/textureImport.ts'
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { textureBytes } from './addressingCases.ts'
import {
  SAMPLE_WRAP_SHIFT,
  samplingWords,
} from '../../../packages/sdk-browser/src/texture/sampling.ts'

const CLAMP = G.HOST_WRAP_CLAMP_TO_EDGE,
  REPEAT = G.HOST_WRAP_REPEAT,
  MIRROR = G.HOST_WRAP_MIRRORED_REPEAT

/** The six texture slots a standard surface carries. */
type MapSlot = 'map' | 'roughnessMap' | 'metalnessMap' | 'normalMap' | 'aoMap' | 'emissiveMap'

/**
 * One map per slot, each on its own pair of modes: no pair is shared by two neighbouring maps, so a
 * nibble applied to the wrong map shows at once.
 */
export const MAPS: { name: string; slot: MapSlot; wrapS: number; wrapT: number }[] = [
  { name: 'base', slot: 'map', wrapS: REPEAT, wrapT: REPEAT },
  { name: 'roughness', slot: 'roughnessMap', wrapS: CLAMP, wrapT: MIRROR },
  { name: 'metal', slot: 'metalnessMap', wrapS: MIRROR, wrapT: CLAMP },
  { name: 'normal', slot: 'normalMap', wrapS: CLAMP, wrapT: CLAMP },
  { name: 'occlusion', slot: 'aoMap', wrapS: MIRROR, wrapT: MIRROR },
  { name: 'emissive', slot: 'emissiveMap', wrapS: REPEAT, wrapT: CLAMP },
]

/** The image every map samples: 4×5 distinct texels. */
export const TEXTURE = { width: 4, height: 5, bytes: textureBytes(4, 5) }

/**
 * Coordinates where the three modes part: integers, negatives, large values, and the half-texel of
 * both edges of a period, the seam defect 7 taught the reads to wrap. The fixed axis lands at a
 * texel centre, off the border, so only the probed coordinate decides.
 */
const AXIS = [-1001, -2.375, -0.625, 0.375, 0.625, 1.25, 2.625, 1000.625, 0, 0.02, 0.999, 2.98].map(
  Math.fround,
)
export const UV = AXIS.flatMap((t) => [
  [t, Math.fround(0.3)],
  [Math.fround(0.375), t],
  [t, t],
])

/** The six-map material, each map in its modes, with no image: only the modes are read. */
export function mixedMaterial() {
  const material = G.standardSurface({ alphaTest: 0.5 })
  for (const { slot, wrapS, wrapT } of MAPS)
    material[slot] = Object.assign(new G.GraphTexture(), { wrapS, wrapT })
  return material
}

/** The addressing nibble each map's header carries (`samplingWords`), in `MAPS` order: what the
 *  shader folds that map's coordinate by. */
export function mixedNibbles() {
  const material = mixedMaterial()
  return MAPS.map(
    ({ slot }) =>
      (samplingWords(importHostTexture(material[slot] as G.GraphTexture), false)[0] >>>
        SAMPLE_WRAP_SHIFT) &
      15,
  )
}
