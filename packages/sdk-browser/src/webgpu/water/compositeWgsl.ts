import {
  BOUNDED_SCREEN_REFLECTION_WGSL,
  SCREEN_REFLECTION_WGSL,
} from '../../reflections/screenWgsl.ts'
import {
  CONTRACT_BINDINGS_WGSL,
  FULLSCREEN_VERTEX,
  surfaceBindingsWgsl,
  VIEW_WGSL,
  WORLD_AT_WGSL,
} from '../../lighting/deferred/shaders.ts'
import { STANDARD_LIGHTING_WGSL } from '../../lighting/standardLighting.ts'
import {
  CONTRACT_SHADOW_BINDINGS,
  declaredLightingWgsl,
} from '../../lighting/direct/lightingWgsl.ts'
import { bounceApplyWgsl } from '../../bounce/applyWgsl.ts'
import { BOUNCE_SURFACE_BINDING, bounceReflectionWgsl } from '../../bounce/reflectWgsl.ts'
import { RESIDENT_PROXY_BINDING } from '../../bounce/nodeWgsl.ts'
import { BLEND_VIEW_WGSL } from '../blend/viewLayout.ts'
import { WATER_UNPACK_WGSL } from './surfaceWgsl.ts'
import { WATER_SHADOW_READ_WGSL } from './shadowReadWgsl.ts'
import { VOLUME_LAW_WGSL } from '../transparent/volumeLaw.ts'
import { VOLUME_MARKED_WGSL } from '../transparent/transmission.ts'
import { WATER_TRANSMITTED_WGSL } from './transmittedWgsl.ts'
import { WATER_LOBELESS_WGSL, WATER_LOBES_WGSL } from './waterLobesWgsl.ts'
import { WATER_COLOR_WGSL } from './waterColorWgsl.ts'
import type { ContractKey } from '../../lighting/deferred/contractCuts.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import type { WgslDecl } from '../../../../math/src/wgsl/decl.ts'

/** Bindings of the composite: the deferred bounce layout as-is — surfaces and depth, the view,
 *  the contract, the probe grid, the proxy — then what only water reads: the frozen backdrop, the
 *  opaque depth, the blend view uniform and the material volumes. */
export const WATER_BINDINGS = {
  baseMetal: 0,
  normalRough: 1,
  emissiveAo: 2,
  /** The water word the surface stage wrote (`surfaceWgsl.ts`), on the surface flags' number. */
  word: 3,
  depth: 4,
  view: 5,
  directLights: 6,
  tileLights: 7,
  shadowData: 8,
  shadowAtlas: 9,
  shadowSampler: 10,
  bounceGrid: 11,
  probes: 12,
  proxy: RESIDENT_PROXY_BINDING,
  backdrop: 14,
  backdropDepth: 15,
  /** The blend view uniform, as written for the blend pass: projection, eye, tiles, flags. */
  uniform: 16,
  volumes: 17,
  /** The shadow pool's transmittance layer, on the deferred resolve's numbers. */
  shadowTransmittance: CONTRACT_SHADOW_BINDINGS.transmittance,
  shadowTranslucentDepth: CONTRACT_SHADOW_BINDINGS.translucentDepth,
  surface: BOUNCE_SURFACE_BINDING,
}

