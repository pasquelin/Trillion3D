import { parkedEntries } from '../../../site/app/examples/list.ts'

/** The pages parked until the engine draws them: opened for their errors, never asked to draw. */
export const parkedExampleIds = new Set(parkedEntries.map(({ id }) => id))
