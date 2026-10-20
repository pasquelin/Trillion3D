/**
 * `run` called once in a microtask however many times `schedule` asks before it: the turn clears
 * the request, then calls `run`, so what `run` asks again is a fresh turn. `reset` forgets a
 * request whose work was done in place; its microtask still comes and calls `run`.
 */
export function microtaskOnce(run: () => void) {
  let owed = false
  const turn = () => {
    owed = false
    run()
  }
  return {
    schedule() {
      if (owed) return
      owed = true
      queueMicrotask(turn)
    },
    reset() {
      owed = false
    },
  }
}
