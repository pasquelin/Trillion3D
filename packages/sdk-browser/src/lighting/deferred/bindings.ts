/**
 * The one table of the deferred pass's bindings: the layout (`setup.ts`), the bind-group entries
 * (`program.ts`) and the WGSL declarations read their number here, so the opaque resolve and the
 * blend, which extend the same list, read a surface lit on the same numbers. The receiver target
 * is `receiver`; 30 and 31 are the resolve proofs'.
 */
export const DEFERRED_BINDINGS = {
  baseMetal: 0,
  normalRough: 1,
  emissiveAo: 2,
  flags: 3,
  depth: 4,
  view: 5,
  lights: 6,
  tiles: 7,
  bounceGrid: 11,
  probes: 12,
  /** The mask's transmission, what the panes let through along each light's missed rays: the
   *  opaque resolve's (`vsmMaskThrough`). */
  transmissionResolve: 14,
  transmittance: 18,
  subsurface: 22,
  receiver: 23,
  /** The shadow mask's tile words (`vsmMaskFactor`): the opaque resolve's. */
  maskTiles: 29,
  lobes: 32,
  reflection: 33,
} as const
