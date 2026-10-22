import type { AtmosphereSunIndex } from '../../scene/light/contracts.ts'
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
import { initialNumbers, NUMBERS, type LightNumber } from './lightNumbers.ts'

export type { LightParameters }

/** The kinds placed by a direction: a sky's is its position seen from the origin. */
const AIMED = new Set(['directional', 'spot', 'hemisphere'])
const point = new Vector3()
/** The lights a page left out of the atmosphere's candidates: few, so a set and not a field each
 *  light would carry (`Light.atmosphereSun`). */
const NOT_SUN = new WeakSet<Light>()
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
  /** How strong the light is; a write reaches the world at once. */
  declare intensity: number
  /** How far a point or spot light reaches; 0 means no limit. */
  declare distance: number
  /** How fast the light fades with distance. */
  declare decay: number
  /** Half the opening of a spot light's cone, in radians. */
  declare angle: number
  /** How soft a spot light's edge is, from 0 to 1. */
  declare penumbra: number
  /** Width of a rectangle light. */
  declare width: number
  /** Height of a rectangle light. */
  declare height: number
  /** Radius of the emitting sphere; `emitterRadius` in the engine's store. */
  declare radius: number
  /** Length of the tube along the light's local y, in metres; `emitterLength` in the store. */
  declare tubeLength: number
  /** Soft radius of the source, in metres; `emitterSoftRadius` in the store. */
  declare softRadius: number
  /** Angular radius of a directional light's disk, in radians: its soft shadow's size; 0 gives hard
   *  shadows. A sun defaults to the solar disk (`LIGHT_SETTINGS.sunAngularRadius`). */
  declare angularRadius: number
  /** How far from the eye, in metres, a directional light's shadows take every caster
   *  (`LightParameters.shadowDistance`): 400 for a directional light, 0 for any other kind. A
   *  write reaches the world at once. */
  declare shadowDistance: number
  /** How much of the light the volumetric fog and the clouds scatter: 0 leaves it out of both; 1. */
  declare fogScattering: number
  /** The temperature, in kelvin, of the black body the light's colour follows when `useTemperature`
   *  is on (`SceneLight.temperatureKelvin`); 6500, white, by default. */
  declare temperatureKelvin: number
  /** Whether the light's colour is multiplied by the colour of a black body at `temperatureKelvin`;
   *  off by default. A write reaches the world at once. */
  declare useTemperature: boolean
  /** Directional only: whether the light's shadow also shades the air, the haze and the sky's
   *  march reading it along their rays (`SceneLight.shadowsAir`); off by default. */
  declare shadowsAir: boolean
  /** Directional only: whether the air's transmittance toward the light is read for each surface
   *  point (`SceneLight.transmittancePerPixel`); off by default. */
  declare transmittancePerPixel: boolean

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
    takeTint(this, p.sunDiskTint)
    lightFunction.take(this, p)
    lightShaft.take(this, p)
    lightCloudShadow.take(this, p)
    if (p.shadowsFog !== undefined) this.setFogShadow(p.shadowsFog)
    if (p.atmosphereSun === false) NOT_SUN.add(this)
    if (p.atmosphereSunIndex !== undefined) this.setSunIndex(p.atmosphereSunIndex)
    if (p.position) this.position.set(...readVec3(p.position))
    else if (AIMED.has(kind)) this.position.set(0, 1, 0)
    if (p.sh) this.sh = Array.from(p.sh)
    if (p.target) this.target.position.set(...readVec3(p.target))
    this.castShadow = p.castShadow ?? false
  }
  /** Whether a directional light may be the sun of the sky module's atmosphere (`scene.sky`): of
   *  the lights that may, the brightest is; `true` by default. A write reaches the world at once. */
  get atmosphereSun() {
    return !NOT_SUN.has(this)
  }
  set atmosphereSun(value: boolean) {
    if (value) NOT_SUN.delete(this)
    else NOT_SUN.add(this)
    noteNodeWrite(this)
    this._link?.content(this)
  }
  /** Which of the atmosphere's two lights this directional light may be, 0 or 1 (a sun and a moon,
   *  or two suns): of the lights that may be one, the brightest is held for each index; 0 by
   *  default. Any other value is refused (`INVALID_SCENE_LIGHT`). A write reaches the world at
   *  once. */
  get atmosphereSunIndex(): AtmosphereSunIndex {
    return SUN_INDEX.get(this) ?? 0
  }
  set atmosphereSunIndex(value: AtmosphereSunIndex) {
    this.setSunIndex(value)
    noteNodeWrite(this)
    this._link?.content(this)
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
    noteNodeWrite(this)
    this._link?.content(this)
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
    if (source.atmosphereSun) NOT_SUN.delete(this)
    else NOT_SUN.add(this)
    this.setSunIndex(source.atmosphereSunIndex)
    this.setFogShadow(source.shadowsFog)
    copySwitches(this, source)
    copyTint(this, source)
    lightFunction.copy(this, source)
    lightShaft.copy(this, source)
    lightCloudShadow.copy(this, source)
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
    noteNodeWrite(this)
    this._link?.content(this)
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
lightFunction.define(Light.prototype)
lightShaft.define(Light.prototype)
lightCloudShadow.define(Light.prototype)
for (const name of NUMBERS)
  Object.defineProperty(Light.prototype, name, {
    get(this: Light) {
      return this._values[name]
    },
    set(this: Light, value: number) {
      this._values[name] = value
      noteNodeWrite(this)
      this._link?.content(this)
    },
  })

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
