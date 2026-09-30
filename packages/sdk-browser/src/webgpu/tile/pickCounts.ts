import { WRAP_MAP } from '../../visibility/wrapModes.ts';

/** Number of maps a pixel can name: the rank of `WRAP_MAP`, written once. */
export const MAP_CHOICES = Object.keys(WRAP_MAP).length;

/** A pick is a map (or the masked sun level), one of two blend levels, one of three taps. */
export const PICK_BLENDS = 2,
  PICK_TAPS = 3;
