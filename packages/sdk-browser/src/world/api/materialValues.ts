/** The values of a scene material a page reads and sets, and how they cross a host surface
 *  (`materialApi.ts`). */
import { EngineError, type Material } from '../../../../sdk-core/src/index.ts';
import { alphaModeOf, type AlphaMode } from '../../../../sdk-core/src/contracts/material.ts';
import type { Color } from '../../../../sdk-core/src/world/math/color.ts';
import type { GraphSurface } from '../../host/graph/surface.ts';
import { materialTextures } from '../../scene/meshes.ts';
import { sideOf } from '../../scene/materialSide.ts';
import { importHostSurface } from '../../host/surfaceImport.ts';
import { hostTextureWritten } from '../../host/textureImport.ts';
import { alphaModeFields } from '../../host/prepared/materials.ts';

/** The cutoff a material turned masked takes when the page names none: glTF's default. */
export const MASK_CUTOFF = 0.5;

/** A material of the scene as a page reads it: the engine's parameters, the id it is set by — its
 *  rank in the cache's material table — its name, and how many times its maps repeat across and
 *  up, `null` for a material without a map. */
export interface SceneMaterial extends Material {
  /** String rank in the imported material table, or a page-created ID. */
  readonly id: string;
  /** Source or page label for the material. */
  name: string;
  /** Map repetitions across and up, or null when the material has no map. */
  tiling: readonly [number, number] | null;
}

/** What `setMaterial` writes live: the values the frame reads, nothing that rebuilds a pass. */
export type SceneMaterialPatch = Partial<
  Pick<
    SceneMaterial,
    'baseColor' | 'opacity' | 'metalness' | 'roughness' | 'emissive' | 'alphaMode' | 'alphaCutoff'
  > & {
    /** Map repetitions across and up. */
    tiling: readonly [number, number];
  }
>;

/** A material as the engine draws it now, read where every engine path reads a host surface
 *  (`importHostSurface`), so a family without metal or glow lists what is drawn. */
export function read(id: number | string, surface: GraphSurface): SceneMaterial {
  const drawn = importHostSurface(surface)!;
  const map = materialTextures(surface).next().value;
  return {
    id: String(id),
    name: surface.name,
    baseColor: drawn.baseColor,
    opacity: surface.opacity,
    metalness: drawn.metalness,
    roughness: drawn.roughness,
    emissive: drawn.emissive,
    side: sideOf(surface),
    alphaMode: alphaModeOf(surface),
    alphaCutoff: drawn.alphaTest,
    tiling: map ? [map.repeat.x, map.repeat.y] : null,
  };
}

export const invalid = (id: number | string, field: string, value: unknown) =>
  new EngineError('INVALID_MATERIAL', `material ${id}: ${field} is out of its range`, {
    id,
    field,
    value,
  });

/** What `setMaterial` takes, anything else refused by name. */
export const PATCH_FIELDS = [
  'baseColor',
  'opacity',
  'metalness',
  'roughness',
  'emissive',
  'alphaMode',
  'alphaCutoff',
  'tiling',
] as const;

/** Every value of the patch one of `fields` and in its range, or a named refusal before anything
 *  is written: a page in plain JavaScript can name what the types do not. */
export function validate(
  id: number | string,
  patch: SceneMaterialPatch,
  fields: readonly string[] = PATCH_FIELDS,
) {
  for (const [field, value] of Object.entries(patch))
    if (value !== undefined && !fields.includes(field)) throw invalid(id, field, value);
  const unit = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
  for (const field of ['opacity', 'metalness', 'roughness', 'alphaCutoff'] as const) {
    const value = patch[field];
    if (value !== undefined && !unit(value)) throw invalid(id, field, value);
  }
  // An unknown mode would be written as an opaque surface (`alphaModeFields`), refused instead.
  const mode = patch.alphaMode;
  if (mode !== undefined && !['opaque', 'mask', 'blend'].includes(mode))
    throw invalid(id, 'alphaMode', mode);
  const vector = (
    field: 'baseColor' | 'emissive' | 'tiling',
    size: number,
    ok: (n: number) => boolean,
  ) => {
    const value = patch[field];
    if (value && !(value.length === size && value.every(ok))) throw invalid(id, field, value);
  };
  vector('baseColor', 3, unit);
  vector('emissive', 3, (n) => Number.isFinite(n) && n >= 0);
  vector('tiling', 2, (n) => Number.isFinite(n) && n !== 0);
}

/** Writes the patch into one surface in place — drawn in alpha mode `mode` from now on when its
 *  alpha moved — and bumps its version: every reader takes it again at its next read, as a World's
 *  live edit does (`../core/worldSurface.ts`, #335). */
export function write(surface: GraphSurface, patch: SceneMaterialPatch, mode?: AlphaMode) {
  if (patch.baseColor) (surface.color as Color).setRGB(...patch.baseColor);
  if (patch.opacity !== undefined) surface.opacity = patch.opacity;
  if (patch.metalness !== undefined && typeof surface.metalness === 'number')
    surface.metalness = patch.metalness;
  if (patch.roughness !== undefined && typeof surface.roughness === 'number')
    surface.roughness = patch.roughness;
  if (patch.emissive && surface.emissive) {
    (surface.emissive as Color).setRGB(...patch.emissive);
    surface.emissiveIntensity = 1;
  }
  // As the open draws a table entry: the cutoff kept, or the page's, or glTF's for a new cutout.
  const cutoff = patch.alphaCutoff ?? (surface.alphaTest || MASK_CUTOFF);
  if (mode) Object.assign(surface, alphaModeFields(mode, cutoff));
  if (patch.tiling) {
    for (const texture of materialTextures(surface)) texture.repeat.set(...patch.tiling);
    // A placement is followed only once a write is announced: unsaid, no engine would see it.
    hostTextureWritten();
  }
  surface.needsUpdate = true;
}
