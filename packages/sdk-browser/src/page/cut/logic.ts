import { maxStretch } from '../../../../sdk-core/src/index.ts';
import { frameClusterError } from '../selection/frame.ts';
import type { MatrixElements } from '../../math/matrixElements.ts';
import { forceScratch, type PageRecord, type SelectionState } from './state.ts';
import { markForcedGroup, type ForcedMarks } from './forced.ts';
import type { CullingLinks } from './readiness.ts';

export function worldStretch(root: {
  world: MatrixElements;
  stretch?: number;
  stretchKey?: Float64Array;
}) {
  const m = root.world.elements,
    key = root.stretchKey;
  if (
    key &&
    key[0] === m[0] &&
    key[1] === m[1] &&
    key[2] === m[2] &&
    key[3] === m[4] &&
    key[4] === m[5] &&
    key[5] === m[6] &&
    key[6] === m[8] &&
    key[7] === m[9] &&
    key[8] === m[10]
  )
    return root.stretch as number;
  const next = key ?? (root.stretchKey = new Float64Array(9));
  next[0] = m[0];
  next[1] = m[1];
  next[2] = m[2];
  next[3] = m[4];
  next[4] = m[5];
  next[5] = m[6];
  next[6] = m[8];
  next[7] = m[9];
  next[8] = m[10];
  return (root.stretch = maxStretch(m));
}

/** A cluster is drawn when its producing group is coarse but its replacement group is not. */
export function drawnUnderForcing<T extends PageRecord>(s: SelectionState<T>, rec: T) {
  const forced = s.flatForced as Uint8Array,
    source = rec.source;
  if (
    source != null &&
    source >= 0 &&
    !forced[source] &&
    frameClusterError(s, rec.lodError ?? 0, rec.sphere, 0) > s.pixelError
  )
    return false;
  const own = rec.group;
  if (own == null || own < 0) return true;
  if (forced[own]) return false;
  return frameClusterError(s, rec.parentError, rec.parentSphere ?? rec.sphere, 0) > s.pixelError;
}

/** Marks a forced group on the culling nodes its clusters walk, when the root holds
 *  the map: the fallback descent then reads those marks instead of opening everything. */
function markGroup<T extends PageRecord>(
  s: SelectionState<T>,
  links: CullingLinks | undefined,
  marks: ForcedMarks | undefined,
  group: number,
  delta: number,
) {
  if (links && marks) markForcedGroup(links, marks, s.flatStructure!, group, delta);
}

/** Clears the force marks left by this root's previous cut. */
export function clearForcedMarks<T extends PageRecord>(
  s: SelectionState<T>,
  links: CullingLinks | undefined,
  marks: ForcedMarks | undefined,
) {
  const list = s.flatForcedList!,
    forced = s.flatForced!;
  for (let i = 0; i < list.length; i++) {
    forced[list[i]] = 0;
    markGroup(s, links, marks, list[i], -1);
  }
  list.length = 0;
}

/** Propagate forcing to every finer group until an already coarse group stops the walk. */
export function forceCoarse<T extends PageRecord>(
  s: SelectionState<T>,
  start: number,
  links?: CullingLinks,
  marks?: ForcedMarks,
) {
  const structure = s.flatStructure!,
    forced = s.flatForced!,
    list = s.flatForcedList!;
  const pending = forceScratch;
  pending.length = 0;
  pending.push(start);
  while (pending.length) {
    const group = pending.pop() as number;
    if (forced[group]) continue;
    forced[group] = 1;
    list.push(group);
    markGroup(s, links, marks, group, 1);
    for (let i = structure.childOffsets[group]; i < structure.childOffsets[group + 1]; i++) {
      const producer = structure.sources[structure.children[i]];
      if (producer < 0 || forced[producer]) continue;
      if (
        frameClusterError(s, structure.error[producer], structure.sphere, producer * 4) <=
        s.pixelError
      )
        continue;
      pending.push(producer);
    }
  }
}
