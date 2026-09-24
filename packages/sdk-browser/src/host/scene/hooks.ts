import {
  listen,
  type Observed,
  type ObservedComponents,
} from '../../../../sdk-core/src/world/math/observed.ts';
import { bump, type Hook, type WriteRevision } from './hookCore.ts';
import type { HostGraphNode } from './graphNodes.ts';

const hooks = new WeakMap<object, Hook>();

/**
 * Bumps `hook` when a write on `value` or on one of its `faces` leaves `value`'s numbers other
 * than they were: a write of the value already held bumps nothing. The node's values are the
 * core's, which announce their writes (`listen`), so no field of the node or of its values is
 * redefined. The rotation passes its angles as a face and compares the quaternion: an angle
 * write sets the quaternion quietly, in the node's own listener, chained first.
 */
function hookValue(hook: Hook, value: ObservedComponents, ...faces: Observed[]) {
  const seen = Float64Array.from(value.elements);
  const note = () => {
    const now = value.elements;
    let moved = false;
    for (let i = 0; i < seen.length; i++)
      if (now[i] !== seen[i]) {
        seen[i] = now[i];
        moved = true;
      }
    if (moved) bump(hook);
  };
  for (const face of [value, ...faces]) listen(face, note);
}

/**
 * Hooks the local pose of `node` — position, scale, rotation — once in its life, and registers
 * `revision` among what its writes bump: a write of another value costs the host one comparison
 * and one increment, and a frame that reads nothing else knows the node did not move. The other
 * fields the contract lets the host write are the node's own data fields, which no hook may
 * touch without slowing the reference's walk: `scan.ts` compares them per frame.
 */
export function hookHostNode(node: HostGraphNode, revision: WriteRevision) {
  const known = hooks.get(node);
  if (known) {
    if (!known.revisions.includes(revision)) known.revisions.push(revision);
    return;
  }
  const hook: Hook = { revisions: [revision] };
  hooks.set(node, hook);
  hookValue(hook, node.position);
  hookValue(hook, node.scale);
  hookValue(hook, node.quaternion, node.rotation);
}

/** Forgets `revision` on `node`: its writes no longer bump it. The listeners stay, bumping
 *  nothing once the last watch has left. */
export function unhookHostNode(node: HostGraphNode, revision: WriteRevision) {
  const hook = hooks.get(node);
  const at = hook ? hook.revisions.indexOf(revision) : -1;
  if (hook && at >= 0) hook.revisions.splice(at, 1);
}
