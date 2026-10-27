import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { LOBELESS_KEY, type ContractKey, variantLabel } from '../deferred/contractCuts.ts'
import { bindingsLabel, lightingBase, type LightingBindings } from './lightingWgsl.ts'
import { translucentShadowLabel, type TranslucentShadow } from './shadowWgsl.ts'
import { declaredLightWgsl, sliceLightingWgsl } from './lightLoopWgsl.ts'

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
 * walks every declared light, the one rule of the opaque lit passes too (`cellSlice`).
 *
 * Its shadows are read from the fragment (`directShadowWgsl`): every translucent layer reads its own,
 * as `translucentShadow` says (the project switches of `TranslucentShadow`; the defaults unless
 * given).
 *
 * `key` (`LOBELESS_KEY` unless given) as the opaque lit passes', its `narrow` aside: `unshadowed`,
 * the loop of a scene no light of which holds a shadow slot; `rectless`, of a scene that holds no
 * rectangle light (`declaredLightWgsl`, #1249, #1369), picked on the same key
 * (`createLitVariants`). Without `lobeless`, the forward pass's program of a scene that holds an
 * anisotropic or clear-coat surface: its lights go through the lobes (`lobesWgsl.ts`), which the
 * fragment sets itself. A translucent program holds the contact shadows' code where its scene says so (`key.contactless`,
 * `translucentLitKey`), and casts the asked ray alone (`asked`, `contactShadowsOf`).
 *
 * The forward light loop takes an occlusion of 1: the material's occlusion weighs the indirect light and the environment,
 * not the lights.
 */
export const declaredLightingWgsl = (
  bindings: LightingBindings,
  key: Partial<ContractKey> = LOBELESS_KEY,
  translucentShadow?: TranslucentShadow,
) =>
  wgslBlock(
    `declaredLightingWgsl(${bindingsLabel(bindings)}, ${variantLabel(key)}${translucentShadowLabel(translucentShadow)})`,
    [lightingBase(bindings, key, { translucentShadow, rays: 'asked' })],
    `
fn declaredLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,pixel:vec2f,z:f32)->vec3f{
 vsmTraceAt(pixel);
 return sliceLighting(rgb,metal,rough,N,V,P,1.0,cellSlice(gridCell(pixel,z,vec2u(uni.lightTiles))));
}`,
  )

/**
 * The same lights split into their diffuse and specular shares (`declaredLightingSplit`), one walk
 * and one shadow read a light, so a forward-lit translucent surface can weigh them apart: a thin
 * translucent layer lays its diffuse under its coverage, its specular over it. Listed beside
 * the module's `declaredLightingWgsl` of the same `key`, whose base it reads.
 */
export const declaredLightingSplitWgsl = (key: Partial<ContractKey> = LOBELESS_KEY) =>
  wgslBlock(
    `declaredLightingSplitWgsl(${variantLabel(key)})`,
    [declaredLightWgsl(key, { term: 'split', rays: 'asked' }), sliceLightingWgsl('split')],
    `
fn declaredLightingSplit(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,pixel:vec2f,z:f32)->LightSplit{
 vsmTraceAt(pixel);
 return sliceLightingSplit(rgb,metal,rough,N,V,P,cellSlice(gridCell(pixel,z,vec2u(uni.lightTiles))));
}`,
  )
