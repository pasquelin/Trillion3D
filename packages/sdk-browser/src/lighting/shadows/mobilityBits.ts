/** Bits of a row's mobility word (`casters/mobility.ts`): its placement moves; its
 * fragments can be cut — a cutout (`FLAG_MASK`) that is no blended caster; its placement
 *  casts no shadow — `castShadow = false`, hidden or parked —, which every caster pass skips; its
 * placement casts far shadows (`castFarShadow`), which a sun's far-shadow test never leaves out;
 * from `MOBILITY_CORNER_SHIFT` up, the corners its page-table row draws; and, at the top, whether
 * its placement says the sun's far-shadow test reaches it or never does (`farShadowTest`). */
export const MOBILITY_MOVING = 1,
  MOBILITY_CUTOUT = 2,
  MOBILITY_SHADOWLESS = 4,
  MOBILITY_FAR_SHADOW = 8,
  MOBILITY_CORNER_SHIFT = 4,
  MOBILITY_FAR_TESTED = 1 << 28,
  MOBILITY_FAR_SKIPPED = 1 << 29
/** The bits a placement gives each of its rows: whether it moves and how it casts. */
export const MOBILITY_PLACEMENT_BITS =
  MOBILITY_MOVING |
  MOBILITY_SHADOWLESS |
  MOBILITY_FAR_SHADOW |
  MOBILITY_FAR_TESTED |
  MOBILITY_FAR_SKIPPED
