import { SOLE_FRICTION } from './characterSettings.ts';

/**
 * The friction between a rubber sole and a floor of friction `floor`: their geometric mean, the
 * rule the physics backend combines two bodies' frictions by (Jolt's default). 0.79 on stone,
 * 0.16 on ice.
 */
export const gripOf = (floor: number) => Math.sqrt(SOLE_FRICTION * Math.max(0, floor));
