import { Object3D } from '../object/object3d.ts';
import { Color, type ColorInput } from '../math/color.ts';
import { Vector3, readVec3, type Vec3Input } from '../math/vector3.ts';
import { listen } from '../math/observed.ts';

/** What a page may pass to a light member. */
export interface LightParameters {
  /** The light's colour. */
  color?: ColorInput;
  /** How strong the light is. */
  intensity?: number;
  /** Where the light stands. */
  position?: Vec3Input;
  /** The point a directional or spot light shines at. */
  target?: Vec3Input;
  /** Whether objects in this light cast shadows. */
  castShadow?: boolean;
  /** How far a point or spot light reaches; 0 means no limit. */
  distance?: number;
  /** How fast the light fades with distance; 2 is how real light fades. */
  decay?: number;
  /** Half the opening of a spot light's cone, in radians. */
  angle?: number;
  /** How soft a spot light's edge is, from 0 (sharp) to 1. */
  penumbra?: number;
  /** The colour a hemisphere light gives from below. */
  groundColor?: ColorInput;
  /** Width of a rectangle light. */
  width?: number;
  /** Height of a rectangle light. */
  height?: number;
  /** Radius of the emitting sphere of a point or spot light: its soft shadow's size. */
  radius?: number;
  /** A probe's irradiance: 27 numbers, nine RGB spherical-harmonic coefficients in the band
   *  order of `scene/core/environment.ts`, scaled by `intensity`. Absent, the probe is uniform. */
  sh?: ArrayLike<number>;
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
] as const;
type LightNumber = (typeof NUMBERS)[number];
/** The kinds placed by a direction: a sky's is its position seen from the origin. */
const AIMED = new Set(['directional', 'spot', 'hemisphere']);
const point = new Vector3();

/**
 * A light placed in the scene. Its numbers are accessors: a write reaches the world's light
 * store at once. Directional and spot lights aim at `target`, a node of its own that the page
 * may move or parent like any other; `lookAt` moves it.
 */
export class Light extends Object3D {
  /** Always `true`: tells a light apart from any other object. */
  readonly isLight = true as const;
  /** The light's colour; change it in place with `set`. */
  readonly color: Color;
  /** A hemisphere light's colour from below. */
  readonly groundColor: Color;
  /** The node a directional or spot light shines at; move it to aim the light. */
  readonly target = new Object3D();
  /** A probe's coefficients (`LightParameters.sh`); written in place, then `needsUpdate`. */
  sh: number[] | null = null;
  readonly _values: Record<LightNumber, number>;
  /** How strong the light is; a write reaches the world at once. */
  declare intensity: number;
  /** How far a point or spot light reaches; 0 means no limit. */
  declare distance: number;
  /** How fast the light fades with distance. */
  declare decay: number;
  /** Half the opening of a spot light's cone, in radians. */
  declare angle: number;
  /** How soft a spot light's edge is, from 0 to 1. */
  declare penumbra: number;
  /** Width of a rectangle light. */
  declare width: number;
  /** Height of a rectangle light. */
  declare height: number;
  /** Radius of the emitting sphere; `emitterRadius` in the engine's store. */
  declare radius: number;

  /** Which kind of light this is: `'point'`, `'spot'`, `'directional'`… */
  readonly kind: string;
  constructor(kind: string, p: LightParameters = {}) {
    super();
    this.kind = kind;
    this.type = `${kind}Light`;
    this.color = new Color(p.color ?? 0xffffff);
    this.groundColor = new Color(p.groundColor ?? 0x000000);
    this._values = {
      intensity: p.intensity ?? 1,
      distance: p.distance ?? 0,
      decay: p.decay ?? 2,
      angle: p.angle ?? Math.PI / 3,
      penumbra: p.penumbra ?? 0,
      width: p.width ?? 10,
      height: p.height ?? 10,
      radius: p.radius ?? 0,
    };
    const content = () => this._link?.content(this);
    listen(this.color, content);
    listen(this.groundColor, content);
    listen(this.target.position, content);
    if (p.position) this.position.set(...readVec3(p.position));
    else if (AIMED.has(kind)) this.position.set(0, 1, 0);
    if (p.sh) this.sh = Array.from(p.sh);
    if (p.target) this.target.position.set(...readVec3(p.target));
    this.castShadow = p.castShadow ?? false;
  }
  protected override get looksDownNegativeZ() {
    return true;
  }
  protected override blank(): this {
    return new Light(this.kind) as this;
  }
  /** Takes `source`'s node values and, from a light, its numbers, colours, coefficients and aim;
   *  its own `kind` stays. */
  override copy(source: Object3D, recursive = true) {
    super.copy(source, recursive);
    if (!(source instanceof Light)) return this;
    (this as { _values: Light['_values'] })._values = { ...source._values };
    this.color.copy(source.color);
    this.groundColor.copy(source.groundColor);
    this.sh = source.sh && [...source.sh];
    this.target.position.copy(source.target.position);
    this._link?.content(this);
    return this;
  }
  /** `light.needsUpdate = true` after writing `sh` in place: the world reads it again. */
  set needsUpdate(_value: boolean) {
    this._link?.content(this);
  }
  get needsUpdate() {
    return false;
  }
  /** Aims the light at a world point: a directional or spot light moves its `target` there — its
   *  direction reads from it —, and the node turns too, which is what a rectangle faces by. */
  override lookAt(x: number | { x: number; y: number; z: number }, y = 0, z = 0) {
    super.lookAt(x, y, z);
    if (typeof x === 'number') point.set(x, y, z);
    else point.set(x.x, x.y, x.z);
    this.target.parent?.worldToLocal(point);
    this.target.position.copy(point);
  }
}

for (const name of NUMBERS)
  Object.defineProperty(Light.prototype, name, {
    get(this: Light) {
      return this._values[name];
    },
    set(this: Light, value: number) {
      this._values[name] = value;
      this._link?.content(this);
    },
  });

/** A member building one kind of light. */
const kind = (name: string) => (p?: LightParameters) => new Light(name, p);
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
};
