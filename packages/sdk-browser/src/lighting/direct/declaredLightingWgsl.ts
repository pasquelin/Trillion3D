import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { LOBELESS_KEY, type ContractKey, variantLabel } from '../deferred/contractCuts.ts'
import { bindingsLabel, lightingBase, type LightingBindings } from './lightingWgsl.ts'

/**
 * Declared lights that light a blend surface, taken from the list of the cell its own depth `z`
 * falls in (#1369): a blend surface drawn in front of its pixel's opaque, or against the sky,
 * finds the lights of the cell it stands in, never those of the opaque behind it.
 *
 * The loop stays **exact**, and its sum is that of the loop over every light, bit for bit:
 * a light absent from the list meets no point of the cell, so `declaredLight` would have returned
 * exactly `vec3f(0.0)`, and removing a zero from a float sum does not change it. What changes is
 * the number of lights walked, hence the number of shadow-atlas reads.
 *
 * With no list — a device that could not fit the grid pass, or a pixel past the grid —, the loop
 * falls back on the declared lights, every one of them.
 *
 * With `pair`, `declaredLightingPair`: the two sums of one walk, on the surface and on a null
 * albedo (`declaredLightWgsl`), each that of its own walk bit for bit — the water lights its pixel
 * once for its colour and its specular.
 *
 * `key` (`LOBELESS_KEY` unless given) as the opaque resolve's, its `narrow` aside: `unshadowed`,
 * the loop of a scene no light of which holds a shadow slot; `rectless`, of a scene that holds no
 * rectangle light (`declaredLightWgsl`, #1249, #1369), picked on the same key
 * (`createLitVariants`). Without `lobeless`, the forward pass's program of a scene that holds an
 * anisotropic or clear-coat surface: its lights go through the lobes (`lobesWgsl.ts`), which the
 * fragment sets itself.
 */
export const declaredLightingWgsl = (
  bindings: LightingBindings,
  key: Partial<ContractKey> = LOBELESS_KEY,
  { pair = false } = {},
) =>
  wgslBlock(
    `declaredLightingWgsl(${bindingsLabel(bindings)}, ${variantLabel(key)}, ${pair})`,
    [lightingBase(bindings, key, { pair })],
    `
fn declaredLighting${pair ? 'Pair' : ''}(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,pixel:vec2f,z:f32)->${pair ? 'LightPair' : 'vec3f'}{
 let cell=gridCell(pixel,z,vec2u(uni.lightTiles));
 vsmTraceAt(pixel);
 var slice=vec2u(TILE_NO_SLICE,directLights.count);
 if(cell!=TILE_NO_SLICE){slice=cellSlice(cell);}
 return sliceLighting${pair ? 'Pair' : ''}(rgb,metal,rough,N,V,P,ao,slice);
}`,
  )
