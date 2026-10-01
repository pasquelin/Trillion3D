import type { PhysicsMaterialPreset } from '../../physics/options.ts';
import type { MaterialParameters } from './materialParameters.ts';
export type { MaterialParameters } from './materialParameters.ts';
import { alphaModeOf, type Material as EngineMaterial } from '../../contracts/material.ts';
import { Color, type ColorInput } from '../math/color.ts';
import { listen, unlisten } from '../math/observed.ts';
import type { Blending, Side } from '../constants/index.ts';

/** The fields whose value is a colour: written through `Color`, whatever the page passes. */
const COLOURS = new Set([
  'color',
  'emissive',
  'specular',
  'sheenColor',
  'attenuationColor',
  'subsurfaceColor',
]);
/** A value that may be heard: a texture keeps its hearers in `_listeners`. */
type Heard = { isTexture?: boolean; _listeners?: Set<() => void> };
/** The fields that are a material's bookkeeping, never one of its parameters. */
export const MATERIAL_BOOKKEEPING: ReadonlySet<string> = new Set([
  'isMaterial',
  'version',
  '_listeners',
  'heard',
]);

/**
 * The matter alone: the parameters of one material kind. The engine lights every kind with its
 * one surface model (`contracts/material.ts`); `surface()` is how a kind reads in that model. Any
 * write — a field, a colour, `needsUpdate` — reaches the meshes that wear it.
 */
export class Material {
  /** Always `true`: tells a material apart from anything else. */
  readonly isMaterial = true as const;
  /** The base colour; change it in place with `set`. */
  color = new Color(0xffffff);
  /** The colour the surface gives off by itself. */
  emissive = new Color(0x000000);
  /** How strongly the surface glows. */
  emissiveIntensity = 1;
  /** Diffuse transmission tint of thin double-sided matter; black disables it. */
  subsurfaceColor = new Color(0x000000);
  /** How much the surface is metal, 0 to 1. */
  metalness = 0;
  /** How rough the surface is, 0 (mirror) to 1 (matte). */
  roughness = 1;
  /** How opaque the surface is, 0 to 1. */
  opacity = 1;
  /** Whether `opacity` lets what is behind show through. */
  transparent = false;
  /** Which faces are drawn: `'front'`, `'back'` or `'double'`. */
  side: Side = 'front';
  /** How the surface mixes with what is behind it. */
  blending: Blending = 'normal';
  /** Pixels less opaque than this are dropped. */
  alphaTest = 0;
  /** Whether the geometry's per-vertex colours tint the surface. */
  vertexColors = false;
  /** Whether the surface writes its depth. */
  depthWrite = true;
  /** Whether the surface hides behind closer things. */ depthTest = true;
  /** Whether a see-through (`transparent`) surface still casts a shadow, paler the more see-through it is. */ transparentShadow = false;
  /** Physics matter preset of the bodies wearing it. */ declare physics?: PhysicsMaterialPreset;
  /** kg/m³, for a body's mass. */ declare density?: number;
  /** Physics friction. */ declare friction?: number;
  /** Physics restitution. */ declare restitution?: number;
  /** Bumped by every write: what the world compares to repaint. */
  version = 0;
  /** Who wears this material: every mesh holding it hears its writes. */
  readonly _listeners = new Set<() => void>();
  [param: string]: unknown;
  /** Tells every wearer this material changed. */
  private readonly heard = () => {
    this.version++;
    for (const listener of this._listeners) listener();
  };

  /** The kind the material was made as: `'meshStandard'`, `'meshBasic'`… */
  readonly kind: string;
  constructor(
    kind: string,
    parameters: MaterialParameters = {},
    defaults: Partial<MaterialParameters> = {},
  ) {
    this.kind = kind;
    const changed = this.heard;
    listen(this.color, changed);
    listen(this.emissive, changed);
    listen(this.subsurfaceColor, changed);
    for (const [key, value] of Object.entries({ ...defaults, ...parameters }))
      if (value !== undefined) this.assign(key, value);
    // Every field written from here on is a change the meshes wearing it must see.
    return new Proxy(this, {
      set(target, key, value) {
        if (typeof key === 'string' && key !== 'version') target.assign(key, value);
        else Reflect.set(target, key, value);
        if (key !== 'version') changed();
        return true;
      },
    });
  }
  private assign(key: string, value: unknown) {
    const current = this[key];
    if (COLOURS.has(key) && !(value instanceof Color)) {
      // A colour written as a value: into the held `Color`, or a new one heard like the others.
      if (current instanceof Color) current.set(value as ColorInput);
      else listen((this[key] = new Color(value as ColorInput)), this.heard);
      return;
    }
    if (current !== value) this.release(key, current);
    this[key] = value;
    // A colour or a texture this material holds is heard like the material itself.
    if (COLOURS.has(key)) listen(value as Color, this.heard);
    const sampled = value as Heard | null;
    if (sampled?.isTexture) sampled._listeners?.add(this.heard);
  }
  /** Stops hearing what `key` held, unless another field of this material still holds it. */
  private release(key: string, held: unknown) {
    const texture = (held as Heard | null)?.isTexture;
    if (!(held instanceof Color) && !texture) return;
    for (const other in this) if (other !== key && this[other] === held) return;
    if (held instanceof Color) unlisten(held, this.heard);
    else (held as Heard)._listeners?.delete(this.heard);
  }
  /** `material.needsUpdate = true`: the meshes wearing it are repainted. */
  set needsUpdate(_value: boolean) {}
  get needsUpdate() {
    return false;
  }
  /** The engine's physical surface record of this material (`contracts/material.ts`). A kind
   *  outside the physical family is drawn through the host family of its name, which the engine
   *  maps onto its one lighting model (`surfaceModel.ts`). */
  surface(): EngineMaterial {
    const emitted = this.emissive.toArray().map((c) => c * this.emissiveIntensity);
    return {
      baseColor: this.color.toArray(),
      emissive: emitted as [number, number, number],
      opacity: this.opacity,
      metalness: this.metalness,
      roughness: this.roughness,
      side: this.side,
      alphaMode: alphaModeOf(this),
      alphaCutoff: this.alphaTest,
    };
  }
  /** A new material of the same kind, with the same values. */
  clone() {
    const parameters: MaterialParameters = {};
    for (const [key, value] of Object.entries(this))
      if (key !== 'kind' && !MATERIAL_BOOKKEEPING.has(key))
        parameters[key] = value instanceof Color ? value.clone() : value;
    return new Material(this.kind, parameters);
  }
  /** Forgets the wearers: a disposed material repaints nobody. */
  dispose() {
    this._listeners.clear();
  }
}
