import type { Geometry } from './geometry.ts';
import { readComponent } from './bounds.ts';

/** All paired skin streams, in source set order; a runtime stream may itself be wider than four. */
export function skinStreams(geometry: Geometry) {
  const names = Object.keys(geometry.attributes)
    .filter((name) => /^skinIndex\d*$/.test(name))
    .sort((a, b) => Number(a.slice(9)) - Number(b.slice(9)));
  const sets = names.map((name) => {
    const joints = geometry.attributes[name],
      weights = geometry.attributes[name.replace('Index', 'Weight')];
    if (
      !joints ||
      !weights ||
      weights.itemSize !== joints.itemSize ||
      weights.count !== joints.count
    )
      throw new Error('Invalid paired skin attributes');
    return { joints, weights };
  });
  const width = sets.reduce((sum, set) => sum + set.joints.itemSize, 0);
  return {
    width,
    read(vertex: number, influence: number, weight: boolean) {
      for (const set of sets) {
        if (influence < set.joints.itemSize)
          return readComponent(geometry, weight ? set.weights : set.joints, vertex, influence);
        influence -= set.joints.itemSize;
      }
      return 0;
    },
  };
}
