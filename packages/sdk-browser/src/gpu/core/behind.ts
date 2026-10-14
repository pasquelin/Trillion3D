/**
 * Runs `task` once the work `owner` holds in flight has settled, whatever its outcome, and holds
 * `task`'s work in its place: the one way an owner serialises its asynchronous work — the selection's
 * reads and growths, the page pool's loads and resizes, the geometry pool's renewals. The work
 * before has already given its outcome to whoever asked it, so a failure never stops the next one;
 * `task`'s own outcome is returned, and held for whoever awaits the owner's work.
 */
export function behind<T>(
  owner: { pending: Promise<unknown> },
  task: () => T | PromiseLike<T>,
): Promise<T> {
  const operation = owner.pending.catch(() => {}).then(task)
  owner.pending = operation
  return operation
}
