/** Bits of a row's mobility word (`../../webgpu/shadow/mobility.ts`): its placement moves; its
 *  fragments can be cut — a cutout (`FLAG_MASK`) that is no blended caster (#965); its placement
 *  casts no shadow — `castShadow = false`, hidden or parked —, which every caster pass skips; and, from
 *  `MOBILITY_CORNER_SHIFT` up, the corners its page-table row draws (#966). */
export const MOBILITY_MOVING = 1,
  MOBILITY_CUTOUT = 2,
  MOBILITY_SHADOWLESS = 4,
  MOBILITY_CORNER_SHIFT = 3
