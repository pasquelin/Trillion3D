import { LIGHT_SETTINGS, type AtmosphereSunIndex } from '../../scene/light/contracts.ts'
import { validateAtmosphereSunIndex } from '../../scene/light/validate.ts'
import { shadowDistanceOf, type ShadowDistanceOption } from '../../contracts/shadowOptions.ts'
import { Object3D } from '../object/object3d.ts'
import { Color, type ColorInput } from '../math/color.ts'
import { Vector3, readVec3, type Vec3Input } from '../math/vector3.ts'
import { listen, unlisten } from '../observed.ts'
import { noteNodeWrite } from '../../scene/core/nodeEdits.ts'
import { DEG2RAD } from '../../../../math/src/constants.ts'

/** What a page may pass to a light member. */
export interface LightParameters {
  /** The light's colour. */
  color?: ColorInput
  /** How strong the light is. */
  intensity?: number
  /** Where the light stands. */
  position?: Vec3Input
  /** The point a directional or spot light shines at. */
  target?: Vec3Input
  /** Whether objects in this light cast shadows. */
  castShadow?: boolean
  /** How far a point or spot light reaches; 0 means no limit. */
  distance?: number
  /** How fast the light fades with distance; 2 is how real light fades. */
  decay?: number
  /** Half the opening of a spot light's cone, in radians. */
  angle?: number
  /** How soft a spot light's edge is, from 0 (sharp) to 1. */
  penumbra?: number
  /** The colour a hemisphere light gives from below. */
  groundColor?: ColorInput
  /** Width of a rectangle light. */
  width?: number
  /** Height of a rectangle light. */
  height?: number
  /** Radius of the emitting sphere of a point or spot light: its soft shadow's size, and how the
   *  lamp lights a surface — the horizon wraps a sphere, a highlight spreads. */
  radius?: number
  /** Length of the tube a point or spot light is, in metres, along the light's own up (its local
   *  y); 0, the default, a sphere or a point. With a `radius` the lamp is a capsule. */
  tubeLength?: number
  /** Soft radius of a point or spot light, in metres: it widens the highlight the lamp leaves
   *  without lighting more of the surface; 0 by default. */
  softRadius?: number
  /** Directional source angular radius, in radians. */
  angularRadius?: number
  /** How far from the eye, in metres, a directional light's shadows are asked to reach, scaled by
   *  the view's `shadowDistanceScale`: `true` or nothing 400, `false` none. The far-shadow test's
   *  edge lies a little past it (427.0 at the defaults, the last near level's overlap into the next):
   *  a caster whose depth along the view, less its radius, is past the edge, and whose object does
   *  not set `castFarShadow`, is left out of the light's shadows. By default the test reaches the
   *  world's merged far-field shells alone; the view's `farShadowCullsAllMeshes` makes it reach
   *  every caster. */
  shadowDistance?: ShadowDistanceOption
  /** Whether a directional light may be the sun of the scene's atmosphere (`scene.atmosphere`):
   *  of the lights that may, the brightest is; `true` by default. */
  atmosphereSun?: boolean
  /** Which of the atmosphere's two lights a directional light may be, 0 or 1 (a sun and a moon, or
   *  two suns): the brightest of those that may be is held for each; 0 by default. */
  atmosphereSunIndex?: AtmosphereSunIndex
  /** A probe's irradiance: 27 numbers, nine RGB spherical-harmonic coefficients of the radiance
   *  in the band order constant, `y`, `z`, `x`, `xy`, `yz`, `3z² − 1`, `xz`, `x² − y²`, scaled by
   *  `intensity`; built by `emptyIrradiance` and the `add…Irradiance` helpers. Absent, the probe is
   *  uniform. */
  sh?: ArrayLike<number>
}

/** The numbers a light carries, each a property whose write reaches the world at once. */
const NUMBERS = [
  'intensity',
  'distance',
  'decay',
  'angle',
  'penumbra',
  'width',
  'height',
  'radius',
  'tubeLength',
  'softRadius',
  'angularRadius',
  'shadowDistance',
] as const
type LightNumber = (typeof NUMBERS)[number]
/** The kinds placed by a direction: a sky's is its position seen from the origin. */
const AIMED = new Set(['directional', 'spot', 'hemisphere'])
const point = new Vector3()
/** The lights a page left out of the atmosphere's candidates: few, so a set and not a field each
 *  light would carry (`Light.atmosphereSun`). */
const NOT_SUN = new WeakSet<Light>()
/** The lights a page set to the atmosphere's second light (`Light.atmosphereSunIndex`): few, as the
 *  lights left out of the candidates. */
const SUN_INDEX = new WeakMap<Light, AtmosphereSunIndex>()

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
    this._values = {
      intensity: p.intensity ?? 1,
      distance: p.distance ?? 0,
      decay: p.decay ?? 2,
      angle: p.angle ?? 60 * DEG2RAD,
      penumbra: p.penumbra ?? 0,
      width: p.width ?? 10,
      height: p.height ?? 10,
      radius: p.radius ?? 0,
      tubeLength: p.tubeLength ?? 0,
      softRadius: p.softRadius ?? 0,
      angularRadius:
        p.angularRadius ?? (kind === 'directional' ? LIGHT_SETTINGS.sunAngularRadius : 0),
      shadowDistance: kind === 'directional' ? shadowDistanceOf(p.shadowDistance) : 0,
    }
    if (p.atmosphereSun === false) NOT_SUN.add(this)
    if (p.atmosphereSunIndex !== undefined) this.setSunIndex(p.atmosphereSunIndex)
    if (p.position) this.position.set(...readVec3(p.position))
    else if (AIMED.has(kind)) this.position.set(0, 1, 0)
    if (p.sh) this.sh = Array.from(p.sh)
    if (p.target) this.target.position.set(...readVec3(p.target))
    this.castShadow = p.castShadow ?? false
  }
  /** Whether a directional light may be the sun of the scene's atmosphere (`scene.atmosphere`): of
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
  private setSunIndex(value: AtmosphereSunIndex) {
    if (validateAtmosphereSunIndex(value, this.name || 'light') === 0) SUN_INDEX.delete(this)
    else SUN_INDEX.set(this, value)
  }
  /** Only a light in a world hears its colours and its target's place: out of one, they hold no
   *  reference to it, and a write reaches nothing. */
  protected override linked(inWorld: boolean) {
    const heard = (this._heard ??= () => this._link?.content(this))
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
  /** The sky's light on everything, from every direction above: the scene's atmosphere captured
   *  once and again whenever it changes, or, with no atmosphere, its background colour; its
   *  `groundColor`, black by default, is what the lower half gives. With the bounce on (the
   *  default) the sky reaches a surface only where the scene lets it, and a reflection that leaves
   *  the scene shows it; with the bounce off it lights every surface unoccluded. */
  sky: kind('sky'),
}
