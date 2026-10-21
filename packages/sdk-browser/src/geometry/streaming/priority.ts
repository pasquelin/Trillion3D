/** Request priorities: the streamer serves the smallest number first, a read the view's pages wait
 *  on at `PRIORITY_VISIBLE`. The root cover needs none — it is asked for on its own, before
 *  anything else is offered. */
export const PRIORITY_VISIBLE = 1

/**
 * The priority a cell's reads ask by: its files and its HLOD actors' roots alike, so one order
 * serves every read of every cell. The cells' lane lies ahead of the pages' (`PRIORITY_VISIBLE`), a
 * page never ranked among them: `turn` is the number the cell took when it started loading
 * (`LoadSlots.priorityOf`), and the lower it is, the sooner its reads are served. It stays below
 * `PRIORITY_VISIBLE` whatever `turn`, which a session keeps small.
 */
export const cellPriority = (turn: number) => PRIORITY_VISIBLE - 1 / (2 + turn)
