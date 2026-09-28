import { lightCutBuffers, pastBinding, type LightCutShape } from './bufferTable.ts';
import { DAG_MAX_VIEWS } from './shader/viewsWgsl.ts';

/** The device limits a light cut's buffers must hold. */
export type LightCutLimits = Pick<
  GPUSupportedLimits,
  'maxStorageBufferBindingSize' | 'maxBufferSize'
>;

/**
 * HOW MANY VIEWS ONE LIGHT CUT CAN RUN ON THIS DEVICE. Every per-primitive word of a light cut is
 * one row per view: a scene of many primitives times `DAG_MAX_VIEWS` views can pass the bytes a
 * storage binding may span, and one invalid binding invalidates the frame's whole command buffer —
 * the camera's image with it. The capacity is the most views whose buffers all fit, judged by the
 * cut's one table and fit rule (`bufferTable.ts`), down to one: one view never spans more than the
 * camera cut, which the device already holds — its rows split in the camera's ranges, a share of
 * the camera's own (`frameRanges.ts`). Its dispatches count one thread per primitive per view, in
 * rows past one dimension's workgroups (`shader/gridWgsl.ts`): they bound no view. The frame's pages
 * are bounded by it, and so are its views (`lightCutRedraws.ts`).
 */
export function lightCutCapacity(limits: LightCutLimits, shape: LightCutShape) {
  const fits = (views: number) => {
    const table = lightCutBuffers(shape, views);
    return !pastBinding(limits, { ...table.rows, frames: table.frames(shape.frames.per) });
  };
  let views = DAG_MAX_VIEWS;
  while (views > 1 && !fits(views)) views--;
  return views;
}
