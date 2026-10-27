/** What a follow of no signal, or of one already aborted, leaves to undo: nothing. */
const followsNothing = () => {}

/**
 * `child` aborted with `parent`'s reason once `parent` aborts — at once when it already has —:
 * a signal of its own that its asker's stops. Returns what stops following.
 */
export function followSignal(child: AbortController, parent: AbortSignal | undefined) {
  if (!parent) return followsNothing
  if (parent.aborted) {
    child.abort(parent.reason)
    return followsNothing
  }
  const leave = () => child.abort(parent.reason)
  parent.addEventListener('abort', leave, { once: true })
  return () => parent.removeEventListener('abort', leave)
}

/** A signal that aborts with `own` or with `outer`, where an asker gave one: `own` alone otherwise. */
export const signalWith = (own: AbortSignal, outer: AbortSignal | undefined) =>
  outer ? AbortSignal.any([outer, own]) : own
