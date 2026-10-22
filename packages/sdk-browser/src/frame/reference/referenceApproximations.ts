import { BOUNCE_PROBE_QUEUE } from '../../../../sdk-core/src/bounce/contracts.ts'

/** The approximations the reference switches off, by name (`referenceMode.ts`). */
export const REFERENCE_APPROXIMATIONS = [
  'renderScale',
  'temporalReuse',
  'probeBudget',
  'shadowResolution',
  'supersampling',
] as const

/** The probes the reference mode traces a frame: the whole queue, the most a frame can, so the field
 *  converges in the fewest images (`BOUNCE_PROBE_QUEUE`). */
export const REFERENCE_BOUNCE_PROBES = BOUNCE_PROBE_QUEUE
