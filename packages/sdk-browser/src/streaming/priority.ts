/** Request priorities: the streamer serves the smallest number first. The root cover needs none of
 *  them — it is asked for on its own, before anything else is offered. */
export const PRIORITY_VISIBLE = 1,
  PRIORITY_PREFETCH = 3
