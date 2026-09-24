/**
 * THE SURFACES OF THE ENGINE'S OWN GRAPH: a surface of one of the families a scene or a
 * world declares.
 *
 * The shapes are those the engine reads (`../resources.ts`, `../shadedMaterial.ts`,
 * `../../scene/physicalMaterialGate.ts`): every field the import, the admission gate and the
 * surface record read is present, at the value the reference holds when a scene leaves it
 * unsaid, so a field is never read as missing where the reference had a default. The constants
 * are the engine's named ones (`../surfaceConstants.ts`); the colours and vectors the core's.
 */
import { Color } from '../../../../sdk-core/src/world/math/color.ts';
import { Vector2 } from '../../../../sdk-core/src/world/math/vector2.ts';
import { Releasable, identity } from './resource.ts';
import { coloured, extensions, glow, metalRough, raster, relief } from './surfaceFields.ts';

/**
 * The families a surface is declared in: a scene's unlit, standard and physical ones, and the
 * others a world draws — each with the fields the reference gives it. The surface model reads the
 * family itself (`../../scene/surfaceModel.ts`).
 */
const FAMILIES = {
  basic: { fields: [coloured] },
  standard: {
    fields: [coloured, glow, relief, metalRough],
  },
  physical: {
    fields: [coloured, glow, relief, metalRough, extensions],
  },
  lambert: {
    fields: [coloured, glow, relief],
  },
  phong: {
    fields: [coloured, glow, relief, () => ({ specular: new Color(0x111111), shininess: 30 })],
  },
  toon: {
    fields: [coloured, glow, relief, () => ({ gradientMap: null })],
  },
  normal: { fields: [relief] },
  matcap: {
    fields: [coloured, relief, () => ({ matcap: null })],
  },
  depth: {
    fields: [() => ({ map: null, alphaMap: null, displacementMap: null, wireframe: false })],
  },
} as const;

/** The families a surface is declared in. */
export type GraphSurfaceFamily = keyof typeof FAMILIES;

/** A value written into a surface: a colour or a vector is copied into the one it holds. */
function assign(surface: GraphSurface, key: string, value: unknown) {
  const held = surface[key] as { isColor?: boolean; isVector2?: boolean } | undefined;
  const given = value as { r: number; g: number; b: number; x: number; y: number };
  if (held?.isColor && value) (held as Color).setRGB(given.r, given.g, given.b);
  else if (held?.isVector2 && value) (held as Vector2).set(given.x, given.y);
  else surface[key] = value;
}

/**
 * A surface: the parameters of one family, at the reference's values unless the scene said
 * otherwise. Its version is bumped by `needsUpdate`, which every reader compares.
 */
export class GraphSurface extends Releasable {
  /** A name unique to the surface. */
  readonly uuid = identity('surface');
  /** Its name. */
  name = '';
  /** Bumped by every declared change. */
  version = 0;
  /** Free room for the data of whoever built the surface. */
  userData: Record<string, unknown> = {};
  /** What the resource is; `family` says which surface. */
  readonly kind = 'surface' as const;
  // The raster state every family carries, set by `raster` at the reference's values.
  /** Whether it is drawn. */
  declare visible: boolean;
  /** Which faces, as the host's constant. */
  declare side: number;
  /** The host draws a double-sided transparent surface in one pass instead of back then front. */
  declare forceSinglePass: boolean;
  /** Whether vertex colours tint it. */
  declare vertexColors: boolean;
  /** Whether the display curve applies. */
  declare toneMapped: boolean;
  /** Whether it tests depth. */
  declare depthTest: boolean;
  /** Whether it writes depth. */
  declare depthWrite: boolean;
  /** The depth test's comparison. */
  declare depthFunc: number;
  /** Whether it writes colour. */
  declare colorWrite: boolean;
  /** Whether depth is offset. */
  declare polygonOffset: boolean;
  /** Slope part of the offset. */
  declare polygonOffsetFactor: number;
  /** Constant part of the offset. */
  declare polygonOffsetUnits: number;
  /** Whether it blends. */
  declare transparent: boolean;
  /** How opaque it is. */
  declare opacity: number;
  /** Alpha below which pixels drop. */
  declare alphaTest: number;
  [field: string]: unknown;
  /** The family it belongs to. */
  readonly family: GraphSurfaceFamily;
  constructor(family: GraphSurfaceFamily, parameters: Record<string, unknown> = {}) {
    super();
    this.family = family;
    const declared = FAMILIES[family];
    Object.assign(this, raster());
    for (const fields of declared.fields) Object.assign(this, fields());
    for (const [key, value] of Object.entries(parameters))
      if (value !== undefined) assign(this, key, value);
  }
  /** `needsUpdate = true` after a change: every reader takes the fields again. */
  set needsUpdate(value: boolean) {
    if (value) this.version++;
  }
  get needsUpdate() {
    return false;
  }
  /** Takes every parameter of `source`, colours and vectors copied, textures shared. */
  copy(source: GraphSurface) {
    for (const [key, value] of Object.entries(source))
      if (!SKIPPED.has(key)) assign(this, key, Array.isArray(value) ? value.slice() : value);
    return this;
  }
  /** A surface of the same family with the same parameters. */
  clone() {
    return new GraphSurface(this.family).copy(this);
  }
}

/** The fields a copy leaves as they are: identity, bookkeeping, family. */
const SKIPPED = new Set(['uuid', 'version', 'released', 'kind', 'family', 'userData']);
