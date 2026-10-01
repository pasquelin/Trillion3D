import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts';
/**
 * The host surfaces of the prepared scene, built from the material table under the rules the host
 * loader applied, so that the engine reads from them exactly what it read before
 * (`../surfaceImport.ts`, `../../scene/materialSide.ts`) and a host renderer draws them alike:
 *
 * - `unlit` is the host's basic surface, `physical` its physical one, anything else standard;
 * - a blended surface is transparent and writes no depth, a masked one cuts at `alphaTest`;
 * - the table entry already carries the tangent variant (`normalScaleY`); the variants a primitive
 *   adds — vertex colours, flat shading where it has no normal — are built per primitive kind;
 * - the physical extensions are applied under the parameter names the table writes them with.
 */
import type { TableMaterial, TableTextureSlot } from '../../../../sdk-core/src/index.ts';
import { Vector2 } from '../../../../sdk-core/src/world/math/vector2.ts';
import type { AlphaMode } from '../../../../sdk-core/src/contracts/material.ts';
import { GraphSurface } from '../graph/surface.ts';
import { type GraphTexture } from '../graph/texture.ts';
import { hostSide } from '../../scene/materialSide.ts';
import { HOST_COLOUR_SPACE_SRGB } from '../surfaceConstants.ts';
import { linearColour } from '../graph/surfaceFields.ts';

type Slot = (slot: TableTextureSlot, colorSpace?: string) => Promise<GraphTexture | null>;
type Params = Record<string, unknown>;

/** The extension maps that hold colour, and are read in sRGB. */
const COLOUR_MAPS = new Set(['sheenColorMap', 'specularColorMap']);
/** The extension factors that are colours. */
const COLOURS = new Set(['sheenColor', 'specularColor']);

/** How a surface draws its alpha mode, at open and when a page changes it
 *  (`../../world/api/materialValues.ts`): blended, it composes and writes no depth; masked, it cuts
 *  at `cutoff`; opaque, neither. */
export const alphaModeFields = (mode: AlphaMode, cutoff: number) => ({
  transparent: mode === 'blend',
  depthWrite: mode !== 'blend',
  alphaTest: mode === 'mask' ? cutoff : 0,
});

const isSlot = (value: unknown): value is TableTextureSlot =>
  typeof value === 'object' && value !== null && 'texture' in value;

/** The variant of a surface a primitive asks for: what its geometry carries. */
export type SurfaceVariant = { vertexColors: boolean; flatShading: boolean; lines?: boolean };

/** A variant's key in a cache of surfaces by variant: the open's and a created material's. */
export const variantKey = ({ vertexColors, flatShading, lines }: SurfaceVariant) =>
  `${vertexColors}:${flatShading}${lines ? ':lines' : ''}`;

/** The variant a geometry asks for: vertex colours where it has some, flat shading where it has
 *  no normal — at open (`graph.ts`) and for a created material assigned later (#847). */
export const surfaceVariantOf = (attributes: Record<string, unknown>): SurfaceVariant => ({
  vertexColors: attributes.color !== undefined,
  flatShading: attributes.normal === undefined,
});

function extensionParams(
  entry: TableMaterial,
  params: Params,
  assign: (name: string, slot: TableTextureSlot, colour?: boolean) => void,
) {
  for (const [name, value] of Object.entries(entry.extensions)) {
    if (isSlot(value)) assign(name, value, COLOUR_MAPS.has(name));
    else if (name === 'clearcoatNormalScale')
      params[name] = new Vector2(value as number, value as number);
    else if (COLOURS.has(name)) params[name] = linearColour(value as number[]);
    else params[name] = Array.isArray(value) ? [...value] : value;
  }
  // The host rebuilds the tangent frame from screen derivatives on geometry without tangents, and
  // turns the second clear-coat normal factor the way it turns the first.
  if (entry.kind === 'physical' && entry.derivativeTangents) {
    const scale = (params.clearcoatNormalScale as Vector2 | undefined) ?? new Vector2(1, 1);
    params.clearcoatNormalScale = scale.set(scale.x, -scale.y);
  }
}

/** The table rank each prepared surface was built from: the scene's own material id, which a
 *  page lists and sets by (`../../world/api/materialApi.ts`); a surface built elsewhere has none. */
const tableRanks = new WeakMap<GraphSurface, number>();
export const tableRankOf = (surface: GraphSurface) => tableRanks.get(surface);

async function build(
  materials: readonly TableMaterial[],
  rank: number,
  variant: SurfaceVariant,
  slot: Slot,
) {
  const entry = materials[rank];
  if (!Number.isSafeInteger(rank) || rank < 0 || !entry)
    throw new EngineError('INVALID_SCENE_TABLES', 'Material table rank is out of range', { rank });
  const params: Params = { color: linearColour(entry.baseColor), opacity: entry.opacity };
  const pending: Promise<void>[] = [];
  const assign = (name: string, from: TableTextureSlot | null, colour = false) => {
    if (from)
      pending.push(
        slot(from, colour ? HOST_COLOUR_SPACE_SRGB : undefined).then((texture) => {
          if (texture) params[name] = texture;
        }),
      );
  };
  assign('map', entry.map, true);
  if (entry.kind !== 'unlit') {
    params.metalness = entry.metalness;
    params.roughness = entry.roughness;
    assign('metalnessMap', entry.metalnessMap);
    assign('roughnessMap', entry.roughnessMap);
    assign('normalMap', entry.normalMap);
    params.normalScale = new Vector2(entry.normalScale, entry.normalScaleY);
    assign('aoMap', entry.aoMap);
    params.aoMapIntensity = entry.aoIntensity;
    params.emissive = linearColour(entry.emissive);
    assign('emissiveMap', entry.emissiveMap, true);
    extensionParams(entry, params, assign);
  }
  if (entry.kind === 'physical') {
    params.transmission = entry.transmission;
    params.ior = entry.ior;
    params.thickness = entry.thickness;
    params.attenuationDistance = entry.attenuationDistance || Infinity;
    params.attenuationColor = linearColour(entry.attenuationColor);
  }
  // Which frame the normal factors were written for: an engine pass that reads no tangent turns
  // the second one of a surface written for vertex tangents (`../surfaceImport.ts`).
  params.forVertexTangents = !entry.derivativeTangents;
  if (entry.doubleSided) params.side = hostSide('double');
  Object.assign(
    params,
    alphaModeFields(entry.alphaMode.toLowerCase() as AlphaMode, entry.alphaTest),
  );
  if (variant.vertexColors) params.vertexColors = true;
  if (variant.flatShading) params.flatShading = true;
  await Promise.all(pending);
  const family = variant.lines
    ? 'basic'
    : entry.kind === 'unlit'
      ? 'basic'
      : entry.kind === 'physical'
        ? 'physical'
        : 'standard';
  const material = new GraphSurface(family, params);
  if (entry.name) material.name = entry.name;
  tableRanks.set(material, rank);
  return material;
}

/**
 * The surface of each table rank in each variant, built once and shared by every primitive that
 * wears it: a record the engine holds per surface is then held once per surface.
 */
export function preparedMaterials(materials: readonly TableMaterial[], slot: Slot) {
  const built = new Map<string, Promise<GraphSurface>>();
  return (rank: number, variant: SurfaceVariant) => {
    const key = `${rank}:${variantKey(variant)}`;
    let material = built.get(key);
    if (!material) {
      material = build(materials, rank, variant, slot);
      built.set(key, material);
    }
    return material;
  };
}
