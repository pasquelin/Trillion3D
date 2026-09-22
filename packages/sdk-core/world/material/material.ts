import type { Material as EngineMaterial } from '../../materialContract.ts';
import { Color, type ColorInput } from '../math/color.ts';
import { listen } from '../math/observed.ts';
import type { Blending, Side } from '../constants/index.ts';

/** What a page may pass to a material member; every field is optional. */
export interface MaterialParameters {
  color?: ColorInput;
  emissive?: ColorInput;
  emissiveIntensity?: number;
  metalness?: number;
  roughness?: number;
  shininess?: number;
  opacity?: number;
  transparent?: boolean;
  side?: Side;
  blending?: Blending;
  alphaTest?: number;
  transmission?: number;
  ior?: number;
  thickness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  sheen?: number;
  iridescence?: number;
  wireframe?: boolean;
  flatShading?: boolean;
  size?: number;
  sizeAttenuation?: boolean;
  linewidth?: number;
  dashSize?: number;
  gapSize?: number;
  vertexColors?: boolean;
  depthWrite?: boolean;
  depthTest?: boolean;
  [param: string]: unknown;
}

/** The fields whose value is a colour: written through `Color`, whatever the page passes. */
const COLOURS = new Set(['color', 'emissive', 'specular', 'sheenColor', 'attenuationColor']);
/** The fields that are the material's own bookkeeping, never a parameter a copy carries. */
const OWN = new Set(['isMaterial', 'kind', 'version', '_listeners', 'heard']);

/**
 * The matter alone: the parameters of one material kind. The engine lights every kind with its
 * one surface model (`materialContract.ts`); `surface()` is how a kind reads in that model. Any
 * write — a field, a colour, `needsUpdate` — reaches the meshes that wear it.
 */
export class Material {
  readonly isMaterial = true as const;
  color = new Color(0xffffff);
  emissive = new Color(0x000000);
  emissiveIntensity = 1;
  metalness = 0;
  roughness = 1;
  opacity = 1;
  transparent = false;
  side: Side = 'front';
  blending: Blending = 'normal';
  alphaTest = 0;
  vertexColors = false;
  depthWrite = true;
  depthTest = true;
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
    if (COLOURS.has(key) && !(value instanceof Color)) {
      const current = this[key];
      if (current instanceof Color) current.set(value as ColorInput);
      else this[key] = new Color(value as ColorInput);
    } else this[key] = value;
    // A texture this material samples is heard like the material itself.
    const sampled = value as { isTexture?: boolean; _listeners?: Set<() => void> } | null;
    if (sampled?.isTexture) sampled._listeners?.add(this.heard);
  }
  /** `material.needsUpdate = true`: the meshes wearing it are repainted. */
  set needsUpdate(_value: boolean) {}
  get needsUpdate() {
    return false;
  }
  /** The engine's physical surface record of this material (`materialContract.ts`). A kind
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
      alphaMode: this.transparent ? 'blend' : this.alphaTest > 0 ? 'mask' : 'opaque',
      alphaCutoff: this.alphaTest,
    };
  }
  clone() {
    const parameters: MaterialParameters = {};
    for (const [key, value] of Object.entries(this))
      if (!OWN.has(key)) parameters[key] = value instanceof Color ? value.clone() : value;
    return new Material(this.kind, parameters);
  }
  /** Forgets the wearers: a disposed material repaints nobody. */
  dispose() {
    this._listeners.clear();
  }
}
