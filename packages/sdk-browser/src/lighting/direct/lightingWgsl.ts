import { RESIDENT_PROXY_BINDING, residentProxyWgsl } from '../../bounce/nodeWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { directLightWgsl } from './lightWgsl.ts'
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts'
import { RECT_SHADING_WGSL } from './rectLightWgsl.ts'
import { irradianceShader } from '../../../../sdk-core/src/scene/core/irradianceBasis.ts'
import { SURFACE_MODEL_LIGHT_WGSL } from '../../scene/surfaceModel.ts'
import { declaredLightWgsl, sliceLightingWgsl } from './lightLoopWgsl.ts'
import { directLightSamplingWgsl } from './lightSamplingWgsl.ts'
import { CONTRACT_VSM_BINDINGS, directShadowWgsl, type VsmConsumerBindings } from './shadowWgsl.ts'
import { shadowKindsOf } from './shadowKinds.ts'
import { LOBELESS_KEY, type ContractKey, variantLabel } from '../deferred/contractCuts.ts'
import { BOUNCE_TRACE_WGSL } from '../../bounce/traceWgsl.ts'
import { VSM_TRANSMISSION_RESOLVE_BINDING } from '../../vsm/transmissionWgsl.ts'
import { INVERSE_PI } from '../../../../math/src/wgsl/constants.ts'
import { FOG_WGSL } from '../fogShader.ts'
import {
  LOBELESS_LIGHTING_WGSL,
  LOBELESS_TARGET_WGSL,
  LOBES_LIGHTING_WGSL,
  LOBES_TARGET_WGSL,
} from './lobesWgsl.ts'

/** Shadow bindings past the virtual shadow maps' own (`CONTRACT_VSM_BINDINGS`), on the numbers the
 *  water composite reads them at too: the opaque resolve's mask — a forward pass's transmission
 *  (`directShadowWgsl`) —, and the pool the water reads. */
export const CONTRACT_SHADOW_BINDINGS = {
  transmittance: 18,
  translucentDepth: CONTRACT_VSM_BINDINGS.pool,
}

/** A cell's list of lights — what the resolves walk, and the virtual shadow maps' marking
 *  pass (`../../vsm/markingWgsl.ts`). */
export const TILE_SLICE_WGSL = wgslBlock(
  'TILE_SLICE_WGSL',
  [],
  `
/** Where the lights of the cell whose record starts at \`base\` start in the view's pool, and how
 *  many (#1369). \`TILE_NO_SLICE\` when the pool had no room: every declared light of the scene. */
fn cellSlice(base:u32)->vec2u{
 let first=tileLights[base+1u];
 return vec2u(first,select(tileLights[base]&~TILE_SHADOWED,directLights.count,first==TILE_NO_SLICE));
}`,
)
/**
 * A pixel's cell of the light grid, read by the opaque resolve (`surfaceWgsl.ts`) and the virtual shadow maps'
 * marking pass (`../../vsm/markingWgsl.ts`), both on the deferred view (#1369). Without
 * `shadowed`, the program with no shadow code: no cell reads a shadow.
 */
export const pixelCellWgsl = (shadowed = true) =>
  wgslBlock(
    `pixelCellWgsl(${shadowed})`,
    [],
    `
/** The record of the pixel's cell at depth \`z\`, \`TILE_NO_SLICE\` with no list: no light, or past
 *  the grid. The surface reads it once, for its shadow setup and its lighting. */
fn pixelCell(pixel:vec2f,z:f32)->u32{
 if(u32(view.lightParams.x)==0u){return TILE_NO_SLICE;}
 return gridCell(pixel,z,vec2u(view.lightParams.yz));
}
/** Whether a shadow is read in the cell: its list holds a light with a shadow slot, the high bit
 *  of its count. */
fn cellShadowed(cell:u32)->bool{${shadowed ? 'return cell!=TILE_NO_SLICE&&(tileLights[cell]&TILE_SHADOWED)!=0u;' : 'return false;'}}`,
  )
/**
 * The **ranks** of the bindings a lighting program reads, which the layouts number differently:
 * the resident proxy, which the mirror reflection traces (`bounce/reflectWgsl.ts`), the translucent
 * casters' transmittance and the virtual shadow maps' (`CONTRACT_VSM_BINDINGS` unless given). The
 * opaque resolve reads its mask and, at `resolveTransmission`, the translucent casters'
 * transmission; the blend and water passes, without it, read the transmission alone
 * (`directShadowWgsl`).
 */
export type LightingBindings = {
  proxy: number
  transmittance: number
  vsm?: VsmConsumerBindings
  resolveTransmission?: number
}

/**
 * Base of the two lighting passes: contract types, shadow reads, and the contribution of a
 * single declared light at the point, its shadow included — the engine's only lighting
 * formula. The two loops below differ only by the light list they walk, never by the
 * physics or the surface type. A light out of range, or fully in shadow, yields exactly zero.
 * What `key` leaves out is not compiled (`ContractKey`); `narrow`, the opaque resolve's alone.
 */
