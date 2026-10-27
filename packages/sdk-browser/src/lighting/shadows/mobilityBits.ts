/** Bits of a placement's mobility word (`casters/mobility.ts`): it moves; it casts no shadow —
 *  `castShadow = false`, hidden or parked —, which every caster pass skips; it casts far shadows
 *  (`castFarShadow`), which a sun's far-shadow test never leaves out; its object says whether that
 *  test reaches it or never does (`farShadowTest`); its transform never invalidates its cached
 *  shadows (`shadowCacheInvalidation` `'static'`); its vertices are moved by a deformation, so
 *  the pages it draws while it moves are marked dirty as it draws them; its object does not evaluate the
 *  offset its surfaces wear (`evaluateWorldPositionOffset` off), and keeps its shadows from being
 *  invalidated by that offset (`shadowCacheInvalidation` `'rigid'` or `'static'`); its object stands for a
 *  first-person one (`firstPersonWorldSpaceRepresentation`), so that it casts into the suns'
 *  first-person clipmaps alone; its object casts while hidden (`castHiddenShadow`), so that the
 *  view's filter, which hides it, does not take it out of the shadows; one of its surfaces wears an
 *  offset whose evaluation may invalidate its shadows (its object does not keep them), so that its
 *  clusters may draw into the dynamic layer (`vsmDescentNotDrawn`), and one of them evaluates it
 *  whatever the distance says (`alwaysEvaluateWorldPositionOffset`); its object is often moving
 *  (`mobility` `'movable'`, or a skin or a morph deforms it, unless it says otherwise), so that it
 *  arrives cached as dynamic. One word a placement, never
 *  a word a cluster: what a cluster adds (a cutout, its corners) is read where it is drawn. */
export const MOBILITY_MOVING = 1,
  MOBILITY_OFFSET_ALWAYS = 2,
  MOBILITY_SHADOWLESS = 4,
  MOBILITY_FAR_SHADOW = 8,
  MOBILITY_DEFORMS = 16,
  MOBILITY_OFFSET_SILENT = 32,
  MOBILITY_OFFSET_KEEPS_CACHE = 64,
  MOBILITY_WORLD_SPACE = 128,
  MOBILITY_HIDDEN_SHADOW = 256,
  MOBILITY_OFFSET_INVALIDATES = 512,
  MOBILITY_OFTEN_MOVING = 1024,
  MOBILITY_FAR_TESTED = 1 << 28,
  MOBILITY_FAR_SKIPPED = 1 << 29,
  MOBILITY_CACHE_STATIC = 1 << 30
/** The bits whose change stales the pages a placement is drawn in even where it stands: whether it
 *  casts, casts far, or is tested for far shadows. A flip of `MOBILITY_MOVING` alone stales them too
 *  (its casters change layer), but not at a new place: the diff names it apart. */
export const MOBILITY_CAST_BITS =
  MOBILITY_SHADOWLESS |
  MOBILITY_FAR_SHADOW |
  MOBILITY_FAR_TESTED |
  MOBILITY_FAR_SKIPPED |
  MOBILITY_WORLD_SPACE |
  MOBILITY_HIDDEN_SHADOW
