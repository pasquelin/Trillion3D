import { EngineError } from '../contracts/cache.ts'

/** What a store of named scene objects needs to know of its kind of object. */
interface NamedStoreKind<Scene extends { id: string }, Resolved extends Scene> {
  /** The object with every field set, refused if a field is not one the contract takes. */
  resolve(object: Scene): Resolved
  /** Whether two resolved objects are the same. */
  same(a: Resolved, b: Resolved): boolean
  /** What the objects are called in a message: `fog volume`. */
  noun: string
  /** The codes of the refusals of a name already held and of an unknown name. */
  duplicate: string
  unknown: string
}

/**
 * The scene objects of one kind, by name, in the order they were added. A change bumps `revision`,
 * which tells a reader (the frame that draws them) to read them again; setting an object to what it
 * already is changes nothing. The stores of the objects voxelised into the fog's volume and of the
 * local fog volumes are this store over their own contracts.
 */
export function createNamedStore<Scene extends { id: string }, Resolved extends Scene>(
  kind: NamedStoreKind<Scene, Resolved>,
) {
  const records = new Map<string, Resolved>()
  let revision = 0
  const unknown = (id: string) =>
    new EngineError(kind.unknown, `unknown ${kind.noun} ${id}`, { id })
  return {
    /** Bumped when an object is added, changed or removed. */
    get revision() {
      return revision
    },
    /** How many objects. */
    get count() {
      return records.size
    },
    /** The held objects, the store's own: the frame reads them and copies nothing. */
    get values() {
      return records.values()
    },
    /** One held object. */
    get: (id: string) => records.get(id),
    /** Adds an object; a name already held is refused. */
    add(object: Scene) {
      const resolved = kind.resolve(object)
      if (records.has(resolved.id))
        throw new EngineError(kind.duplicate, `${kind.noun} ${resolved.id} exists`, {
          id: resolved.id,
        })
      records.set(resolved.id, resolved)
      revision++
    },
    /** Changes an object: the fields of `patch` replace its own. */
    set(id: string, patch: Partial<Omit<Scene, 'id'>>) {
      const current = records.get(id)
      if (!current) throw unknown(id)
      const merged = kind.resolve({ ...current, ...patch, id })
      if (kind.same(current, merged)) return
      records.set(id, merged)
      revision++
    },
    /** Removes an object. */
    remove(id: string) {
      if (!records.delete(id)) throw unknown(id)
      revision++
    },
  }
}