const lightingBase = (
  bindings: LightingBindings,
  key: Partial<ContractKey>,
  { narrow = false, pair = false } = {},
) => {
  const shadowed = !key.unshadowed
  return wgslBlock(
    `lightingBase(${JSON.stringify(bindings)}, ${variantLabel(key)}, ${narrow}, ${pair})`,
    [
      SURFACE_MODEL_LIGHT_WGSL,
      RECT_SHADING_WGSL,
      ...(key.lobeless ? [LOBELESS_LIGHTING_WGSL] : [LOBES_LIGHTING_WGSL]),
      INVERSE_PI,
      directLightWgsl(narrow ? LIGHT_SETTINGS.tileLights : undefined),
      residentProxyWgsl(bindings.proxy),
      BOUNCE_TRACE_WGSL,
      directShadowWgsl(bindings.transmittance, {
        resolveTransmission: bindings.resolveTransmission ?? null,
        vsm: bindings.vsm ?? CONTRACT_VSM_BINDINGS,
        kinds: shadowKindsOf(key),
      }),
      FOG_WGSL,
      declaredLightWgsl(key, { pair }),
      TILE_SLICE_WGSL,
      sliceLightingWgsl(!shadowed, pair),
    ],
    `
var<private> thinSubsurface:vec3f=vec3f(0.0);
/** Thin two-sided diffuse transmission: projected back irradiance, normalized over a hemisphere.
 * A Lambert lobe on the back side: the light that reaches the surface from behind, as the two-sided foliage contract asks. */
fn thinTransmission(cosine:f32,energy:f32)->f32{return max(-cosine,0.0)*energy*INVERSE_PI;}
/** The environment's irradiance at the normal N (\`packages/sdk-core/src/scene/core/environment.ts\`), on the diffuse lobe:
 *  what an ambient, a sky over a ground or a probe gives a surface, never shadowed. */
fn environmentLighting(rgb:vec3f,metal:f32,N:vec3f,ao:f32)->vec3f{
 let e=directLights.environment;
 let E=${irradianceShader((k) => `e[${k}].rgb`, 'N')};
 return rgb*(1.0-metal)*max(E,vec3f(0.0))*ao*INVERSE_PI;
}
`,
  )
}

/** The opaque resolve's bindings (`lightingBase`). */
const DIRECT_BINDINGS: LightingBindings = {
  proxy: RESIDENT_PROXY_BINDING,
  transmittance: CONTRACT_SHADOW_BINDINGS.transmittance,
  resolveTransmission: VSM_TRANSMISSION_RESOLVE_BINDING,
}

/**
 * Resolve of the direct-lighting contract in the visibility buffer. The pixel loop is bounded
 * by the list of its cell of the light grid, never by the scene light count; Lambert and GGX
 * come from `standardLighting`, the only implementation; attenuation is physical and
 * cancels at range.
 *
 * No light without a declared source: there is no ambient term here, no constant sky, no
 * lighting written in the scene. A surface that no declared light reaches is exactly zero,
 * and a windowless corridor stays black in full daylight.
 *
 * `view.viewport.w` is the rank of a SAMPLED image — a moving one that temporal antialiasing
 * accumulates — and zero for every other: a still image, which converges to the exact sum,
 * and an image that does not accumulate, which is never noisy. At zero the loop is the one
 * over every light of the cell, character for character; so is it on a sampled image whose cell
 * lists no shadowed light (#1249), a flag the grid pass writes once in the cell's count.
 *
 * The program `key` names (`ContractKey`, `LOBELESS_KEY` unless given). `narrow`, the resolve of a
 * scene of at most `TILE_LIGHTS` lights (#849): its light array is that long. `unshadowed`, the
 * resolve of a scene no light of which holds a shadow slot: the same sums with no shadow code
 * compiled in (`declaredLightWgsl`, #1249) and the range reject in its loop (`sliceLightingWgsl`).
 * `rectless`, the resolve of a scene that holds no rectangle light: the same sums with no rectangle
 * code in the light loop (`declaredLightWgsl`, #1369). Without `lobeless`, the resolve of an image
 * that holds an anisotropic or clear-coat surface (`lobesWgsl.ts`).
 */
export const directLightingWgsl = (key: Partial<ContractKey> = LOBELESS_KEY) =>
  wgslBlock(
    `directLightingWgsl(${variantLabel(key)})`,
    [
      lightingBase(DIRECT_BINDINGS, key, { narrow: !!key.narrow }),
      key.lobeless ? LOBELESS_TARGET_WGSL : LOBES_TARGET_WGSL,
      pixelCellWgsl(!key.unshadowed),
      directLightSamplingWgsl(!key.rectless),
    ],
    `
/** Contribution of the contract lights to the pixel, light by light of its cell's list;
 *  \`shadowed\` is \`cellShadowed(cell)\`. The full sum has this one call site: a list the draw
 *  refuses — short, long, or with no room in the pool — takes it, as a still image does. */
fn contractLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,pixel:vec2f,cell:u32,shadowed:bool)->vec3f{
 if(cell==TILE_NO_SLICE){return vec3f(0.0);}
 let slice=cellSlice(cell);
 let rank=u32(view.viewport.w);
 if(rank==0u||!shadowed||slice.x==TILE_NO_SLICE||!sampledList(slice.y)){return sliceLighting(rgb,metal,rough,N,V,P,ao,slice);}
 return sampledSliceLighting(rgb,metal,rough,N,V,P,ao,slice,rank,pixel);
}`,
  )

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
 * once for its colour and its reflection's specular.
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
    `declaredLightingWgsl(${JSON.stringify(bindings)}, ${variantLabel(key)}, ${pair})`,
    [lightingBase(bindings, key, { pair })],
    `
fn declaredLighting${pair ? 'Pair' : ''}(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,pixel:vec2f,z:f32)->${pair ? 'LightPair' : 'vec3f'}{
 let cell=gridCell(pixel,z,vec2u(uni.lightTiles));
 var slice=vec2u(TILE_NO_SLICE,directLights.count);
 if(cell!=TILE_NO_SLICE){slice=cellSlice(cell);}
 return sliceLighting${pair ? 'Pair' : ''}(rgb,metal,rough,N,V,P,ao,slice);
}`,
  )
