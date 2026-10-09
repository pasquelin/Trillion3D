/**
 * The pool's residency changes since the host last drained them, so a host mirrors the cache page
 * by page instead of asking for its whole catalogue every frame: one entry a key, its last place —
 * the slot's words offset, or -1 once it left. A page that arrives and leaves between two drains
 * leaves no entry: the host never knew it. The log so holds at most the pages resident now and
 * those the host knew at its last drain, however long it goes undrained.
 */
export function createResidencyLog() {
  const changes = new Map<string, number>()
  /** The keys the host holds resident: those it drained last as arrived. */
  const known = new Set<string>()
  return {
    /** `key`'s page now starts at `offset` bytes. */
    placed(key: string, offset: number) {
      changes.set(key, offset / 4)
    },
    /** `key`'s page left. */
    left(key: string) {
      if (known.has(key)) changes.set(key, -1)
      else changes.delete(key)
    },
    /** Moves the changes into the caller's arrays, then empties the log. */
    drain(keys: string[], slots: number[]) {
      for (const [key, words] of changes) {
        keys.push(key)
        slots.push(words)
        if (words < 0) known.delete(key)
        else known.add(key)
      }
      changes.clear()
    },
  }
}

export type ResidencyLog = ReturnType<typeof createResidencyLog>
