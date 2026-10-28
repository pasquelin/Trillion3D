import { QUERY_SET_SIZE } from './querySetSize.ts'

/** Timestamps a timer is made with: one query set. An image that needs more makes the timer grow, by doubling, once
 *  (`growTimingQueries`); it is never made again for an image. */
export const FIRST_QUERIES = QUERY_SET_SIZE
