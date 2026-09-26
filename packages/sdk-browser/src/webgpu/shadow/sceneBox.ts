import { boxEmpty } from '../../../../sdk-core/src/math/primitives/box.ts';
import { boxUnionBatch } from '../../../../sdk-core/src/math/batch/batch.ts';
import { SPRITE_ROOT } from '../../visibility/shader/spriteWgsl.ts';

interface SceneRoots {
  selectionRoots: ReadonlyArray<{ worldBox?: Float64Array; mark?: number }>;
  rows: { tableEpoch: number };
}

/**
 * The world box of every primitive the scene draws: what a sun's clipmap spans along
 * its axis, so every caster lies inside its depth range, and the rectangle its floor pages cover
 * on its plane (`sunLevels.ts` floorReach). A sprite root (`SPRITE_ROOT`) is left out: a sprite
 * casts no shadow, and its box would only spread the range. A mesh set to cast none stays in.
 * Rebuilt only when a pose moved or the scene changed — the scene revision, the row-table epoch and the root list say so: an
 * engine pose or placement move bumps the scene revision alone —, from boxes the engine already
 * holds.
 */
export function createShadowSceneBox() {
  const box = new Float64Array(6),
    min = box.subarray(0, 3),
    max = box.subarray(3, 6),
    read = { min, max };
  let epoch = -1,
    revision = -1,
    roots: unknown = undefined;
  return (layout: SceneRoots, sceneRevision = 0) => {
    const { selectionRoots, rows } = layout;
    if (rows.tableEpoch !== epoch || sceneRevision !== revision || selectionRoots !== roots) {
      epoch = rows.tableEpoch;
      revision = sceneRevision;
      roots = selectionRoots;
      boxEmpty(box, 0);
      for (const root of selectionRoots)
        if (root.worldBox && !((root.mark ?? 0) & SPRITE_ROOT))
          boxUnionBatch(box, root.worldBox, 1);
    }
    return read;
  };
}
