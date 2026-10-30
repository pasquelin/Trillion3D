import type { AtmosphereSunIndex, LightMobility } from '../../scene/light/contracts.ts'
import type { LightUnits } from '../../scene/light/lightUnits.ts'
import type { LightParameters } from './lightParameters.ts'
import { validateAtmosphereSunIndex } from '../../scene/light/validate.ts'
import { Object3D } from '../object/object3d.ts'
import { Color } from '../math/color.ts'
import { Vector3, readVec3 } from '../math/vector3.ts'
import { listen, unlisten } from '../observed.ts'
import { noteNodeWrite } from '../../scene/core/nodeEdits.ts'
import {
  copySwitches,
  copyTint,
  defineSwitches,
  takeSwitches,
  takeTint,
  tintOf,
} from './lightAirSettings.ts'
import * as lightFunction from './lightFunctionSettings.ts'
import * as lightShaft from './lightShaftSettings.ts'
import * as lightCloudShadow from './lightCloudShadowSettings.ts'
import * as lightShadow from './lightShadowSettings.ts'
import * as lightContactShadow from './lightContactShadowSettings.ts'
import {
  defineWritable,
  initialNumbers,
  lightChanged,
  NUMBERS,
  type LightNumber,
} from './lightNumbers.ts'
import { copyLamp, defineLampSettings, takeLamp } from './lightLampSettings.ts'
import { lightFlag } from './lightFlags.ts'
import { lightMobility } from './lightMobility.ts'
import { defineLightingChannels } from './lightChannels.ts'

export type { LightParameters }

/** The kinds placed by a direction: a sky's is its position seen from the origin. */
const AIMED = new Set(['directional', 'spot', 'hemisphere'])
const point = new Vector3()
/** Whether a light may be the sun of the atmosphere, on by default (`Light.atmosphereSun`). */
const atmosphereSun = lightFlag('atmosphereSun', true)
/** Whether translucent surfaces may cast into the light's classic shadow maps, on by default (`Light.castTranslucentShadows`). */
const castTranslucentShadows = lightFlag('castTranslucentShadows', true)
/** The lights a page set to the atmosphere's second light (`Light.atmosphereSunIndex`): few, as the
 *  lights left out of the candidates. */
const SUN_INDEX = new WeakMap<Light, AtmosphereSunIndex>()
/** The lights set against their kind's default `shadowsFog`. */
const FOG_SHADOW = new WeakMap<Light, boolean>()

/**
 * A light placed in the scene. Its numbers are accessors: a write reaches the world's light
 * store at once. Directional and spot lights aim at `target`, a node of its own that the page
 * may move or parent like any other; `lookAt` moves it.
 */
