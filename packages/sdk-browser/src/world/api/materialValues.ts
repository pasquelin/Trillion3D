/** The values of a scene material a page reads and sets, and how they cross its surface record
 *  (`materialApi.ts`). */
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import {
  type Material,
  alphaModeOf,
  type AlphaMode,
} from '../../../../sdk-core/src/contracts/material.ts'

import type { PageSurface } from '../../page/surface.ts'
import { surfaceWritten } from '../../page/surfaceWrites.ts'
import { materialTextures } from '../../scene/meshes.ts'
import { metalRoughFamily } from '../../scene/surfaceModel.ts'
import { alphaModeFields } from '../../host/prepared/materials.ts'

/** The cutoff a material turned masked takes when the page names none: glTF's default. */
export const MASK_CUTOFF = 0.5

/** A material of the scene as a page reads it: the engine's parameters, the id it is set by — its
 *  rank in the cache's material table — its name, and how many times its maps repeat across and
 *  up, `null` for a material without a map. */
export interface SceneMaterial extends Material {
  /** String rank in the imported material table, or a page-created ID. */
  readonly id: string
  /** Source or page label for the material. */
  name: string
  /** Map repetitions across and up, or null when the material has no map. */
  tiling: readonly [number, number] | null
}

/** What `setMaterial` writes live: the values the frame reads, nothing that rebuilds a pass. */
export type SceneMaterialPatch = Partial<
  Pick<
    SceneMaterial,
    'baseColor' | 'opacity' | 'metalness' | 'roughness' | 'emissive' | 'alphaMode' | 'alphaCutoff'
  > & {
    /** Map repetitions across and up. */
    tiling: readonly [number, number]
  }
>

/** A material as the engine draws it now, read off the surface record every engine path reads,
 *  so a family without metal or glow lists what is drawn; its colours are copies. */
export function read(id: number | string, surface: PageSurface): SceneMaterial {
  const map = materialTextures(surface).next().value
  return {
    id: String(id),
    name: surface.name,
    baseColor: [...surface.baseColor],
    opacity: surface.opacity,
    metalness: surface.metalness,
    roughness: surface.roughness,
    emissive: [...surface.emissive],
    side: surface.side,
    alphaMode: alphaModeOf(surface),
    alphaCutoff: surface.alphaTest,
    tiling: map ? [map.repeat.x, map.repeat.y] : null,
  }
}

export const invalid = (id: number | string, field: string, value: unknown) =>
  new EngineError('INVALID_MATERIAL', `material ${id}: ${field} is out of its range`, {
    id,
    field,
    value,
  })

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
] as const

/** Every value of the patch one of `fields` and in its range, or a named refusal before anything
 *  is written: a page in plain JavaScript can name what the types do not. */
export function validate(
  id: number | string,
  patch: SceneMaterialPatch,
  fields: readonly string[] = PATCH_FIELDS,
) {
  for (const [field, value] of Object.entries(patch))
    if (value !== undefined && !fields.includes(field)) throw invalid(id, field, value)
  const unit = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1
  for (const field of ['opacity', 'metalness', 'roughness', 'alphaCutoff'] as const) {
    const value = patch[field]
    if (value !== undefined && !unit(value)) throw invalid(id, field, value)
  }
  // An unknown mode would be written as an opaque surface (`alphaModeFields`), refused instead.
  const mode = patch.alphaMode
  if (mode !== undefined && !['opaque', 'mask', 'blend'].includes(mode))
    throw invalid(id, 'alphaMode', mode)
  const vector = (
    field: 'baseColor' | 'emissive' | 'tiling',
    size: number,
    ok: (n: number) => boolean,
  ) => {
    const value = patch[field]
    if (value && !(value.length === size && value.every(ok))) throw invalid(id, field, value)
  }
  vector('baseColor', 3, unit)
  vector('emissive', 3, (n) => Number.isFinite(n) && n >= 0)
  vector('tiling', 2, (n) => Number.isFinite(n) && n !== 0)
}

/** Writes the patch into one surface record in place — drawn in alpha mode `mode` from now on
 *  when its alpha moved — and journals it: every reader takes it at its next read, as a World's
 *  live edit does (`../core/worldSurface.ts`). A family without metal or glow keeps neither;
 *  colours are new arrays, never written into ones a variant shares. */
export function write(surface: PageSurface, patch: SceneMaterialPatch, mode?: AlphaMode) {
  const metalRough = metalRoughFamily(surface.family)
  if (patch.baseColor) surface.baseColor = [...patch.baseColor]
  if (patch.opacity !== undefined) surface.opacity = patch.opacity
  if (patch.metalness !== undefined && metalRough) surface.metalness = patch.metalness
  if (patch.roughness !== undefined && metalRough) surface.roughness = patch.roughness
  if (patch.emissive && surface.lit) surface.emissive = [...patch.emissive]
  // As the open draws a table entry: the cutoff kept, or the page's, or glTF's for a new cutout.
  const cutoff = patch.alphaCutoff ?? (surface.alphaTest || MASK_CUTOFF)
  if (mode) Object.assign(surface, alphaModeFields(mode, cutoff))
  // A placement written on the record itself: every consumer's journal hears it. The record is
  // shared by the material's variants and may fill several slots: placed once, not once a wearer.
  const tiling = patch.tiling
  if (tiling)
    for (const { repeat } of materialTextures(surface))
      if (repeat.x !== tiling[0] || repeat.y !== tiling[1]) repeat.set(...tiling)
  surfaceWritten(surface)
}
