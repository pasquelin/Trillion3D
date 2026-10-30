import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import type { HitLightingSettings } from '../../../../../sdk-core/src/contracts/hitLightingOptions.ts'

/** The bits of `ReflectionView.translucent.z`: the hit lighting runs, and it lights every hit (not only the ones the surface cache cannot light). */
export const HIT_LIGHT = { on: 1, forced: 2 } as const

/** `ReflectionView.translucent.w`: the shadow mode (0 off, 1 hard, 2 soft) in the low two bits, then these switches, then the shadow rays' translucency mode (0 opaque, 1 masked, 2 fractional) in the two bits from `translucencyShift`, then `captures`, then the reflection bounces (1 to 64) in the seven bits from `bouncesShift`, then the refraction events after the first (0 to 63) in the seven bits from `refractionsShift`. */
export const HIT_LIGHT_MODE = {
  direct: 4,
  skylight: 8,
  forceOpaque: 16,
  translucencyShift: 5,
  captures: 128,
  bouncesShift: 8,
  refractionsShift: 15,
} as const

/** The word of a hit's record (`sceneTraceHardware.ts`, `reflectionHitWords` words) that holds the material key the hit lighting sorts by (`litMaterialKey`), written where the hit lighting runs. */
export const REFLECTION_HIT_MATERIAL_WORD = 4

/** The `vec4u` a vertex of a path adds to a trace in the hit lighting's radiance buffer, after the first: the vertex's light and colours (two), its point and object, its normal, direction and distance. */
export const LIT_BOUNCE_VECS = 4

/** The `vec4u` the one vertex of a host whose paths bounce once holds in the hit lighting's radiance buffer (the screen probes', the radiance cache's): its light and colours, then the hit it was made at. */
export const LIT_SINGLE_VECS = 4

/** The programs of the scene stage through the scene's triangles: `none` has no hit lighting code, `direct` marks the hits to light again and holds the first pass, `finish` the second. */
export type HitLitMode = 'none' | 'direct' | 'finish'

/** The bit of a hit record's first word (`sceneTraceHardware.ts`) that says the hit is to be lit again. */
export const REFLECTION_HIT_LIT = 0x80000000

/** The mode word a hit lighting pass reads (`HIT_LIGHT_MODE`) of the settings: the shadow mode in two bits, then the switches, the translucency mode of the shadow rays, the reflection bounces and the refraction events. */
export const hitLightWord = (
  hit: Pick<
    HitLightingSettings,
    | 'shadowMode'
    | 'direct'
    | 'skylight'
    | 'forceOpaque'
    | 'captures'
    | 'translucencyMode'
    | 'bounces'
    | 'refractions'
  >,
) =>
  hit.shadowMode |
  (hit.direct ? HIT_LIGHT_MODE.direct : 0) |
  (hit.skylight ? HIT_LIGHT_MODE.skylight : 0) |
  (hit.forceOpaque ? HIT_LIGHT_MODE.forceOpaque : 0) |
  (hit.captures ? HIT_LIGHT_MODE.captures : 0) |
  (hit.translucencyMode << HIT_LIGHT_MODE.translucencyShift) |
  (hit.bounces << HIT_LIGHT_MODE.bouncesShift) |
  (hit.refractions << HIT_LIGHT_MODE.refractionsShift)

/**
 * The words of the mode a hit lighting pass reads (`word`, the expression of the u32 that holds them, `HIT_LIGHT_MODE`): the bits' names and the accessors of the shadow mode, the shadow rays' translucency mode, a switch, the reflection bounces,
 * the refraction events and the vertices a path holds. The hosts of the path (`pathWgsl.ts`) each declare their word: the reflections' view, the screen probes' parameters, the radiance cache's.
 */
export const hitLightModeWgsl = (word: string) =>
  wgslBlock(
    `hitLightModeWgsl(${word})`,
    [],
    `${wgslConsts({
      HIT_LIGHT_DIRECT: HIT_LIGHT_MODE.direct,
      HIT_LIGHT_SKYLIGHT: HIT_LIGHT_MODE.skylight,
      HIT_LIGHT_FORCE_OPAQUE: HIT_LIGHT_MODE.forceOpaque,
      HIT_LIGHT_CAPTURES: HIT_LIGHT_MODE.captures,
    })}
const HIT_LIGHT_TRANSLUCENCY_SHIFT:u32=${HIT_LIGHT_MODE.translucencyShift}u;
const HIT_LIGHT_BOUNCES_SHIFT:u32=${HIT_LIGHT_MODE.bouncesShift}u;
const HIT_LIGHT_REFRACTIONS_SHIFT:u32=${HIT_LIGHT_MODE.refractionsShift}u;
fn hitLightShadowMode()->u32{return ${word}&3u;}
fn hitLightTranslucency()->u32{return (${word}>>HIT_LIGHT_TRANSLUCENCY_SHIFT)&3u;}
fn hitLightHas(bit:u32)->bool{return (${word}&bit)!=0u;}
fn hitLightBounces()->u32{return max((${word}>>HIT_LIGHT_BOUNCES_SHIFT)&127u,1u);}
fn hitLightRefractions()->u32{return (${word}>>HIT_LIGHT_REFRACTIONS_SHIFT)&127u;}
fn hitLightVertices()->u32{return hitLightBounces()*(1u+hitLightRefractions());}`,
  )

/** The words the reflections' hit lighting passes read of the view: the mode word (`translucent.w`) and the switches of `translucent.z`. */
export const HIT_LIGHT_WGSL = wgslBlock(
  'HIT_LIGHT_WGSL',
  [hitLightModeWgsl('reflectionView.translucent.w')],
  `${wgslConsts({ HIT_LIGHT_ON: HIT_LIGHT.on, HIT_LIGHT_FORCED: HIT_LIGHT.forced })}
fn hitLightOn()->bool{return (reflectionView.translucent.z&HIT_LIGHT_ON)!=0u;}
fn hitLightForced()->bool{return (reflectionView.translucent.z&HIT_LIGHT_FORCED)!=0u;}`,
)
