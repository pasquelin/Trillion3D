/**
 * The listeners of something that tells them: `subscribe` adds one and gives back what removes it (`unsubscribe` removes one by itself),
 * `emit` tells each the arguments (a listener that leaves while it is told is still told this
 * once), `clear` drops them all.
 */
export function createListeners<Args extends unknown[] = []>() {
  const heard = new Set<(...args: Args) => void>()
  return {
    subscribe(listener: (...args: Args) => void) {
      heard.add(listener)
      return () => void heard.delete(listener)
    },
    unsubscribe(listener: (...args: Args) => void) {
      heard.delete(listener)
    },
    emit(...args: Args) {
      for (const listener of [...heard]) listener(...args)
    },
    clear() {
      heard.clear()
    },
  }
}
