import type { SceneLight } from '../../scene/light/contracts.ts';
import { Object3D } from '../object/object3d.ts';
import { Color, type ColorInput } from '../math/color.ts';
import { Vector3, readVec3, type Vec3Input } from '../math/vector3.ts';
import { listen } from '../math/observed.ts';

/** What a page may pass to a light member. */
export interface LightParameters {
  color?: ColorInput;
  intensity?: number;
  position?: Vec3Input;
  target?: Vec3Input;
  castShadow?: boolean;
  distance?: number;
  decay?: number;
  angle?: number;
  penumbra?: number;
  groundColor?: ColorInput;
  width?: number;
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
  readonly isLight = true as const;
  readonly color: Color;
  readonly groundColor: Color;
  readonly target = new Object3D();
  /** A probe's coefficients (`LightParameters.sh`); written in place, then `needsUpdate`. */
  sh: number[] | null = null;
  readonly _values: Record<LightNumber, number>;
  declare intensity: number;
  declare distance: number;
  declare decay: number;
  declare angle: number;
  declare penumbra: number;
  declare width: number;
  declare height: number;
  /** Radius of the emitting sphere; `emitterRadius` in the engine's store. */
  declare radius: number;

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

/**
 * The node of a lamp the engine's store describes — a light the source file carried — which a
 * page then edits, moves or removes like one of its own: same kind, colour, intensity, range and
 * cone, its target one unit along its direction.
 */
export function lightFromRecord(record: SceneLight): Light {
  const along = record.direction ?? [0, -1, 0];
  const at = record.position ?? [-along[0], -along[1], -along[2]];
  const node = new Light(record.kind === 'rect' ? 'rectArea' : record.kind, {
    width: record.size?.[0],
    height: record.size?.[1],
    color: record.color,
    intensity: record.intensity,
    castShadow: record.castsShadow,
    position: at,
    target: [at[0] + along[0], at[1] + along[1], at[2] + along[2]],
    distance: record.range,
    angle: record.coneAngle,
    penumbra: record.penumbra,
    radius: record.emitterRadius,
  });
  node.name = record.id;
  return node;
}

/** The `light` family: each kind placed as a node of the scene. */
const kind = (name: string) => (p?: LightParameters) => new Light(name, p);
export const light = {
  ambient: kind('ambient'),
  directional: kind('directional'),
  point: kind('point'),
  spot: kind('spot'),
  hemisphere: kind('hemisphere'),
  rectArea: kind('rectArea'),
  probe: kind('probe'),
};
