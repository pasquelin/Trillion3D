/** Bits of a row's mobility word (`casters/mobility.ts`): its placement moves; its
 * fragments can be cut — a cutout (`FLAG_MASK`) that is no blended caster; its placement
 *  casts no shadow — `castShadow = false`, hidden or parked —, which every caster pass skips; its
 * placement casts far shadows (`castFarShadow`), which a sun's far-shadow test never leaves out;
 * and, from `MOBILITY_CORNER_SHIFT` up, the corners its page-table row draws. */
export const MOBILITY_MOVING = 1,
  MOBILITY_CUTOUT = 2,
  MOBILITY_SHADOWLESS = 4,
  MOBILITY_FAR_SHADOW = 8,
  MOBILITY_CORNER_SHIFT = 4
