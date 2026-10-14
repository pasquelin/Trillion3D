/**
 * WHAT A WRITE OF A WORLD MATERIAL REPAINTS IN PLACE: the key that tells a value from a field the
 * session lays out, and the writes into the entry and the surfaces built from it
 * (`worldMaterials.ts`).
 */
import {
  MATERIAL_BOOKKEEPING,
  type Material,
} from '../../../../sdk-core/src/world/material/material.ts'
import { Color } from '../../../../sdk-core/src/world/math/color.ts'
import type { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { composesWithBackground } from '../../scene/materialBlending.ts'
import { alphaModeOf } from '../../../../sdk-core/src/contracts/material.ts'
import { alphaMoves, type AlphaChange } from '../../placement/engineSceneUpdates.ts'
import type { PageSurface } from '../../page/surface.ts'
import { RANK_READINGS, repaintHostSurface } from './worldSurface.ts'
import type { MaterialEntry, MaterialsState, Repaint, RepaintedEntry } from './worldMaterials.ts'

/** The parameters a session lays out when it opens, and so the only ones never written in place:
 *  `kind` its family, `transparent`, `blending` and `transmission` its pass, `side`, `depthTest`
 *  and `depthWrite` its pipeline, `vertexColors` which surface its wearers take, `transparentShadow`
 *  its shadow pass, `sizeAttenuation` a sprite's root mark (`spriteMark`), and `wireframe`,
 *  `flatShading` and `size` the triangles its wearers draw (`worldCuts.ts`). Every other field
 *  but a texture is a VALUE — a colour, a factor, a physical extension, a cutoff —, which a
 *  page-table row or a host surface reads again at the next frame (#335, #572); a texture's
 *  pictures, sampling and placement move on their own (#362). */
const LAYOUT = new Set([
  'kind',
  'transparent',
  'blending',
  'transmission',
  'side',
  'depthTest',
  'depthWrite',
  'vertexColors',
  'transparentShadow',
  'sizeAttenuation',
  'wireframe',
  'flatShading',
  'size',
])

/** Whether `material`'s field `name` is a value, written in place: neither bookkeeping, nor
 *  `LAYOUT`, nor a texture. */
const isValue = (material: Material, name: string) =>
  !MATERIAL_BOOKKEEPING.has(name) &&
  !LAYOUT.has(name) &&
  !(material[name] as { isTexture?: boolean } | null)?.isTexture

/** One parameter value as a key: a texture by identity and its three counters — its picture's
 *  `version` left out when `pictures` is false —, a colour or a vector by its numbers, anything
 *  else by its own value. */
function valueKey(value: unknown, pictures = true): string {
  if (value === null || typeof value !== 'object') return String(value)
  const shaped = value as Partial<Texture> & { isTexture?: boolean }
  if (shaped.isTexture) {
    const version = pictures ? shaped.version : ''
    return `texture:${shaped.id}@${version}.${shaped.sampling}.${shaped.placement}`
  }
  if (Array.isArray(value)) return `[${value.map((each) => valueKey(each, pictures)).join(',')}]`
  const numbers = Object.entries(value).filter(([, field]) => typeof field === 'number')
  return `{${numbers.map(([name, field]) => `${name}:${field}`).join(',')}}`
}

/** The material's parameters as one string, by name; `values` false leaves the value fields out,
 *  which is what two materials must share for one to be repainted into the other's entry;
 *  `pictures` false leaves out what its textures' pictures are at. */
export function materialKey(material: Material, values = true, pictures = true) {
  const fields = Object.keys(material)
    .filter((name) => !MATERIAL_BOOKKEEPING.has(name) && (values || !isValue(material, name)))
    .sort()
    .map((name) => `${name}=${valueKey(material[name], pictures)}`)
  return fields.join(';')
}

/** A surface drawn by the opaque passes, where a value is read from the row at every frame; a
 *  blended or transmissive one is laid out in its forward pass when the session opens, and so is
 *  one whose blending mode composes with the background, whatever `transparent` says. */
const opaque = (material: Material) =>
  !material.transparent &&
  !composesWithBackground(material.blending) &&
  !((material.transmission as number | undefined) ?? 0)

/** Writes `material`'s values into its sole entry, when nothing but values changed. */
function repaintValues({ sources }: MaterialsState, material: Material, entry: MaterialEntry) {
  const only = sources.get(entry)
  if (only?.size !== 1 || !only.has(material)) return false
  if (!opaque(material) || !opaque(entry.material)) return false
  if (materialKey(material, false) !== materialKey(entry.material, false)) return false
  // Only the fields the material holds: a kind never gains a field it does not declare.
  for (const field of Object.keys(material)) {
    if (!isValue(material, field)) continue
    const value = material[field],
      into = entry.material[field]
    // A colour the entry does not hold yet — a specular written after it was made — is a copy.
    if (value instanceof Color && into instanceof Color) into.copy(value)
    else entry.material[field] = value instanceof Color ? value.clone() : value
  }
  return true
}

/** Keeps `material` on its entry under its new key, when only values changed, or only the
 *  pictures of its textures — which the entry's copy shares, so every wearer sees them, blended
 *  or shared: a video's frame, a canvas redrawn (#362). */
export function repaint(
  state: MaterialsState,
  material: Material,
  entry: MaterialEntry,
  key: string,
) {
  const { entries, repainted } = state
  if (entries.has(key)) return false
  const pictures = materialKey(material, true, false) === materialKey(entry.material, true, false)
  const { alphaTest } = entry.material,
    from = alphaModeOf(entry.material)
  if (!pictures && !repaintValues(state, material, entry)) return false
  entries.delete(entry.key)
  entries.set((entry.key = key), entry)
  const before = repainted.get(entry),
    done: Repaint = { values: !pictures || !!before?.values }
  const to = alphaModeOf(entry.material)
  // Between opaque and masked, or a cutout's cutoff: what its shadow reads (`AlphaChange`).
  if (before?.alpha || alphaMoves(from, to, entry.material.alphaTest !== alphaTest))
    done.alpha = { from: before?.alpha?.from ?? from, to }
  repainted.set(entry, done)
  return true
}

/** How a session reads repainted surfaces again (`EngineSceneUpdates.refreshMaterials`). */
export type Refresh = (values: boolean, alpha?: AlphaChange) => boolean

/** Declares the surfaces of the entries whose values were written again, then has `refresh` read
 *  every repainted entry's surfaces again (`createWorldMaterials.repaint`). */
export function repaintSurfaces(painted: readonly RepaintedEntry[], refresh?: Refresh) {
  let written = false,
    values = false
  const moved = new Map<string, AlphaChange & { surfaces: PageSurface[] }>()
  for (const { entry, alpha, values: wrote } of painted) {
    const worn: PageSurface[] = []
    entry.surfaces.forEach((plain, rank) => {
      if (!plain) return
      for (const surface of [plain, ...(entry.variants[rank]?.values() ?? [])]) {
        // Pictures alone: the surface holds the texture records themselves, which journal their
        // own writes; declaring it again would journal a surface whose values did not move.
        if (wrote) repaintHostSurface(surface, entry.material, RANK_READINGS[rank])
        worn.push(surface)
      }
    })
    if (!worn.length) continue
    written = true
    values ||= wrote
    if (!alpha) continue
    const way = `${alpha.from}>${alpha.to}`
    const change = moved.get(way)
    if (change) change.surfaces.push(...worn)
    else moved.set(way, { ...alpha, surfaces: worn })
  }
  if (!refresh || !written) return true
  const [first, ...others] = moved.values()
  return refresh(values, first) && others.every((alpha) => refresh(false, alpha))
}
