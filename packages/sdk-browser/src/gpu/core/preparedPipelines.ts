// The pipelines of one program, keyed by what decides each, on the engine's one way to a pipeline
// (`../../lighting/deferred/fullscreen.ts`): render or compute, each made once and prepared.

/** The pipelines of one program, keyed by what decides each: `of(key)` is the one `make(key)`
 *  describes, made once and prepared like any other (`PreparedPipeline`) — or a pipeline with the
 *  layouts and module it is made of, or that module alone, which several of a program's pipelines
 *  share —; two keys of the same `id` are the same. */
export function preparedPipelines<K, T>(
  make: (key: K) => T,
  id: (key: K) => unknown = (key) => key,
) {
  const held = new Map<unknown, { key: K; pipeline: T }>()
  return {
    of(key: K) {
      let entry = held.get(id(key))
      if (!entry) held.set(id(key), (entry = { key, pipeline: make(key) }))
      return entry.pipeline
    },
    /** The keys made so far. */
    *keys() {
      for (const { key } of held.values()) yield key
    },
    /** Lets go of the pipelines `keep` refuses — it is given a pipeline's key and the `id` it was made under. */
    prune(keep: (key: K, id: unknown) => boolean) {
      for (const [at, { key }] of held) if (!keep(key, at)) held.delete(at)
    },
  }
}
