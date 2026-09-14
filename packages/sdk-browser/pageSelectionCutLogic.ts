import { maxStretch } from '../sdk-core/index.ts';
import * as THREE from 'three';
import { projectedClusterError } from './pageSelectionMath.ts';
import { forceScratch, type PageRecord, type SelectionState } from './pageSelectionCutState.ts';

export function worldStretch(root: {
  world: THREE.Matrix4;
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
    projectedClusterError(
      rec.lodError ?? 0,
      rec.sphere,
      0,
      s.flatElements,
      s.flatStretch,
      s.flatFocal,
      s.camera.near,
    ) > s.pixelError
  )
    return false;
  const own = rec.group;
  if (own == null || own < 0) return true;
  if (forced[own]) return false;
  return (
    projectedClusterError(
      rec.parentError,
      rec.parentSphere ?? rec.sphere,
      0,
      s.flatElements,
      s.flatStretch,
      s.flatFocal,
      s.camera.near,
    ) > s.pixelError
  );
}

/** Propagate forcing to every finer group until an already coarse group stops the walk. */
export function forceCoarse<T extends PageRecord>(s: SelectionState<T>, start: number) {
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
    for (let i = structure.childOffsets[group]; i < structure.childOffsets[group + 1]; i++) {
      const producer = structure.sources[structure.children[i]];
      if (producer < 0 || forced[producer]) continue;
      if (
        projectedClusterError(
          structure.error[producer],
          structure.sphere,
          producer * 4,
          s.flatElements,
          s.flatStretch,
          s.flatFocal,
          s.camera.near,
        ) <= s.pixelError
      )
        continue;
      pending.push(producer);
    }
  }
}
