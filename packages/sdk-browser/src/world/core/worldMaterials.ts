import type { Material } from '../../../../sdk-core/src/world/material/material.ts'
import type { DrawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts'
import type { AlphaChange } from '../../placement/engineSceneUpdates.ts'
import type { PageSurface } from '../../page/surface.ts'
import { hostSurface, readingRank, type SurfaceReading } from './worldSurface.ts'
import { materialKey, repaint, repaintSurfaces, type Refresh } from './worldRepaint.ts'

/** An entry of the table: the parameters as they were when the entry was made or repainted, and
 *  the surfaces built from them, one per way its wearers read it (`surfaceOf`). */
export type MaterialEntry = {
  readonly id: number
  key: string
  readonly material: Material
  readonly surfaces: (PageSurface | undefined)[]
}

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
    reading: SurfaceReading = drawn.lines
      ? 'lines'
      : drawn.spriteRadius !== undefined
        ? 'sprite'
        : twoSided
          ? 'sheet'
          : 'faces'
  return (entry.surfaces[readingRank(reading, tinted)] ??= hostSurface(material, tinted, reading))
}

/** Gives back the surfaces of `entries`. The textures they wore are the page's own records,
 *  held as they are: nothing of theirs is the table's to give back. */
function release(entries: Iterable<MaterialEntry>) {
  for (const entry of entries) {
    for (const surface of entry.surfaces) surface?.dispose()
    entry.surfaces.length = 0
  }
}

/** How an entry was repainted: its values written or its pictures alone, its alpha moved. */
export type Repaint = { values: boolean; alpha?: Omit<AlphaChange, 'surfaces'> }
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
      release(dropped)
    },
    /** The world is gone: every surface it built is given back. */
    dispose() {
      release(entries.values())
      entries.clear()
    },
  }
}

/** What a world's material table holds (`createWorldMaterials`). */
export type MaterialsState = {
  entries: Map<string, MaterialEntry>
  /** The material objects each entry was last resolved from. */
  sources: Map<MaterialEntry, Set<Material>>
  /** The entry each material object was last read into, at its version: a material read again
   *  unchanged is neither a new entry nor a fold, and its key is not built again. */
  known: WeakMap<Material, { version: number; entry: MaterialEntry }>
  /** The entries repainted since the last take, each with whether its values were written and,
   *  when its cutoff moved, its alpha mode before the first repaint and after the last. */
  repainted: Map<MaterialEntry, Repaint>
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
