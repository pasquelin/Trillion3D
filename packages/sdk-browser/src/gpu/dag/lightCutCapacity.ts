import { SELECTION_WORKGROUP as WORKGROUP } from '../core/selection.ts';
import { FRAME_VEC4 } from './types.ts';
import { dagWorkLayout } from './shader/floorWgsl.ts';
import { LEVEL_QUEUES } from './shader/levelWgsl.ts';
import { DAG_MAX_VIEWS } from './shader/viewsWgsl.ts';

/** The device limits a light cut's buffers and dispatches must hold. */
export type LightCutLimits = Pick<
  GPUSupportedLimits,
  'maxComputeWorkgroupsPerDimension' | 'maxStorageBufferBindingSize' | 'maxBufferSize'
>;

/** What a scene's DAG makes a light cut carry per view. */
export type LightCutShape = {
  worldCount: number;
  nodeCount: number;
  pageCount: number;
  blockCount: number;
  levelSizes: ArrayLike<number>;
};

/** Each descent queue: every node, or one root per slot when the slots outnumber the nodes. */
export const lightQueueCap = (shape: LightCutShape, views: number) =>
  Math.max(shape.nodeCount, shape.worldCount * views);

/**
 * HOW MANY VIEWS ONE LIGHT CUT CAN RUN ON THIS DEVICE. Every per-primitive word of a light cut is
 * one row per view, and every per-primitive dispatch one thread per primitive per view: a scene of
 * many primitives times `DAG_MAX_VIEWS` views can pass the workgroups a dispatch may count or the
 * bytes a storage binding may span, and one invalid dispatch invalidates the frame's whole command
 * buffer — the camera's image with it. The capacity is the most views whose buffers and dispatches
 * all fit, down to one: one view is the camera cut's own footprint, which the device already holds.
 * The frame's pages are bounded by it, and so are its views (`lightCutRedraws.ts`).
 */
export function lightCutCapacity(limits: LightCutLimits, shape: LightCutShape) {
  const threads = limits.maxComputeWorkgroupsPerDimension * WORKGROUP,
    bytes = Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize);
  const fits = (views: number) => {
    const queueCap = lightQueueCap(shape, views);
    if (Math.max(shape.worldCount * views, shape.blockCount) > threads) return false;
    for (let level = 1; level < shape.levelSizes.length; level++)
      if (Math.min(shape.levelSizes[level] * views, queueCap) > threads) return false;
    const frames = views * shape.worldCount * FRAME_VEC4 * 16,
      flags = (queueCap * LEVEL_QUEUES + shape.pageCount * 4) * 4,
      work = dagWorkLayout(shape.blockCount, shape.worldCount, views).words * 4;
    return Math.max(frames, flags, work) <= bytes;
  };
  let views = DAG_MAX_VIEWS;
  while (views > 1 && !fits(views)) views--;
  return views;
}