/**
 * Fullscreen composite of the water pass. A pixel the surface stage wrote is lit once here: the
 * transmitted backdrop, refracted by the material IOR and attenuated over the distance the ray
 * travels in the volume; the reflection of the probe grid weighted by Fresnel; the specular of the
 * declared lights; and the surface's own lit colour for what the material does not transmit.
 * Everything is read on the imported material — `KHR_materials_transmission`, `KHR_materials_ior`,
 * `KHR_materials_volume` — and the scene's declared sources, with the engine's only lighting
 * formula. No light of the pass's own, no constant tuned to a scene (P6).
 *
 * What differs from the glTF sample viewer's forward composition: **the volume ends where the
 * opaque scene begins.** The refracted ray travels the declared thickness, or the distance to the
 * frozen backdrop under the pixel when that is shorter, and both the exit it is reread at and the
 * attenuation follow that distance — a block just below a basin's surface is displaced and tinted
 * by its own depth, not by the basin's, unlike a single-layer water. The
 * exit is one screen-space sample, checked against the surface depth, never a march: a ray that
 * crosses an object before its exit does not see it, a known limit shared with the forward pass.
 * And the share transmitted through an empty backdrop keeps that emptiness as coverage, so the
 * display background shows through a surface in front of nothing instead of a black radiance.
 * Its mirror ray is bounded (`BOUNDED_SCREEN_REFLECTION_WGSL`, #1279), but in a reference session:
 * `unbounded`, the whole walk and the proxy ray (`reflectionTrace`, `frame/referenceMode.ts`).
 * The surface's lit colour, which only the share the material does not transmit, `(1-t)·alpha`,
 * carries into the composite: at full transmission (`t` = 1) that share is zero, `0·alpha·lit` an
 * exact zero whatever finite colour `lit` holds, and the bounce walk, the environment and the
 * emission are not evaluated — the colour and coverage are the same numbers, a zero's sign aside
 * (`litShare.test.ts`). The declared lights stay one walk for both sums (`declaredLightingPair`):
 * their specular is the reflection's.
 * Its light loop is without the shadow or the rectangle code `key` leaves out
 * (`declaredLightingWgsl`), the program of a scene that holds none (`pipelines.ts`). Without
 * `lobeless`, the program of an image whose transmissive surface carries an anisotropic or
 * clear-coat lobe (`waterLobesWgsl.ts`): a pixel without one sums the very same terms; with, the
 * stand-ins that read none (`WATER_LOBELESS_WGSL`, `lobeThrough` one).
 */
export const waterCompositeShader = (
  unbounded = false,
  key: Partial<ContractKey> = {},
  { route }: { route?: WgslDecl } = {},
) => {
  const lobes = !key.lobeless
  const bindings = {
    proxy: WATER_BINDINGS.proxy,
    transmittance: WATER_BINDINGS.shadowTransmittance,
  }
  return wgslProgram(
    `struct Volume{transmission:f32,eta:f32,thickness:f32,f0:f32,attenuation:vec4f,}
@group(0) @binding(${WATER_BINDINGS.backdrop}) var backdrop:texture_2d<f32>;
@group(0) @binding(${WATER_BINDINGS.backdropDepth}) var backdropDepth:texture_depth_2d;
@group(0) @binding(${WATER_BINDINGS.uniform}) var<uniform> uni:BlendView;
@group(0) @binding(${WATER_BINDINGS.volumes}) var<storage,read> volumes:array<Volume>;
@fragment fn composeWater(@builtin(position) pixel:vec4f)->@location(0) vec4f{return waterColor(pixel);}
struct Composed{@location(0) color:vec4f,@location(1) reactive:vec4f,}
@fragment fn composeWaterReactive(@builtin(position) pixel:vec4f)->Composed{
 let c=waterColor(pixel);
 return Composed(c,vec4f(0.0,1.0,0.0,c.a));
}
`,
    [
      STANDARD_LIGHTING_WGSL,
      declaredLightingWgsl(bindings, key, { pair: true }),
      bounceApplyWgsl(WATER_BINDINGS.bounceGrid, WATER_BINDINGS.probes),
      bounceReflectionWgsl(WATER_BINDINGS.surface),
      WORLD_AT_WGSL,
      WATER_TRANSMITTED_WGSL,
      ...(lobes ? [WATER_LOBES_WGSL] : []),
      WATER_COLOR_WGSL,
      unbounded ? SCREEN_REFLECTION_WGSL : BOUNDED_SCREEN_REFLECTION_WGSL,
      VIEW_WGSL,
      BLEND_VIEW_WGSL,
      surfaceBindingsWgsl('waterWord:texture_2d<f32>'),
      CONTRACT_BINDINGS_WGSL,
      WATER_UNPACK_WGSL,
      VOLUME_LAW_WGSL,
      FULLSCREEN_VERTEX,
      WATER_SHADOW_READ_WGSL,
      VOLUME_MARKED_WGSL,
      ...(lobes ? [] : [WATER_LOBELESS_WGSL]),
      ...(route ? [route] : []),
    ],
  )
}
