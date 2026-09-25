import { boxEmpty } from '../../../../sdk-core/src/math/primitives/box.ts';
import { boxUnionBatch } from '../../../../sdk-core/src/math/batch/batch.ts';

interface SceneRoots {
  selectionRoots: ReadonlyArray<{ worldBox?: Float64Array; unculled?: boolean }>;
  rows: { tableEpoch: number };
}

/**
 * The world box of every opaque primitive the scene draws: what a sun's clipmap spans along its
 * axis, so every caster lies inside its depth range. A root never culled (`ClusterRoot.unculled`)
 * is left out: a sprite casts no shadow, and its box would only spread the range. Rebuilt only when a pose moved or the scene
 * changed — the row-table epoch and the root list say so —, from boxes the engine already holds.
 */
export function createShadowSceneBox() {
  const box = new Float64Array(6),
    min = box.subarray(0, 3),
    max = box.subarray(3, 6),
    read = { min, max };
  let epoch = -1,
    roots: unknown = undefined;
  return (layout: SceneRoots) => {
    const { selectionRoots, rows } = layout;
    if (rows.tableEpoch !== epoch || selectionRoots !== roots) {
      epoch = rows.tableEpoch;
      roots = selectionRoots;
      boxEmpty(box, 0);
      for (const root of selectionRoots)
        if (root.worldBox && !root.unculled) boxUnionBatch(box, root.worldBox, 1);
    }
    return read;
  };
}