export class Light extends Object3D {
  /** Always `true`: tells a light apart from any other object. */
  get isLight(): true {
    return true
  }
  /** The light's colour; change it in place with `set`, or announce channels written straight
   *  with `needsUpdate = true`. */
  readonly color: Color
  /** A hemisphere light's colour from below. */
  readonly groundColor: Color
  /** The node a directional or spot light shines at; move it to aim the light. */
  readonly target = new Object3D()
  /** A probe's coefficients (`LightParameters.sh`); written in place, then `needsUpdate`. */
  sh: number[] | null = null
  readonly _values: Record<LightNumber, number>
  /** How strong the light is, a write reaching the world at once: lux for a directional light, a
   *  number in `intensityUnits` for a point, spot or rectangle light. Absent from the parameters,
   *  10 lux for a directional light, 5000 unitless for a lamp, the light of 8 candelas written in
   *  its unit (`defaultIntensityOf`: an EV of 3, 8 candelas over its area in nits), 1 for the
   *  others. */
  declare intensity: number
  /** The unit a point, spot or rectangle light's `intensity` is written in (`LIGHT_UNITS`):
   *  `'unitless'` by default; any other value is refused (`INVALID_SCENE_LIGHT`). A write reaches
   *  the world at once and keeps the number: the light's strength changes with it. */
  declare intensityUnits: LightUnits
  /** How far a point or spot light reaches; 0 means no limit. */
  declare distance: number
  /** How fast the light fades with distance. */
  declare decay: number
  /** Half the opening of a spot light's inner cone, in radians, where the light is whole; 0 by
   *  default, the light fades across the whole cone. Held a milliradian short of the outer cone. */
  declare innerConeAngle: number
  /** Half the opening of a spot light's outer cone, in radians, where the light fades to nothing;
   *  44° by default. */
  declare outerConeAngle: number
  /** Width of a rectangle light, in metres; 0.64 by default. */
  declare width: number
  /** Height of a rectangle light, in metres; 0.64 by default. */
  declare height: number
  /** Radius of the emitting sphere; `emitterRadius` in the engine's store. */
  declare radius: number
  /** Length of the tube along the light's local y, in metres; `emitterLength` in the store. */
  declare tubeLength: number
  /** Soft radius of the source, in metres; `emitterSoftRadius` in the store. */
  declare softRadius: number
  /** The exponent of a point or spot light's fall-off where `inverseSquared` is off; 8. */
  declare radialExponent: number
  /** The share of its diffuse light the light gives, from 0 to 1; 1. */
  declare diffuseShare: number
  /** The share of its specular light the light gives, from 0 to 1; 1. */
  declare specularShare: number
  /** Point, spot and rect only: how much the light's strength is divided by the image's exposure, from 0 to 1; 0, the
   *  light keeps its strength whatever the exposure (`SceneLight.inverseExposureBlend`). */
  declare inverseExposureBlend: number
  /** Point, spot and rect only: the distance from a perspective view, in metres, past which the light is left out of the image, its lighting and
   *  its shadow (`SceneLight.maxDrawDistance`); 0, no limit. */
  declare maxDrawDistance: number
  /** Whether a point or spot light falls off as the inverse square of the distance, windowed by its
   *  `distance`; `true` by default. A write reaches the world at once. */
  declare inverseSquared: boolean
  /** Angular radius of a directional light's disk, in radians: its soft shadow's size; 0 gives hard
   *  shadows. A sun defaults to the solar disk (`LIGHT_SETTINGS.sunAngularRadius`). */
  declare angularRadius: number
  /** Directional only: the soft angle of the source's disk, in degrees from 0 up to 180 (`SceneLight.softAngle`); 0 by default. */
  declare softAngle: number
  /** How the four layers of the light's hair deep shadow are spread, from 0 (evenly) to 1 (near the front) (`SceneLight.hairDeepShadowLayerDistribution`); 0.5 by default. */
  declare hairDeepShadowLayerDistribution: number
  /** How much of the light the volumetric fog and the clouds scatter: 0 leaves it out of both; 1. */
  declare fogScattering: number
  /** The factor on the resolution a point, spot or rectangle light's shadow is given
   *  (`SceneLight.shadowResolutionScale`); 1 by default, 0 takes the shadow away. */
  declare shadowResolutionScale: number
  /** The temperature, in kelvin, of the black body the light's colour follows when `useTemperature`
   *  is on (`SceneLight.temperatureKelvin`); 6500, white, by default. */
  declare temperatureKelvin: number
  /** Directional only: the light's priority for the one directional light the forward readers take
   *  — the translucent surfaces' cloud shade, the volumetric fog (`SceneLight.forwardShadingPriority`):
   *  a whole number of at least 0, the highest chosen, equals going to the brightest; 0 by default.
   *  A write reaches the world at once; any other value is refused (`INVALID_SCENE_LIGHT`). */
  declare forwardShadingPriority: number
  /** Whether the light's colour is multiplied by the colour of a black body at `temperatureKelvin`;
   *  off by default. A write reaches the world at once. */
  declare useTemperature: boolean
  /** Directional only: whether the light's shadow also shades the air, the haze and the sky's
   *  march reading it along their rays (`SceneLight.shadowsAir`); off by default. */
  declare shadowsAir: boolean
  /** Directional only: whether the air's transmittance toward the light is read for each surface
   *  point (`SceneLight.transmittancePerPixel`); off by default. */
  declare transmittancePerPixel: boolean
  /** Whether the light shines through the subsurface-profile surfaces it shadows (`SceneLight.transmission`);
   *  off by default, and acting on a movable light that casts a shadow alone. */
  declare transmission: boolean
  /** Whether the light draws a deep shadow of the hair strands it reaches (`SceneLight.castHairDeepShadow`); off by default. */
  declare castHairDeepShadow: boolean

