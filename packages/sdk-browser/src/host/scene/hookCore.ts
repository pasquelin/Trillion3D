/** What every host hook shares: the revision it bumps. */

/**
 * Revision a watch owns. Every write the host makes on the hooked pose of one of its nodes —
 * a position, a scale, a rotation — increments it at the instant of the write, so the frame
 * compares one integer instead of rereading those numbers.
 */
export interface WriteRevision {
  revision: number;
}

/** Hook of one host node: the revisions its writes bump. Empty once every watch has left. */
export interface Hook {
  revisions: WriteRevision[];
}

export function bump(hook: Hook) {
  const list = hook.revisions;
  for (let i = 0; i < list.length; i++) list[i].revision++;
}
