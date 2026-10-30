/**
 * THE PER-LIGHT DRAW (`shadowOnePassProjection` false, its shadow its layer of the mask; with the one-pass projection, the draw is the local
 * lights' pass for one light, `localPassWgsl`): the shadowed local lights, which the batched local
 * pass leaves out (`localPassWgsl` with the loop `unbatched`), each lit alone over the tiles of the surfaces — the lit image's
 * pass for the tiles of `tileClass` (`tilePass.ts`) with one light, the light of the record the draw
 * binds at a dynamic offset (`perLightRecord.ts`), and its shadow its layer of the screen mask the light's
 * projection filled (`directShadowWgsl`, `pass: 'perLight'`). The light term is `declaredLight`, the batched pass's: only
 * the loop around it, and where the shadow comes from, differ. The pixel's occlusion is the screen's, read as the batched
 * passes read it (`screenOcclusionAt`).
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { DECLARED_TERM_TEXT, SHADING_TEXT } from '../direct/lightLoopWgsl.ts'
import { lightingBase, type LightingBindings } from '../direct/lightingWgsl.ts'
import {
  DEFERRED_BINDINGS,
  DEFERRED_LIGHT_FUNCTION_BINDINGS,
  DEFERRED_LIGHT_PROFILE_BINDINGS,
  DEFERRED_TOON_TABLES,
} from './bindings.ts'
import { variantLabel, type ContractKey } from './contractCuts.ts'
import {
  LIGHTS_BINDING_WGSL,
  TOON_DATA_OUT_WGSL,
  resultFrom,
  resultOf,
  PER_LIGHT_RECORD_BINDING_WGSL,
  keyOfClass,
  litPassImports,
  withContactBend,
  withVolumeShadow,
} from './lightPassWgsl.ts'
import { closureTail, litPixelStatements } from './litSurfaceWgsl.ts'
import { TILE_VERTEX_WGSL } from './tilePass.ts'
import type { TileClass } from './tileClass.ts'

/** The entry of the per-light draw. */
export const PER_LIGHT_ENTRY = 'perLightMain'

/** What the draw binds for its light term: the light functions and profiles; its shadow is its layer of the mask. */
const PER_LIGHT_BINDINGS: LightingBindings = {
  perLightMask: DEFERRED_BINDINGS.perLightMask,
  lightFunction: DEFERRED_LIGHT_FUNCTION_BINDINGS,
  lightProfile: DEFERRED_LIGHT_PROFILE_BINDINGS,
  toon: DEFERRED_TOON_TABLES,
}

/** The one light of the draw, on a pixel: the light term of the batched local loop (`LOCAL_LOOP_WGSL`) for the
 *  light of rank `rank`. */
const PER_LIGHT_LOOP_WGSL = wgslBlock(
  'PER_LIGHT_LOOP_WGSL',
  [],
  `
fn perLightLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,rank:u32)->vec3f{
 ${SHADING_TEXT()}
 return ${DECLARED_TERM_TEXT()};
}`,
)

/**
 * The per-light draw for the tiles of `tileClass`, under the key's cuts: the entry `perLightMain`, which
 * adds the pre-exposed light of the record's light to the pixel.
 */
export function perLightPassWgsl(key: ContractKey, tileClass: TileClass) {
  const lights = keyOfClass(key, tileClass, true)
  const { cut, head, tail } = litPassImports(lights, tileClass)
  const data = !!cut.toonData
  return wgslBlock(
    `perLightPassWgsl(${variantLabel(lights)}, ${tileClass})`,
    [
      lightingBase(withVolumeShadow(withContactBend(PER_LIGHT_BINDINGS, lights), lights), lights, {
        narrow: key.narrow,
        environment: false,
        slices: false,
        cut,
        // The light is a local one: the air's tint is the directional lights'.
        airTint: false,
      }),
      ...head,
      LIGHTS_BINDING_WGSL,
      PER_LIGHT_RECORD_BINDING_WGSL,
      TILE_VERTEX_WGSL,
      PER_LIGHT_LOOP_WGSL,
      ...tail,
      ...(data ? [TOON_DATA_OUT_WGSL] : []),
    ],
    `
@fragment fn ${PER_LIGHT_ENTRY}(@builtin(position) pixel:vec4f)->${resultOf(data)}{${litPixelStatements(cut)}
 vsmMaskAt(coord);${closureTail(
   cut,
   'lightOut(perLightLighting(albedo,base.a,normal.a,N,V,P,screenOcclusionAt(coord),perLight.rank))',
   (light) => `\n return ${resultFrom(data, light)};`,
 )}
}`,
  )
}