  /** Which kind of light this is: `'point'`, `'spot'`, `'directional'`… */
  readonly kind: string
  /** What its colours and its target's place call while it is in a world; made on its first entry. */
  declare private _heard?: () => void
  constructor(kind: string, p: LightParameters = {}) {
    super()
    this.kind = kind
    this.type = `${kind}Light`
    this.color = new Color(p.color ?? 0xffffff)
    this.groundColor = new Color(p.groundColor ?? 0x000000)
    // A colour written is noted on the light, in a world or not: a watch reads the light it names,
    // not the colour.
    const noted = () => noteNodeWrite(this)
    listen(this.color, noted)
    listen(this.groundColor, noted)
    this._values = initialNumbers(kind, p)
    takeSwitches(this, p)
    takeLamp(this, p)
    takeTint(this, p.sunDiskTint)
    lightFunction.take(this, p)
    lightShaft.take(this, p)
    lightCloudShadow.take(this, p)
    lightShadow.take(this, p)
    lightContactShadow.take(this, p)
    if (p.shadowsFog !== undefined) this.setFogShadow(p.shadowsFog)
    atmosphereSun.take(this, p.atmosphereSun)
    castTranslucentShadows.take(this, p.castTranslucentShadows)
    lightMobility.take(this, p.mobility)
    if (p.lightingChannels) this.lightingChannels = p.lightingChannels
    if (p.atmosphereSunIndex !== undefined) this.setSunIndex(p.atmosphereSunIndex)
    if (p.position) this.position.set(...readVec3(p.position))
    else if (AIMED.has(kind)) this.position.set(0, 1, 0)
    if (p.sh) this.sh = Array.from(p.sh)
    if (p.target) this.target.position.set(...readVec3(p.target))
    this.castShadow = p.castShadow ?? true
  }
  /** How the light is meant to move and be lit: `'static'` (baked, it casts no dynamic shadow),
   *  `'stationary'` (it does not move; its colour and intensity may change) or `'movable'` (fully
   *  dynamic); `'stationary'` by default, every kind's. Any other value is refused
   *  (`INVALID_SCENE_LIGHT`). A write reaches the world at once. */
  declare mobility: LightMobility
  /** Whether a directional light may be the sun of the sky module's atmosphere (`scene.sky`): of
   *  the lights that may, the brightest is; `true` by default. A write reaches the world at once. */
  declare atmosphereSun: boolean
  /** Whether translucent objects that cast a volumetric translucent shadow (`Object3D.castVolumetricTranslucentShadow`) cast it into this light's
   *  classic shadow maps (`shadowVirtualEnable` off, `translucentObjectShadows` on); `true` by default. A write reaches the world at once. */
  declare castTranslucentShadows: boolean
  /** Which of the atmosphere's two lights this directional light may be, 0 or 1 (a sun and a moon,
   *  or two suns): of the lights that may be one, the brightest is held for each index; 0 by
   *  default. Any other value is refused (`INVALID_SCENE_LIGHT`). A write reaches the world at
   *  once. */
  get atmosphereSunIndex(): AtmosphereSunIndex {
    return SUN_INDEX.get(this) ?? 0
  }
  set atmosphereSunIndex(value: AtmosphereSunIndex) {
    this.setSunIndex(value)
    lightChanged(this)
  }
  /** Directional only: the colour the sun's disk in the sky is multiplied by, linear; white by
   *  default. Change it in place with `set`. */
  get sunDiskTint(): Color {
    return tintOf(this)
  }
  /** Whether the light's shadow also shadows the volumetric fog; a directional light's does. */
  get shadowsFog() {
    return FOG_SHADOW.get(this) ?? this.kind === 'directional'
  }
  set shadowsFog(value: boolean) {
    this.setFogShadow(value)
    lightChanged(this)
  }
  private setFogShadow(value: boolean) {
    if (value === (this.kind === 'directional')) FOG_SHADOW.delete(this)
    else FOG_SHADOW.set(this, value)
  }
  private setSunIndex(value: AtmosphereSunIndex) {
    if (validateAtmosphereSunIndex(value, this.name || 'light') === 0) SUN_INDEX.delete(this)
    else SUN_INDEX.set(this, value)
  }
  /** Only a light in a world hears its colours and its target's place: out of one, they hold no
   *  reference to it, and a write reaches nothing. */
  protected override linked(inWorld: boolean) {
    const heard = (this._heard ??= () => this._link?.content(this))
    lightFunction.hear(this, inWorld)
    for (const value of [this.color, this.groundColor, this.target.position])
      if (inWorld) listen(value, heard)
      else unlisten(value, heard)
  }
  protected override get looksDownNegativeZ() {
    return true
  }
  protected override blank(): this {
    return new Light(this.kind) as this
  }
  /** Takes `source`'s node values and, from a light, its numbers, colours, coefficients and aim;
   *  its own `kind` stays. */
  override copy(source: Object3D, recursive = true) {
    super.copy(source, recursive)
    if (!(source instanceof Light)) return this
    ;(this as { _values: Light['_values'] })._values = { ...source._values }
    atmosphereSun.copy(this, source)
    castTranslucentShadows.copy(this, source)
    lightMobility.copy(this, source)
    this.setSunIndex(source.atmosphereSunIndex)
    this.setFogShadow(source.shadowsFog)
    copySwitches(this, source)
    copyLamp(this, source)
    copyTint(this, source)
    lightFunction.copy(this, source)
    lightShaft.copy(this, source)
    lightCloudShadow.copy(this, source)
    lightShadow.copy(this, source)
    lightContactShadow.copy(this, source)
    this.color.copy(source.color)
    this.groundColor.copy(source.groundColor)
    this.sh = source.sh && [...source.sh]
    this.target.position.copy(source.target.position)
    this._link?.content(this)
    return this
  }
  /** `light.needsUpdate = true` after writing `sh` in place, or a colour's `r`, `g`, `b` straight:
   *  the write is counted (`nodeWrites`), and the world and the scene watch read it again. */
  set needsUpdate(_value: boolean) {
    lightChanged(this)
  }
  get needsUpdate() {
    return false
  }
  /** Aims the light at a world point: a directional or spot light moves its `target` there — its
   *  direction reads from it —, and the node turns too, which is what a rectangle faces by. */
  override lookAt(x: number | { x: number; y: number; z: number }, y = 0, z = 0) {
    super.lookAt(x, y, z)
    if (typeof x === 'number') point.set(x, y, z)
    else point.set(x.x, x.y, x.z)
    this.target.parent?.worldToLocal(point)
    this.target.position.copy(point)
  }
}

