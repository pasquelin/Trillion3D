import { SELECTION_WORKGROUP as WORKGROUP } from '../core/selection.ts';
import { lightCutBuffers, lightQueueCap, pastBinding, type LightCutShape } from './bufferTable.ts';
import { DAG_MAX_VIEWS } from './shader/viewsWgsl.ts';

/** The device limits a light cut's buffers and dispatches must hold. */
export type LightCutLimits = Pick<
  GPUSupportedLimits,
  'maxComputeWorkgroupsPerDimension' | 'maxStorageBufferBindingSize' | 'maxBufferSize'
>;

/**
 * HOW MANY VIEWS ONE LIGHT CUT CAN RUN ON THIS DEVICE. Every per-primitive word of a light cut is
 * one row per view, and every per-primitive dispatch one thread per primitive per view: a scene of
 * many primitives times `DAG_MAX_VIEWS` views can pass the workgroups a dispatch may count or the
 * bytes a storage binding may span, and one invalid dispatch invalidates the frame's whole command
 * buffer — the camera's image with it. The capacity is the most views whose buffers and dispatches
 * all fit, down to one: one view never spans more than the camera cut, which the device already
 * holds — its rows split in the camera's ranges, a share of the camera's own (`frameRanges.ts`).
 * The buffers are judged by the cut's one table and fit rule (`bufferTable.ts`). The frame's pages
 * are bounded by it, and so are its views (`lightCutRedraws.ts`).
 */
export function lightCutCapacity(limits: LightCutLimits, shape: LightCutShape) {
  const threads = limits.maxComputeWorkgroupsPerDimension * WORKGROUP;
  const fits = (views: number) => {
    const queueCap = lightQueueCap(shape, views);
    if (Math.max(shape.frames.per * views, shape.blockCount) > threads) return false;
    for (let level = 1; level < shape.levelSizes.length; level++)
      if (Math.min(shape.levelSizes[level] * views, queueCap) > threads) return false;
    const table = lightCutBuffers(shape, views);
    return !pastBinding(limits, { ...table.rows, frames: table.frames(shape.frames.per) });
  };
  let views = DAG_MAX_VIEWS;
  while (views > 1 && !fits(views)) views--;
  return views;
}
