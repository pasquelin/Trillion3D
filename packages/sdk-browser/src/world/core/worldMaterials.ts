import {
  MATERIAL_BOOKKEEPING,
  type Material,
} from '../../../../sdk-core/src/world/material/material.ts'
import { Color } from '../../../../sdk-core/src/world/math/color.ts'
import type { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { composesWithBackground } from '../../scene/materialBlending.ts'
import { alphaModeOf } from '../../../../sdk-core/src/contracts/material.ts'
import { alphaMoves, type AlphaChange } from '../../placement/engineSceneUpdates.ts'
import type { DrawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts'
import type { GraphSurface } from '../../host/graph/surface.ts'
import type { GraphTexture } from '../../host/graph/texture.ts'
import { hostSurface, repaintHostSurface } from './worldSurface.ts'
import { HOST_MAPS, type HostTextures } from './worldTextures.ts'

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
function materialKey(material: Material, values = true, pictures = true) {
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

/** An entry of the table: the parameters as they were when the entry was made or repainted, and
 *  the surfaces built from them, one per way its wearers read it (`surfaceOf`). */
export type MaterialEntry = {
  readonly id: number
  key: string
  readonly material: Material
  readonly surfaces: (GraphSurface | undefined)[]
}

/** What a resource's triangles are read as by the surface that draws them. */
type Reading = 'faces' | 'lines' | 'sprite' | 'sheet'

/** The surface of `entry` for the triangles `drawn`, built once and shared by every wearer: one
 *  per material, a second one when the material asks for vertex colours and is worn by geometries
 *  with and without them (the material decides, and a geometry with no colour has none to tint
 *  by), a third when it is worn by lines (widened and lifted), a fourth by a sprite (its quad
 *  turned to the camera), a fifth, and a sixth with vertex colours, by cloths (drawn on both
 *  faces). */
function surfaceFor(
  state: MaterialsState,
  entry: MaterialEntry,
  drawn: DrawnTriangles,
  twoSided: boolean,
) {
  const { material } = entry
  const tinted = !!material.vertexColors && !!drawn.colors,
    reading: Reading = drawn.lines
      ? 'lines'
      : drawn.spriteRadius !== undefined
        ? 'sprite'
        : twoSided
          ? 'sheet'
          : 'faces'
  const rank =
    reading === 'lines' ? 2 : reading === 'sprite' ? 3 : (reading === 'sheet' ? 4 : 0) + +tinted
  return (entry.surfaces[rank] ??= hostSurface(material, tinted, state.textures, reading))
}

/** Gives back the surfaces of `entries`, and the textures only they wore. */
function release(state: MaterialsState, entries: Iterable<MaterialEntry>) {
  const { textures } = state
  for (const entry of entries) {
    for (const surface of entry.surfaces) surface?.dispose()
    entry.surfaces.length = 0
  }
  const worn = new Set<GraphTexture>()
  for (const entry of state.entries.values())
    for (const surface of entry.surfaces)
      for (const field of HOST_MAPS) {
        const texture = surface?.[field] as GraphTexture | null | undefined
        if (texture) worn.add(texture)
      }
  for (const [key, texture] of textures)
    if (!worn.has(texture)) {
      texture.dispose()
      textures.delete(key)
    }
}

/** How an entry was repainted: its values written or its pictures alone, its alpha moved. */
type Repaint = { values: boolean; alpha?: Omit<AlphaChange, 'surfaces'> }
/** An entry repainted since the last take, and how (`takeRepainted`). */
export type RepaintedEntry = { entry: MaterialEntry } & Repaint

/**
 * The material table of a world. Materials of identical parameters are one entry, however many
 * objects the page made; an entry is a copy taken when it was made, so a material written after
 * it was placed moves its wearers to the entry of its new parameters and leaves the old one as it
 * was — copy on write. Two exceptions keep a live edit off the session's reopening: an opaque
 * entry that only one material object resolves to, written on its value fields alone (#335), and
 * any entry whose textures' pictures alone moved (#362), are REPAINTED — the entry keeps its
 * place under its new key and `takeRepainted` names it, for the session to rewrite what reads it. `counts.duplicates` says how often the table folded one
 * material onto an entry another material had made.
 */
export function createWorldMaterials() {
  const state: MaterialsState = {
    entries: new Map(),
    sources: new Map(),
    known: new WeakMap(),
    repainted: new Map(),
    textures: new Map(),
    counts: { duplicates: 0 },
    ids: 0,
  }
  const { entries, sources, repainted } = state
  return {
    counts: state.counts,
    entryOf: (material: Material): MaterialEntry => entryOf(state, material),
    /** The surface `entry` is worn as by the triangles `drawn` (`surfaceFor`). */
    surfaceOf: (entry: MaterialEntry, drawn: DrawnTriangles, twoSided: boolean) =>
      surfaceFor(state, entry, drawn, twoSided),
    /** Writes the repainted entries into the surfaces built for them, then has `refresh` — the
     *  open session, if any — read them again: once, with the surfaces whose alpha moved the same
     *  way, and once more, no value, for each other way (`AlphaChange`). False when the session
     *  cannot. */
    repaint: (painted: readonly RepaintedEntry[], refresh?: Refresh) =>
      repaintSurfaces(painted, refresh),
    /** The entries repainted since the last call, handed over once; `values` false when only
     *  their textures moved — a picture, a sampling, a placement —, which no value reads;
     *  `alpha` when their alpha mode or cutoff moved. */
    takeRepainted(): RepaintedEntry[] {
      const taken = [...repainted].map(([entry, done]) => ({ entry, ...done }))
      repainted.clear()
      return taken
    },
    /** Forgets the entries no session and no mesh uses any more, their surfaces given back. */
    keep(used: ReadonlySet<MaterialEntry>) {
      const dropped: MaterialEntry[] = []
      for (const [key, entry] of entries)
        if (!used.has(entry)) {
          entries.delete(key)
          sources.delete(entry)
          repainted.delete(entry)
          dropped.push(entry)
        }
      release(state, dropped)
    },
    /** The world is gone: every surface and texture it built is given back. */
    dispose() {
      release(state, entries.values())
      entries.clear()
    },
  }
}

/** What a world's material table holds (`createWorldMaterials`). */
type MaterialsState = {
  entries: Map<string, MaterialEntry>
  /** The material objects each entry was last resolved from. */
  sources: Map<MaterialEntry, Set<Material>>
  /** The entry each material object was last read into, at its version: a material read again
   *  unchanged is neither a new entry nor a fold, and its key is not built again. */
  known: WeakMap<Material, { version: number; entry: MaterialEntry }>
  /** The entries repainted since the last take, each with whether its values were written and,
   *  when its cutoff moved, its alpha mode before the first repaint and after the last. */
  repainted: Map<MaterialEntry, Repaint>
  /** The textures its surfaces wear, each built once (`hostTexture`). */
  textures: HostTextures
  counts: { duplicates: number }
  ids: number
}

/** The entry `material` resolves to: its own, repainted in place when it can be, or the one of
 *  its parameters, made when none is. */
function entryOf(state: MaterialsState, material: Material): MaterialEntry {
  const { entries, sources, known } = state
  const last = known.get(material)
  // An entry `keep` dropped is no longer the table's: the material is read again.
  const held = last && entries.get(last.entry.key) === last.entry ? last.entry : null
  if (held && last!.version === material.version) return held
  const key = materialKey(material)
  if (held && held.key !== key && repaint(state, material, held, key)) {
    known.set(material, { version: material.version, entry: held })
    return held
  }
  let entry = entries.get(key)
  if (!entry)
    entries.set(key, (entry = { id: state.ids++, key, material: material.clone(), surfaces: [] }))
  else if (last?.entry !== entry) state.counts.duplicates++
  if (last && last.entry !== entry) sources.get(last.entry)?.delete(material)
  const from = sources.get(entry) ?? new Set<Material>()
  sources.set(entry, from.add(material))
  known.set(material, { version: material.version, entry })
  return entry
}

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
function repaint(state: MaterialsState, material: Material, entry: MaterialEntry, key: string) {
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
type Refresh = (values: boolean, alpha?: AlphaChange) => boolean

function repaintSurfaces(painted: readonly RepaintedEntry[], refresh?: Refresh) {
  let written = false,
    values = false
  const moved = new Map<string, AlphaChange & { surfaces: GraphSurface[] }>()
  for (const { entry, alpha, values: wrote } of painted) {
    const worn = entry.surfaces.filter((surface): surface is GraphSurface => !!surface)
    for (const surface of worn) repaintHostSurface(surface, entry.material)
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
