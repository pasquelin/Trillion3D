import { DEFERRED_BINDINGS } from '../deferred/bindings.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { directLightWgsl } from './lightWgsl.ts'
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { RECT_SHADING_WGSL } from './rectLightWgsl.ts'
import { irradianceShader } from '../../../../sdk-core/src/scene/core/irradianceBasis.ts'
import { SURFACE_MODEL_LIGHT_WGSL } from '../../scene/surfaceModel.ts'
import { declaredLightWgsl, sliceLightingWgsl } from './lightLoopWgsl.ts'
import {
  CONTRACT_SHADOW_BINDINGS,
  CONTRACT_VSM_BINDINGS,
  type VsmConsumerBindings,
  type VsmTraceBindings,
  vsmBindingsLabel,
} from './shadowBindings.ts'
import { directShadowWgsl } from './shadowWgsl.ts'
import { shadowKindsOf } from './shadowKinds.ts'
import { LOBELESS_KEY, type ContractKey, variantLabel } from '../deferred/contractCuts.ts'
import { INVERSE_PI } from '../../../../math/src/wgsl/constants.ts'
import { FOG_WGSL } from '../fogShader.ts'
import {
  LOBELESS_LIGHTING_WGSL,
  LOBELESS_TARGET_WGSL,
  LOBES_LIGHTING_WGSL,
  LOBES_TARGET_WGSL,
} from './lobesWgsl.ts'

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
 * the translucent casters' transmittance and the virtual shadow maps' (`CONTRACT_VSM_BINDINGS` unless given). The
 * opaque resolve reads its mask and, at `resolveTransmission`, the translucent casters'
 * transmission; the blend and water passes, without it, read the transmission alone, and trace
 * their fragments with `trace` (`directShadowWgsl`).
 */
export type LightingBindings = {
  transmittance: number
  vsm?: VsmConsumerBindings
  resolveTransmission?: number
  trace?: VsmTraceBindings
}

/** The bindings as a block name reads them, in their declared order, the defaults resolved. */
export const bindingsLabel = ({
  transmittance,
  vsm = CONTRACT_VSM_BINDINGS,
  resolveTransmission,
  trace,
}: LightingBindings) =>
  `${transmittance}, ${vsmBindingsLabel(vsm)}, ${resolveTransmission ?? null}, ${trace ? Object.values(trace).join(' ') : null}`

/**
 * Base of the two lighting passes: contract types, shadow reads, and the contribution of a
 * single declared light at the point, its shadow included — the engine's only lighting
 * formula. The two loops below differ only by the light list they walk, never by the
 * physics or the surface type. A light out of range, or fully in shadow, yields exactly zero.
 * What `key` leaves out is not compiled (`ContractKey`); `narrow`, the opaque resolve's alone.
 */
export const lightingBase = (
  bindings: LightingBindings,
  key: Partial<ContractKey>,
  { narrow = false, pair = false } = {},
) => {
  const shadowed = !key.unshadowed
  return wgslBlock(
    `lightingBase(${bindingsLabel(bindings)}, ${variantLabel(key)}, ${narrow}, ${pair})`,
    [
      SURFACE_MODEL_LIGHT_WGSL,
      RECT_SHADING_WGSL,
      ...(key.lobeless ? [LOBELESS_LIGHTING_WGSL] : [LOBES_LIGHTING_WGSL]),
      INVERSE_PI,
      directLightWgsl(narrow ? LIGHT_SETTINGS.tileLights : undefined),
      directShadowWgsl(bindings.transmittance, {
        resolveTransmission: bindings.resolveTransmission ?? null,
        vsm: bindings.vsm ?? CONTRACT_VSM_BINDINGS,
        kinds: shadowKindsOf(key),
        trace: bindings.trace,
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
/** The lit surface, one sum for every pass that lights one (the opaque resolve, the blended
 *  surfaces, the water): its declared \`lights\`, its \`bounce\` and \`environment\` under the coat
 *  (\`lobeThrough\`), the \`reflection\` and what it \`emissive\`ly gives, added in this order. A pass
 *  with no bounce gives zero. A thin two-sided surface adds its back, \`bounce+environment\` lit
 *  from \`-N\`, after. */
fn litSurface(lights:vec3f,bounce:vec3f,environment:vec3f,reflection:vec3f,emissive:vec3f)->vec3f{
 return lights+bounce*lobeThrough()+environment*lobeThrough()+reflection+emissive;
}
`,
  )
}

/** The opaque resolve's bindings (`lightingBase`). */
const DIRECT_BINDINGS: LightingBindings = {
  transmittance: CONTRACT_SHADOW_BINDINGS.transmittance,
  resolveTransmission: DEFERRED_BINDINGS.transmissionResolve,
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
 * Every pixel, moving or still, sums every light of its cell's list, character for character the
 * same loop: the shadow rays are traced once, by the projection, for every pixel a shadowed light
 * reaches, so the resolve pays a light's shading and a cached mask byte, never a ray — no subset to
 * draw, no noise for the history to average.
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
    ],
    `
/** Contribution of the contract lights to the pixel, light by light of its cell's list: the full
 *  sum, moving or still. */
fn contractLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,cell:u32)->vec3f{
 if(cell==TILE_NO_SLICE){return vec3f(0.0);}
 return sliceLighting(rgb,metal,rough,N,V,P,ao,cellSlice(cell));
}`,
  )
