/**
 * The one table of the deferred pass's bindings: the layout (`setup.ts`), the bind-group entries
 * (`program.ts`) and the WGSL declarations read their number here, so the opaque resolve, the blend
 * and the water composite, which extend the same list, read a surface lit on the same numbers. The
 * receiver's reads follow `receiver`; 15 to 17, 20 and 24 to 28 are the receiver's and the shadow
 * read's own, 30 and 31 the resolve proofs'.
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
  pageTable: 8,
  projectionData: 9,
  uniforms: 10,
  bounceGrid: 11,
  probes: 12,
  proxy: 13,
  transmissionResolve: 14,
  transmittance: 18,
  pool: 19,
  maskTable: 21,
  subsurface: 22,
  receiver: 23,
  maskTiles: 29,
  lobes: 32,
  reflection: 33,
} as const
