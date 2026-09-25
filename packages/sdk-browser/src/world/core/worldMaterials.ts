import {
  MATERIAL_BOOKKEEPING,
  type Material,
} from '../../../../sdk-core/src/world/material/material.ts';
import { Color } from '../../../../sdk-core/src/world/math/color.ts';
import type { Texture } from '../../../../sdk-core/src/world/texture/texture.ts';
import { composesWithBackground } from '../../scene/materialBlending.ts';

/** The parameters a session reads as values — a page-table row's colour and numbers, a host
 *  surface's uniforms — and so the only ones written in place: none of them changes a shader, a
 *  resolve class or which pass draws the surface. */
const VALUES = new Set(['color', 'emissive', 'emissiveIntensity', 'metalness', 'roughness']);

/** One parameter value as a key: a texture by identity and its three counters — its picture's
 *  `version` left out when `pictures` is false —, a colour or a vector by its numbers, anything
 *  else by its own value. */
function valueKey(value: unknown, pictures = true): string {
  if (value === null || typeof value !== 'object') return String(value);
  const shaped = value as Partial<Texture> & { isTexture?: boolean };
  if (shaped.isTexture) {
    const version = pictures ? shaped.version : '';
    return `texture:${shaped.id}@${version}.${shaped.sampling}.${shaped.placement}`;
  }
  if (Array.isArray(value)) return `[${value.map((each) => valueKey(each, pictures)).join(',')}]`;
  const numbers = Object.entries(value).filter(([, field]) => typeof field === 'number');
  return `{${numbers.map(([name, field]) => `${name}:${field}`).join(',')}}`;
}

/** The material's parameters as one string, by name; `values` false leaves the value fields out,
 *  which is what two materials must share for one to be repainted into the other's entry;
 *  `pictures` false leaves out what its textures' pictures are at. */
function materialKey(material: Material, values = true, pictures = true) {
  const fields = Object.keys(material)
    .filter((name) => !MATERIAL_BOOKKEEPING.has(name) && (values || !VALUES.has(name)))
    .sort()
    .map((name) => `${name}=${valueKey(material[name], pictures)}`);
  return fields.join(';');
}

/** A surface drawn by the opaque passes, where a value is read from the row at every frame; a
 *  blended or transmissive one is laid out in its forward pass when the session opens, and so is
 *  one whose blending mode composes with the background, whatever `transparent` says. */
const opaque = (material: Material) =>
  !material.transparent &&
  !composesWithBackground(material.blending) &&
  !((material.transmission as number | undefined) ?? 0);

/** An entry of the table: the parameters as they were when the entry was made or repainted. */
export type MaterialEntry = { readonly id: number; key: string; readonly material: Material };

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
  const entries = new Map<string, MaterialEntry>();
  /** The material objects each entry was last resolved from. */
  const sources = new Map<MaterialEntry, Set<Material>>();
  /** The entry each material object was last read into, at its version: a material read again
   *  unchanged is neither a new entry nor a fold, and its key is not built again. */
  const known = new WeakMap<Material, { version: number; entry: MaterialEntry }>();
  /** The entries repainted since the last take, each with whether its values were written. */
  const repainted = new Map<MaterialEntry, boolean>();
  const counts = { duplicates: 0 };
  let ids = 0;
  /** Writes `material`'s values into its sole entry, when nothing but values changed. */
  const repaintValues = (material: Material, entry: MaterialEntry) => {
    const only = sources.get(entry);
    if (only?.size !== 1 || !only.has(material)) return false;
    if (!opaque(material) || !opaque(entry.material)) return false;
    if (materialKey(material, false) !== materialKey(entry.material, false)) return false;
    for (const field of VALUES) {
      const value = material[field];
      if (value instanceof Color) (entry.material[field] as Color).copy(value);
      else entry.material[field] = value;
    }
    return true;
  };
  /** Keeps `material` on its entry under its new key, when only values changed, or only the
   *  pictures of its textures — which the entry's copy shares, so every wearer sees them, blended
   *  or shared: a video's frame, a canvas redrawn (#362). */
  const repaint = (material: Material, entry: MaterialEntry, key: string) => {
    if (entries.has(key)) return false;
    const pictures =
      materialKey(material, true, false) === materialKey(entry.material, true, false);
    if (!pictures && !repaintValues(material, entry)) return false;
    entries.delete(entry.key);
    entries.set((entry.key = key), entry);
    repainted.set(entry, !pictures || !!repainted.get(entry));
    return true;
  };
  return {
    counts,
    entryOf(material: Material): MaterialEntry {
      const last = known.get(material);
      // An entry `keep` dropped is no longer the table's: the material is read again.
      const held = last && entries.get(last.entry.key) === last.entry ? last.entry : null;
      if (held && last!.version === material.version) return held;
      const key = materialKey(material);
      if (held && held.key !== key && repaint(material, held, key)) {
        known.set(material, { version: material.version, entry: held });
        return held;
      }
      let entry = entries.get(key);
      if (!entry) entries.set(key, (entry = { id: ids++, key, material: material.clone() }));
      else if (last?.entry !== entry) counts.duplicates++;
      if (last && last.entry !== entry) sources.get(last.entry)?.delete(material);
      const from = sources.get(entry) ?? new Set<Material>();
      sources.set(entry, from.add(material));
      known.set(material, { version: material.version, entry });
      return entry;
    },
    /** The entries repainted since the last call, handed over once; `values` false when only
     *  their textures moved — a picture, a sampling, a placement —, which no value reads. */
    takeRepainted() {
      const taken = [...repainted].map(([entry, values]) => ({ entry, values }));
      repainted.clear();
      return taken;
    },
    /** Forgets the entries no session and no mesh uses any more. */
    keep(used: ReadonlySet<MaterialEntry>) {
      for (const [key, entry] of entries)
        if (!used.has(entry)) {
          entries.delete(key);
          sources.delete(entry);
          repainted.delete(entry);
        }
    },
  };
}
