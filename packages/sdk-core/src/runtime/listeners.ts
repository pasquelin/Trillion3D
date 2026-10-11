/**
 * The listeners of something that tells them: `subscribe` adds one and gives back what removes it (`unsubscribe` removes one by itself),
 * `emit` tells each the arguments (a listener that leaves while it is told is still told this
 * once), `clear` drops them all.
 */
export function createListeners<Args extends unknown[] = []>() {
  const heard = new Set<(...args: Args) => void>()
  return {
    /** How many listeners are held. */
    get size() {
      return heard.size
    },
    subscribe(listener: (...args: Args) => void) {
      heard.add(listener)
      return () => void heard.delete(listener)
    },
    unsubscribe(listener: (...args: Args) => void) {
      heard.delete(listener)
    },
    emit(...args: Args) {
      // The common holder has one listener: told in place, with no copy made for a write.
      for (const listener of heard.size === 1 ? heard : [...heard]) listener(...args)
    },
    clear() {
      heard.clear()
    },
  }
}

/** The listeners of something that tells them. */
export type Listeners<Args extends unknown[] = []> = ReturnType<typeof createListeners<Args>>
