import type { Material } from '../../../sdk-core/world/material/material.ts';

/** The fields that are a material's bookkeeping, never one of its parameters. */
const OWN = new Set(['isMaterial', 'version', '_listeners', 'heard']);

/** One parameter value as a key: a texture by identity and version, a colour or a vector by its
 *  numbers, anything else by its own value. */
function valueKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return String(value);
  const shaped = value as { isTexture?: boolean; id?: string; version?: number };
  if (shaped.isTexture) return `texture:${shaped.id}@${shaped.version}`;
  if (Array.isArray(value)) return `[${value.map(valueKey).join(',')}]`;
  const numbers = Object.entries(value).filter(([, field]) => typeof field === 'number');
  return `{${numbers.map(([name, field]) => `${name}:${field}`).join(',')}}`;
}

/** Everything a material draws with, as one string: its kind and each parameter, by name. */
export function materialKey(material: Material) {
  const fields = Object.keys(material)
    .filter((name) => !OWN.has(name))
    .sort()
    .map((name) => `${name}=${valueKey(material[name])}`);
  return fields.join(';');
}

/** An entry of the table: the parameters, frozen as they were when the entry was made. */
export type MaterialEntry = { readonly key: string; readonly material: Material };

/**
 * The material table of a world. Materials of identical parameters are one entry, however many
 * objects the page made; an entry is a copy taken when it was made, so a material written after
 * it was placed moves its wearers to the entry of its new parameters and leaves the old one as it
 * was — copy on write. `counts.duplicates` says how often the table folded one material onto an
 * entry another material had made.
 */
export function createWorldMaterials() {
  const entries = new Map<string, MaterialEntry>();
  /** The key each material object was last read under: a material read again unchanged is
   *  neither a new entry nor a fold. */
  const known = new WeakMap<Material, string>();
  const counts = { duplicates: 0 };
  return {
    counts,
    entryOf(material: Material): MaterialEntry {
      const key = materialKey(material);
      let entry = entries.get(key);
      const seen = known.get(material) === key;
      known.set(material, key);
      if (!entry) entries.set(key, (entry = { key, material: material.clone() }));
      else if (!seen) counts.duplicates++;
      return entry;
    },
    /** Forgets the entries no session and no mesh uses any more. */
    keep(used: ReadonlySet<MaterialEntry>) {
      for (const [key, entry] of entries) if (!used.has(entry)) entries.delete(key);
    },
  };
}
