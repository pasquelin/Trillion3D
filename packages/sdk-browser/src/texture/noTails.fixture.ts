import { laneCounts } from './blockFormats.ts';

/** No tail in any lane of either atlas: a lane's floor is the one layer it streams into. */
export const noTails = { color: laneCounts(), data: laneCounts() };