defineSwitches(Light.prototype)
defineLampSettings(Light.prototype)
atmosphereSun.define(Light.prototype)
castTranslucentShadows.define(Light.prototype)
lightMobility.define(Light.prototype)
defineLightingChannels(Light.prototype)
lightFunction.define(Light.prototype)
lightShaft.define(Light.prototype)
lightCloudShadow.define(Light.prototype)
lightShadow.define(Light.prototype)
lightContactShadow.define(Light.prototype)
defineWritable(Light.prototype, NUMBERS, (light) => light._values)

/** A member building one kind of light. */
const kind = (name: string) => (p?: LightParameters) => new Light(name, p)
/** The `light` family: each kind placed as a node of the scene. */
export const light = {
  /** A light that reaches everything evenly, from no direction. */
  ambient: kind('ambient'),
  /** A light from very far away, like the sun: every ray goes the same way. */
  directional: kind('directional'),
  /** A light from one point, like a bulb, shining every way. */
  point: kind('point'),
  /** A light from one point, shining through a cone, like a torch. */
  spot: kind('spot'),
  /** A sky colour from above and a ground colour from below. */
  hemisphere: kind('hemisphere'),
  /** A glowing rectangle, like a lit panel or a screen. */
  rectArea: kind('rectArea'),
  /** Light measured around a point and given back to what is near it. */
  probe: kind('probe'),
}
