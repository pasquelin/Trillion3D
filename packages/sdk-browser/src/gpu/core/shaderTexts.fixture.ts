// The engine's shader texts as it builds them by default, one copy for every test: the passes that light an
// image (`litPassShaders`) — wide, direct and with bounce —, the TAA resolve, the blend and its
// transmissive stages.
import { FULL_CONTRACT, type ContractKey } from '../../lighting/deferred/contractCuts.ts'
import { SURFACE_COLOUR_WGSL, UNLIT_SURFACE_WGSL } from '../../lighting/deferred/colourPassWgsl.ts'
import { indirectPassWgsl } from '../../lighting/deferred/indirectPassWgsl.ts'
import { localPassWgsl, sunPassWgsl } from '../../lighting/deferred/lightPassWgsl.ts'
import { TILE_CLASS } from '../../lighting/deferred/tileClass.ts'
import { heightFogWgsl } from '../../lighting/fog/fogPassWgsl.ts'
import { taaResolveShader } from '../../post/taa/resolveWgsl.ts'
import { blendShader } from '../../blend/shader.ts'
import { transmitWgsl } from '../../blend/transmission/transmitWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'

/** The texts of the passes that light an image, as their pipelines compile them: the lit image's first
 *  pass, the sun's, the local lights' and the indirect light's over the tiles of the class that holds
 *  the most code the key leaves in (the lobed one unless the key says no lobe), and the fog pass. A key's missing cut
 *  is code kept; `skyShadowing`, the indirect pass's program that applies the sky light's distance-field
 *  occlusion. */
export function litPassShaders(
  bounce: boolean,
  key: Partial<ContractKey> = { lobeless: true },
  skyShadowing = false,
) {
  const full = { ...FULL_CONTRACT, ...key }
  const tileClass = full.lobeless ? TILE_CLASS.single : TILE_CLASS.complex
  return {
    colour: wgslModule(SURFACE_COLOUR_WGSL),
    sun: wgslModule(sunPassWgsl(full, tileClass)),
    local: wgslModule(localPassWgsl(full, tileClass)),
    indirect: wgslModule(indirectPassWgsl({ bounce, skyShadowing, tileClass })),
    fog: wgslModule(heightFogWgsl(true)),
  }
}

/** The passes' texts at a key (`litPassShaders`) in one text: what one reads for a name or a law the
 *  lighting holds, wherever it holds it. */
export const contractLightingShader = (
  bounce: boolean,
  key: Partial<ContractKey> = { lobeless: true },
  skyShadowing = false,
) => Object.values(litPassShaders(bounce, key, skyShadowing)).join('\n')
export const UNLIT_LIGHTING_SHADER = wgslModule(UNLIT_SURFACE_WGSL)
export const DIRECT_LIGHTING_SHADER = contractLightingShader(false)
export const BOUNCE_LIGHTING_SHADER = contractLightingShader(true)
export const TAA_SHADER = taaResolveShader()
export const BLEND_SHADER = blendShader()
export const TRANSMIT_SHADER = blendShader({}, { stage: transmitWgsl({}, false) })
