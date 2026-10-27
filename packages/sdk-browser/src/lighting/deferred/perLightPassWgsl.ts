/**
 * THE PER-LIGHT DRAW (`shadowOnePassProjection` false): the shadowed local lights, which the batched local
 * pass leaves out (`localPassWgsl` with `skipHeld`), each lit alone over the tiles of the surfaces — the lit image's
 * pass for the tiles of `tileClass` (`tilePass.ts`) with one light, the light of the record the draw
 * binds at a dynamic offset (`perLightRecord.ts`), and its shadow its layer of the screen mask the light's
 * projection filled (`directShadowWgsl`, `pass: 'perLight'`). The light term is `declaredLight`, the batched pass's: only
 * the loop around it, and where the shadow comes from, differ. The pixel's occlusion is the screen's, read as the batched
 * passes read it (`screenOcclusionAt`).
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { lightingBase, type LightingBindings } from '../direct/lightingWgsl.ts'
import { PER_LIGHT_RECORD_WGSL } from '../shadows/vsm/projection/perLightRecord.ts'
import {
  DEFERRED_BINDINGS,
  DEFERRED_LIGHT_FUNCTION_BINDINGS,
  DEFERRED_LIGHT_PROFILE_BINDINGS,
} from './bindings.ts'
import { variantLabel, type ContractKey } from './contractCuts.ts'
import { LIGHTS_BINDING_WGSL, keyOfClass, litPassImports } from './lightPassWgsl.ts'
import { litPixelStatements } from './litSurfaceWgsl.ts'
import { TILE_VERTEX_WGSL } from './tilePass.ts'
import type { TileClass } from './tileClass.ts'

/** The entry of the per-light draw. */
export const PER_LIGHT_ENTRY = 'perLightMain'

/** The light's record, a uniform read at a dynamic offset. */
const RECORD_BINDING_WGSL = wgslBlock(
  'PER_LIGHT_RECORD_BINDING_WGSL',
  [PER_LIGHT_RECORD_WGSL],
  `@group(0) @binding(${DEFERRED_BINDINGS.perLightRecord}) var<uniform> perLight:PerLightRecord;`,
)

/** What the draw binds for its light term: the light functions and profiles; its shadow is its layer of the mask. */
const PER_LIGHT_BINDINGS: LightingBindings = {
  perLightMask: DEFERRED_BINDINGS.perLightMask,
  lightFunction: DEFERRED_LIGHT_FUNCTION_BINDINGS,
  lightProfile: DEFERRED_LIGHT_PROFILE_BINDINGS,
}

/** The one light of the draw, on a pixel: the light term of the batched local loop (`LOCAL_LOOP_WGSL`) for the
 *  light of rank `rank`. */
const PER_LIGHT_LOOP_WGSL = wgslBlock(
  'PER_LIGHT_LOOP_WGSL',
  [],
  `
fn perLightLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,rank:u32)->vec3f{
 let shading=clothSurface(lobeSurface(rgb,metal,rough,N,V));lobeView(shading);
 return declaredLight(rank,rgb,metal,rough,N,V,P,ao,shading);
}`,
)

/**
 * The per-light draw for the tiles of `tileClass`, under the key's cuts: the entry `perLightMain`, which
 * adds the pre-exposed light of the record's light to the pixel.
 */
export function perLightPassWgsl(key: ContractKey, tileClass: TileClass) {
  const lights = keyOfClass(key, tileClass, true)
  const { cut, head, tail } = litPassImports(lights, tileClass)
  return wgslBlock(
    `perLightPassWgsl(${variantLabel(lights)}, ${tileClass})`,
    [
      lightingBase(PER_LIGHT_BINDINGS, lights, {
        narrow: key.narrow,
        environment: false,
        slices: false,
        cut,
        // The light is a local one: the air's tint is the directional lights'.
        airTint: false,
      }),
      ...head,
      LIGHTS_BINDING_WGSL,
      RECORD_BINDING_WGSL,
      TILE_VERTEX_WGSL,
      PER_LIGHT_LOOP_WGSL,
      ...tail,
    ],
    `
@fragment fn ${PER_LIGHT_ENTRY}(@builtin(position) pixel:vec4f)->@location(0) vec4f{${litPixelStatements(cut)}
 vsmMaskAt(coord);
 return lightOut(perLightLighting(albedo,base.a,normal.a,N,V,P,screenOcclusionAt(coord),perLight.rank));
}`,
  )
}
